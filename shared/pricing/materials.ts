/**
 * Two materials on one piece of work.
 *
 * A printed denture is two prints glued together: the base in one resin (Apex
 * Base) and the teeth in another (Apex Teeth). One material per work item could
 * not say that, so the second one went nowhere.
 *
 * Both live in the SAME string the material always lived in — `WorkItem.materjal`
 * and `jobs.materjal` — joined as "Apex Base + Apex Teeth". No migration, and
 * every place that already shows the material (the board, the job sheet, the
 * partner's view, the phone, exports) shows both without being told. Each part
 * keeps its own shade suffix ("Crown HT A1"), exactly as a single material does.
 *
 * Anything that prices or costs a material must go through `splitMaterials`:
 * the joined string is not a key in Seaded.
 */

export const MATERIAL_JOIN = ' + '

/** The first and second material. Both '' when there is none. */
export function splitMaterials(value: string | null | undefined): [string, string] {
  const s = (value ?? '').trim()
  const at = s.indexOf(MATERIAL_JOIN)
  if (at < 0) return [s, '']
  return [s.slice(0, at).trim(), s.slice(at + MATERIAL_JOIN.length).trim()]
}

/** Every material named, in order, none empty. */
export function materialList(value: string | null | undefined): string[] {
  return splitMaterials(value).filter(Boolean)
}

/**
 * The one string to store. With the first cleared, the second becomes the only
 * material rather than a dangling " + Apex Teeth".
 */
export function joinMaterials(first: string | null | undefined, second: string | null | undefined): string {
  return [first?.trim() ?? '', second?.trim() ?? ''].filter(Boolean).join(MATERIAL_JOIN)
}
