/**
 * Visit types — WHY the patient is coming in.
 *
 * Deliberately separate from `VisitStatus`, which is where the appointment has
 * got to (booked → arrived → done). Type and status answer different questions
 * and both have to be readable at a glance, so they are drawn differently
 * rather than fighting over the same colour: the type fills the card, the
 * status tints its edge.
 *
 * Same shape as WorkType's first two fields on purpose — the settings row
 * editor is shared, and a lab's job types and a practice's visit types are the
 * same kind of user-owned coloured list.
 */
export interface VisitType {
  nimi: string
  hex: string
}

/** Grey. What an untyped visit gets, and the swatch for "Määramata". */
export const UNTYPED_VISIT_HEX = '#94A3B8'

// A general practice's ordinary week. Editable in Seaded → Valikud — these are
// only the starting point, not a fixed vocabulary.
export const DEFAULT_VISIT_TYPES: VisitType[] = [
  { nimi: 'Kontroll',          hex: '#0AB6C4' },
  { nimi: 'Konsultatsioon',    hex: '#64748B' },
  { nimi: 'Jäljendi tegemine', hex: '#8B5CF6' },
  { nimi: 'Proovimine',        hex: '#F59E0B' },
  { nimi: 'Tsementeerimine',   hex: '#10B981' },
  { nimi: 'Täidis',            hex: '#3B82F6' },
  { nimi: 'Juureravi',         hex: '#EF4444' },
  { nimi: 'Hügieen',           hex: '#06B6D4' },
  { nimi: 'Ekstraktsioon',     hex: '#B91C1C' },
]

/**
 * Exact match only, unlike work types.
 *
 * `resolveWorkType` does substring matching because `jobs.too` is free text
 * typed by whoever filled the form. A visit type is picked from a list, so
 * guessing here would only ever turn a deliberate "Kontroll" into something
 * else the moment someone added "Kontrollproovimine" to the list.
 */
export const visitTypeIn = (
  tyyp: string | null | undefined, types: readonly VisitType[]
): VisitType | undefined =>
  tyyp?.trim() ? types.find(t => t.nimi === tyyp.trim()) : undefined

/** The colour to draw a visit in. Grey when untyped or the type was deleted. */
export const visitTypeHexIn = (
  tyyp: string | null | undefined, types: readonly VisitType[]
): string => visitTypeIn(tyyp, types)?.hex ?? UNTYPED_VISIT_HEX
