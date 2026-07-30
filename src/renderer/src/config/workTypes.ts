// Work-type colours for the calendar and the dashboard.
//
// The two channels on a job card answer different questions, and they must not
// both encode the same thing:
//   left edge  → WHICH STAGE the job is at   (stage hex, editable in Seaded)
//   soft fill  → WHAT KIND of work it is     (this file)
// Before 1.3.1 both were the stage colour, so a month of finished work was an
// undifferentiated wall of green and you could not spot a Kroon among Sillad.
//
// Matching is substring-based on the free-text `too` field, because that field is
// an autocomplete suggestion and not a fixed list — users type variants like
// "Allon4 ülemine" or "Abutmendile kroon".
//
// Since 1.7.13 the list itself lives in settings (Seaded → Valikud), so a lab can
// add its own types and recolour the built-in ones. The list below is only the
// seed. Everything here is a pure function over a passed-in list: the colours a
// component paints must come from the same snapshot React re-rendered with, or
// the legend and the cards drift apart the moment a colour is edited.

/**
 * How a work type is priced.
 *   'too'    — one price for the whole job (Allon4 = 5000 €)
 *   'hammas' — price per tooth (Sild, and design, are quoted per unit)
 * Per-job was the only option until 1.11.0, which made a bridge impossible to
 * price: its cost depends entirely on how many units it spans.
 */
export type PriceMode = 'too' | 'hammas'

/** One consumable on a work type. `tyyp` reads the same way as a price mode. */
export interface WorkTypeCost {
  nimi: string       // "Kruvi", "Abutment"
  summa: number      // €
  tyyp: PriceMode    // per job, or per tooth
}

export interface WorkType {
  nimi: string      // label shown in the legend and the suggestion list
  hex: string
  // Price in €, read according to `hinnaTyyp`. Undefined means "not priced by
  // type" and the per-tooth material calculation applies instead.
  // Lives on the type rather than in a separate price map: a job type and what
  // it costs are one fact, and two lists keyed by the same free text drift the
  // moment one of them is renamed.
  hind?: number
  // Second price the person filling the form can pick instead of the full one.
  soodushind?: number
  hinnaTyyp?: PriceMode   // default 'too'
  pilt?: string           // file name in assets/worktypes, defaults to the slug
  /**
   * Consumables this type always needs — the implant screw, the abutment, the
   * library file. A COST, never added to what the client is charged: it exists
   * so the margin knows what the job actually consumed.
   *
   * A list rather than one number because a type usually needs several things,
   * and "12 € of something" is not an answer anyone can check later.
   */
  kulud?: WorkTypeCost[]
  // Extra lowercase substrings that also mean this type. The name itself always
  // matches, so this is only for synonyms and English spellings.
  match?: string[]
}

// Order matters: the first match wins, so the more specific terms sit above the
// ones that would also match them ("implantkroon" before "kroon").
export const DEFAULT_WORK_TYPES: WorkType[] = [
  { nimi: 'Implantkroon',    hex: '#6366F1', match: ['implantkroon', 'abutmendile'] },
  { nimi: 'Kroon',           hex: '#3B82F6', match: ['crown'] },
  { nimi: 'Sild',            hex: '#8B5CF6', match: ['bridge'] },
  { nimi: 'Viniir',          hex: '#10B981', match: ['veneer'] },
  { nimi: 'Laminaat',        hex: '#84CC16' },
  { nimi: 'Inlay',           hex: '#F59E0B' },
  { nimi: 'Onlay',           hex: '#F97316' },
  { nimi: 'Täidis',          hex: '#EAB308', match: ['taidis'] },
  { nimi: 'Proteez',         hex: '#F43F5E', match: ['denture'] },
  { nimi: 'All-on-X',        hex: '#EC4899', match: ['allon', 'all-on'] },
  { nimi: 'Kaitse / splint', hex: '#06B6D4', match: ['nightguard', 'öökaitse', 'ookaitse', 'splint', 'splaad'] },
  { nimi: 'Retainer',        hex: '#14B8A6' },
  { nimi: 'IBT',             hex: '#A855F7' },
  { nimi: 'Kirurgiline',     hex: '#0EA5E9', match: ['kirur', 'surgic'] },
]

export const UNKNOWN_WORK_TYPE: WorkType = { nimi: 'Muu / määramata', hex: '#94A3B8' }

// Colour picks offered when adding or recolouring a type. Same palette as the
// pipeline stages, so the two editors read as one system.
export const WORK_TYPE_PALETTE = [
  '#6366F1', '#8B5CF6', '#A855F7', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#64748B', '#94A3B8'
]

/**
 * What the consumables on this job cost. Per-tooth items multiply by the tooth
 * count, exactly as per-tooth prices do — one screw per implant.
 */
export function workTypeConsumables(
  too: string | null | undefined, types: WorkType[], teeth: number
): { total: number; items: { nimi: string; summa: number }[] } {
  const t = resolveWorkType(too, types)
  const items = (t.kulud ?? [])
    .filter(k => k.summa > 0)
    .map(k => ({
      nimi: k.nimi || 'Kulu',
      summa: Math.round((k.tyyp === 'hammas' ? k.summa * teeth : k.summa) * 100) / 100,
    }))
    .filter(k => k.summa > 0)
  return {
    total: Math.round(items.reduce((s, k) => s + k.summa, 0) * 100) / 100,
    items,
  }
}

export function resolveWorkType(too: string | null | undefined, types: WorkType[]): WorkType {
  const t = (too ?? '').toLowerCase()
  if (!t.trim()) return UNKNOWN_WORK_TYPE
  return types.find(r =>
    t.includes(r.nimi.toLowerCase()) || (r.match ?? []).some(m => t.includes(m))
  ) ?? UNKNOWN_WORK_TYPE
}

export const workTypeHexIn = (too: string | null | undefined, types: WorkType[]): string =>
  resolveWorkType(too, types).hex

export const workTypeLabelIn = (too: string | null | undefined, types: WorkType[]): string =>
  resolveWorkType(too, types).nimi

// Distinct work types present in a set of jobs, for a legend that lists only what
// is actually on screen rather than every configured type.
export function workTypesPresentIn(
  toos: (string | null | undefined)[],
  types: WorkType[]
): { label: string; hex: string }[] {
  const seen = new Map<string, string>()
  for (const t of toos) {
    const r = resolveWorkType(t, types)
    if (!seen.has(r.nimi)) seen.set(r.nimi, r.hex)
  }
  return [...seen.entries()].map(([label, hex]) => ({ label, hex }))
}
