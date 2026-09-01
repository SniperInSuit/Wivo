/**
 * FDI arch arithmetic for the wizard: which arch a tooth is in, whether a set
 * of teeth forms a bridge, and the `hambad` wire format.
 *
 * Named archRules and not `teeth.ts` on purpose — `shared/pricing/teeth.ts`
 * already exists and counts teeth by SIZE. Two modules called "teeth" that mean
 * different things is a name collision waiting to be imported wrongly.
 *
 * The tables below are FDI NUMBERING, identical to `config/teeth.ts` and both
 * odontogram pickers. They are NOT the arch GEOMETRY that `config/teeth.ts`
 * warns against copying: there are no coordinates here, and nothing in this
 * file draws anything.
 */
import type { ArchSelection } from './types'

export const FDI_UPPER: readonly number[] = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
export const FDI_LOWER: readonly number[] = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

export type ArchKey = 'upper' | 'lower'

/** Which arch an FDI number belongs to; null for anything not in the tables. */
export function archOf(fdi: number): ArchKey | null {
  if (FDI_UPPER.includes(fdi)) return 'upper'
  if (FDI_LOWER.includes(fdi)) return 'lower'
  return null
}

/**
 * 0-based position within its arch, or -1. Adjacency is index distance 1 —
 * which is why this is an index into the table and not `fdi % 10`: 11 and 21
 * are neighbours across the midline but their position numbers are both 1.
 */
export function archIndex(fdi: number): number {
  const upper = FDI_UPPER.indexOf(fdi)
  if (upper !== -1) return upper
  return FDI_LOWER.indexOf(fdi)
}

/**
 * The individual arches a selection covers.
 *
 * 'both' is TWO arches and not one 32-tooth selection, and that distinction is
 * a money question rather than a presentation one: an arch-level work type is
 * usually priced per JOB (`hinnaTyyp: 'too'`), and the price book returns that
 * unit flat however many teeth the item carries. As a single work item, an
 * All-on-X on both jaws was therefore quoted at the single-arch price — the lab
 * billed one arch for two. One item per arch makes both pricing modes come out
 * right without either of them knowing about arches.
 */
export function archesOf(arch: ArchSelection): ArchKey[] {
  return arch === 'both' ? ['upper', 'lower'] : [arch]
}

/**
 * The teeth ONE arch of an arch-level work item actually covers.
 *
 * The arch answer fills the jaw, and that is right almost every time — but not
 * always. An All-on-4 routinely stops short of the last molar, and until this
 * existed there was no way to say so: the arch buttons were the only control on
 * the step and they are all-or-nothing.
 *
 * `custom` UNDEFINED means "nobody has touched it", which is not the same as an
 * empty selection. Undefined takes the whole arch; an explicit empty list is a
 * deliberate answer and stays empty. Collapsing the two would make deselecting
 * the last tooth silently refill the jaw.
 */
export function teethForArch(
  arch: ArchKey, custom: readonly number[] | undefined
): number[] {
  const all = archTeeth(arch)
  if (custom === undefined) return all
  const inArch = new Set(all)
  // Intersected, never taken as given: a selection left over from a previous
  // arch answer must not put upper teeth on a lower item.
  return all.filter(t => custom.includes(t) && inArch.has(t))
}

/** Every FDI in the given arch(es), in FDI_UPPER/FDI_LOWER order. */
export function archTeeth(arch: ArchSelection): number[] {
  if (arch === 'upper') return [...FDI_UPPER]
  if (arch === 'lower') return [...FDI_LOWER]
  return [...FDI_UPPER, ...FDI_LOWER]
}

/**
 * Sorts FDI numbers into arch order (upper arch first, then lower).
 * Numbers outside the tables keep a stable place at the end rather than being
 * dropped: a stale draft or a hand-typed `hambad` should survive a round trip.
 */
export function sortTeeth(teeth: readonly number[]): number[] {
  const rank = (n: number): number => {
    const u = FDI_UPPER.indexOf(n)
    if (u !== -1) return u
    const l = FDI_LOWER.indexOf(n)
    if (l !== -1) return 100 + l
    return 1000 + n
  }
  return [...teeth].sort((a, b) => rank(a) - rank(b))
}

/** Comma-joined FDI string in arch order — the WorkItem.hambad wire format. */
export function teethToHambad(teeth: readonly number[]): string {
  return sortTeeth(teeth).join(',')
}

/** Parses a WorkItem.hambad string back into FDI numbers. Drops blanks/NaN. */
export function hambadToTeeth(hambad: string | null | undefined): number[] {
  if (!hambad) return []
  return hambad
    .split(',')
    .map(part => Number(part.trim()))
    .filter(n => Number.isFinite(n) && n > 0)
}

export interface ConsecutiveResult {
  ok: boolean
  /** 'empty' | 'too-few' | 'mixed-arch' | 'gap' — null when ok. */
  reason: 'empty' | 'too-few' | 'mixed-arch' | 'gap' | null
  /** FDI numbers that would close the gap. Empty unless reason === 'gap'. */
  missing: number[]
}

/**
 * A bridge must be >= 2 teeth, all in ONE arch, with no index gap.
 *
 * Cross-arch spans are rejected rather than tolerated: MultiOdontogramPicker
 * silently skips cross-arch connector pairs, so a "bridge" spanning both jaws
 * would draw no connectors at all and look like unrelated single crowns.
 */
export function checkConsecutive(teeth: readonly number[]): ConsecutiveResult {
  const unique = [...new Set(teeth)]
  if (unique.length === 0) return { ok: false, reason: 'empty', missing: [] }
  if (unique.length === 1) return { ok: false, reason: 'too-few', missing: [] }

  const arches = new Set(unique.map(archOf))
  if (arches.size > 1 || arches.has(null)) {
    return { ok: false, reason: 'mixed-arch', missing: [] }
  }

  const table = arches.has('upper') ? FDI_UPPER : FDI_LOWER
  const indexes = unique.map(archIndex).sort((a, b) => a - b)
  const missing: number[] = []
  for (let i = indexes[0]; i <= indexes[indexes.length - 1]; i++) {
    if (!indexes.includes(i)) missing.push(table[i])
  }
  if (missing.length > 0) return { ok: false, reason: 'gap', missing }

  return { ok: true, reason: null, missing: [] }
}
