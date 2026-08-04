/**
 * Counting teeth out of the free-text `hambad` field.
 *
 * `hambad` is a comma-separated list of FDI numbers ("13,12,11,21"). The last
 * digit is the position in the quadrant: 1–5 are incisors, canines and
 * premolars, 6–8 are molars. Material is priced per position class because a
 * molar takes more of it.
 *
 * Moved out of `stores/useSettings.ts` so the web order form can count teeth
 * without pulling in React and the settings store.
 */

/** How many teeth the field names at all. */
export function toothCount(hambad: string | null | undefined): number {
  return (hambad ?? '').split(',').filter(Boolean).length
}

/** FDI positions 1–5 — incisors, canines, premolars. */
export function countSmallTeeth(hambad: string): number {
  return hambad.split(',').filter(t => {
    const pos = parseInt(t.trim()) % 10
    return pos >= 1 && pos <= 5
  }).length
}

/** FDI positions 6–8 — molars. */
export function countLargeTeeth(hambad: string): number {
  return hambad.split(',').filter(t => {
    const pos = parseInt(t.trim()) % 10
    return pos >= 6
  }).length
}
