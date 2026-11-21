/**
 * Quick assignment: pick one person and tick every stage they do (one
 * technician on Design, Printing and Cleaning at once). Pure; the screens
 * (the new-job form, the job's stages, the phone) share it.
 */
export interface StagePeople {
  stageKey: string
  people: readonly string[]
}

/** The stages `person` is on. */
export const stagesOf = (stages: readonly StagePeople[], person: string): string[] =>
  stages.filter(s => s.people.includes(person)).map(s => s.stageKey)

/**
 * The stages whose people change when `person` is made to do exactly the
 * `ticked` ones: added where ticked, removed where not. Other people are
 * left as they are. Stages that stay as they are are not listed.
 */
export function assignPerson(
  stages: readonly StagePeople[],
  person: string,
  ticked: readonly string[],
): { stageKey: string; people: string[] }[] {
  const out: { stageKey: string; people: string[] }[] = []
  for (const s of stages) {
    const has = s.people.includes(person)
    const want = ticked.includes(s.stageKey)
    if (has === want) continue
    out.push({ stageKey: s.stageKey, people: want ? [...s.people, person] : s.people.filter(p => p !== person) })
  }
  return out
}
