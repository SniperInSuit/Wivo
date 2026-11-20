/**
 * The phone's new-job form keeps the desktop wizard's own state (NewJobState)
 * and builds the row with the wizard's own toJobInput, so a job made on the
 * phone is the same job as one made at the desk: same price, same
 * `printed_model`, same stages from the same template (docs/WORKFLOW-STAGES.md
 * §13). These are the few pure steps the form needs on top of that.
 */
import { hambadToTeeth, teethToHambad, workTypeRules, type NewJobState } from '@shared/wizard'
import type { WorkType } from '@shared/pricing/workTypes'

/** One kind of work per job on the phone (a second one is added on the desk). */
export function withWorkType(state: NewJobState, name: string | null): NewJobState {
  return {
    ...state,
    jobTypes: name ? [name] : [],
    selectedTeeth: {},
    selectedArch: null,
    materialByType: {},
    implantsByType: {},
    designByType: {},
  }
}

/** What the teeth box shows: "11, 12" in the order the wizard keeps them. */
export function teethText(state: Pick<NewJobState, 'jobTypes' | 'selectedTeeth'>): string {
  const name = state.jobTypes[0]
  return name ? (state.selectedTeeth[name] ?? []).join(', ') : ''
}

/** Typed teeth ("11, 12; 13") → FDI numbers, nothing but 11–48 kept. */
export function parseTeeth(text: string): number[] {
  const nums = hambadToTeeth(text.replace(/[;\s]+/g, ','))
  const ok = nums.filter(n => Number.isInteger(n) && n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8)
  return [...new Set(ok)]
}

export function withTeeth(state: NewJobState, text: string): NewJobState {
  const name = state.jobTypes[0]
  return name ? { ...state, selectedTeeth: { ...state.selectedTeeth, [name]: parseTeeth(text) } } : state
}

export function withMaterial(state: NewJobState, material: string | null): NewJobState {
  const name = state.jobTypes[0]
  if (!name) return state
  const { [name]: _gone, ...rest } = state.materialByType
  return { ...state, materialByType: material ? { ...rest, [name]: material } : rest }
}

/** How the chosen work is located on the teeth: by tooth, by jaw, or not at all. */
export function toothModeOf(state: Pick<NewJobState, 'jobTypes'>, types: readonly WorkType[]): 'tooth' | 'arch' | 'none' | null {
  const name = state.jobTypes[0]
  return name ? workTypeRules(name, types).toothMode : null
}

export { teethToHambad }
