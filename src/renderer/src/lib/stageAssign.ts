/** Small pure helpers for the people on a stage (the stage bar, quick assign). */

/**
 * Two letters for a person's circle: first name's and last name's first
 * letter; from a single name its first two letters.
 */
export function initials(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const chars = (w: string) => Array.from(w)
  const out = words.length >= 2
    ? chars(words[0])[0] + chars(words[words.length - 1])[0]
    : chars(words[0]).slice(0, 2).join('')
  return out.toLocaleUpperCase()
}

/** `people` with `person` added or taken away. Order kept, no duplicates. */
export function withPerson(people: readonly string[], person: string, on: boolean): string[] {
  const rest = people.filter(p => p !== person)
  return on ? [...rest, person] : rest
}

/** Circles to draw: at most two, and how many more there are ("+N"). */
export function visiblePeople<T>(people: readonly T[]): { shown: T[]; more: number } {
  return { shown: people.slice(0, 2), more: Math.max(0, people.length - 2) }
}
