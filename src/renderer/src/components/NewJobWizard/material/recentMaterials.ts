// The materials this machine reached for last, newest first.
//
// Local rather than clinic-wide on purpose: "recent" is a property of the
// person filling the form, not of the lab. A technician who only ever prints
// nightguards should not have to scroll past the crown materials the person at
// the next desk used this morning. The authoritative list still lives in
// settings.materjalid — this only reorders it.

const KEY = 'wivo_newjob_recent_materials_v1'
const MAX = 6

/** Newest first. Never throws: a blocked or corrupt localStorage must not stop
 *  the wizard from rendering its material list. */
export function readRecentMaterials(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is string => typeof m === 'string' && m.trim() !== '').slice(0, MAX)
  } catch {
    return []
  }
}

/** Moves `material` to the front, de-duplicated, capped at MAX. */
export function pushRecentMaterial(material: string): void {
  const name = material.trim()
  if (!name) return
  try {
    const next = [name, ...readRecentMaterials().filter(m => m !== name)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Quota or a hardened profile — recents are a convenience, never a failure.
  }
}
