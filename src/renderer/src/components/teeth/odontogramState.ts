/**
 * What every tooth on the chart LOOKS like — derived once, rendered by anybody.
 *
 * This lived inside `MultiOdontogramPicker`, computed inline on every render.
 * That was fine while there was one chart. There is about to be a second (a 3D
 * one), and two renderers each deriving "which item owns tooth 16, what colour
 * is it, is there a bridge to its neighbour" is two implementations of a rule
 * that must never disagree — the chart would say one thing and the model
 * another, on the same job, in the same panel.
 *
 * So: one derivation here, pure and tested, and the renderers only draw.
 */
import type { WorkItem } from '../../types/job'
import { implantTeeth, designTeeth } from '../../types/job'
import { archIndex, archOf } from '@shared/wizard'

/** Fallback when a work type has no colour — the same grey as UNKNOWN_WORK_TYPE. */
export const NO_COLOUR = '#94A3B8'

export interface ToothOwner {
  itemId: string
  /** Already hue-shifted for the Nth item of this type. */
  color: string
  /** 1-based index among items of the same work type. */
  num: number
  /** True only when the type has more than one item, so the number means something. */
  showNum: boolean
}

export interface LegendEntry {
  too: string
  color: string
  count: number
}

export interface OdontogramState {
  /** FDI as a STRING — the wire format is a comma string, so this avoids parsing twice. */
  owners: Map<string, ToothOwner>
  implants: Set<string>
  /** Teeth the DESIGNER did, and only on items that said something. */
  designed: Set<string>
  legend: LegendEntry[]
  totalTeeth: number
  /** Unordered pairs of FDI numbers joined by a bridge, keyed "a|b" with a < b. */
  bridgePairs: Map<string, string>
}

/**
 * Shifts a hex so the second "Sild" on a job is distinguishable from the first.
 *
 * Index 0 is the identity, so a single item keeps exactly the colour the work
 * type was configured with.
 */
export function shiftHex(hex: string, index: number): string {
  if (index === 0) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const shift = index * 25
  const ch = (v: number): string =>
    Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')
  return `#${ch(r + (index % 2 === 0 ? shift : -shift))}`
    + `${ch(g + (index % 2 === 1 ? shift : -shift / 2))}`
    + `${ch(b)}`
}

const teethOf = (hambad: string | null | undefined): string[] =>
  (hambad ?? '').split(',').map(t => t.trim()).filter(Boolean)

/** Stable key for an unordered tooth pair, so lookup never depends on direction. */
export const pairKey = (a: string, b: string): string =>
  Number(a) < Number(b) ? `${a}|${b}` : `${b}|${a}`

export function deriveOdontogramState(
  items: WorkItem[],
  colorMap: Record<string, string>,
): OdontogramState {
  const perTypeTotal = new Map<string, number>()
  for (const i of items) perTypeTotal.set(i.too, (perTypeTotal.get(i.too) ?? 0) + 1)

  const owners = new Map<string, ToothOwner>()
  const seen = new Map<string, number>()
  for (const item of items) {
    const idx = seen.get(item.too) ?? 0
    seen.set(item.too, idx + 1)
    const color = shiftHex(colorMap[item.too] ?? NO_COLOUR, idx)
    const showNum = (perTypeTotal.get(item.too) ?? 1) > 1
    for (const t of teethOf(item.hambad)) {
      owners.set(t, { itemId: item.id, color, num: idx + 1, showNum })
    }
  }

  const implants = new Set<string>()
  for (const item of items) for (const t of implantTeeth(item)) implants.add(t)

  // Only where the item SAYS something. An item with nothing marked was
  // designed whole, and marking all 32 would be noise on the common case.
  const designed = new Set<string>()
  for (const item of items) {
    if (!item.disain_hambad) continue
    for (const t of teethOf(designTeeth(item))) designed.add(t)
  }

  const legendMap = new Map<string, LegendEntry>()
  for (const item of items) {
    const count = teethOf(item.hambad).length
    const existing = legendMap.get(item.too)
    if (existing) existing.count += count
    else legendMap.set(item.too, { too: item.too, color: colorMap[item.too] ?? NO_COLOUR, count })
  }

  /**
   * Which teeth a bridge joins — by ARCH INDEX, never by `fdi % 10`.
   *
   * 11 and 21 are neighbours across the midline and their last digits are 1 and
   * 1; 18 and 28 are opposite ends of the mouth and are also both 8. `archIndex`
   * is the one function in the codebase that already knows this, and the chart
   * used to carry its own copy of the rule.
   *
   * Direction-free on purpose: the 2D chart can be mirrored, so "to the right"
   * is a drawing question, not a data one.
   */
  const bridgePairs = new Map<string, string>()
  for (const item of items) {
    if (!item.bridge) continue
    const colour = colorMap[item.too] ?? NO_COLOUR
    // GROUPED BY ARCH FIRST. `archIndex` is an index WITHIN its own arch, so
    // 16 and 46 both answer 2 — comparing them across arches would join an
    // upper tooth to a lower one with a bar through the middle of the mouth.
    for (const arch of ['upper', 'lower'] as const) {
      const nums = teethOf(item.hambad)
        .map(Number)
        .filter(n => Number.isFinite(n) && archOf(n) === arch)
        .sort((a, b) => archIndex(a) - archIndex(b))
      for (let i = 0; i < nums.length - 1; i++) {
        // Adjacent in the arch, not merely both in the item: a bridge with a
        // gap must not draw a bar across the missing tooth.
        if (archIndex(nums[i + 1]) - archIndex(nums[i]) !== 1) continue
        bridgePairs.set(pairKey(String(nums[i]), String(nums[i + 1])), colour)
      }
    }
  }

  return {
    owners,
    implants,
    designed,
    legend: [...legendMap.values()],
    totalTeeth: owners.size,
    bridgePairs,
  }
}
