/**
 * The six steps: their titles, and how the user is allowed to move between them.
 *
 * THE SIX STEPS ARE ALWAYS SIX. Step 2 can be *skipped* — a nightguard has no
 * teeth to pick — but the tracker still shows 1..6 with the same labels and the
 * same "Samm N/6". Renumbering a tracker mid-flow is exactly what confuses the
 * older users this product is for: they learn "Materjal is step 3" and then it
 * silently becomes step 2. `isStepSkipped()` drives navigation, never labelling.
 *
 * These titles are the ONLY source of step text anywhere in the wizard. The
 * shell renders them; no step component writes its own heading.
 */
import type { WorkType } from '../pricing/workTypes'
import type { NewJobState, StepId } from './types'
import { canContinue } from './validation'
import type { JobRules } from './workTypeRules'
import { jobRules } from './workTypeRules'
import { t } from '../i18n'

export interface StepMeta {
  id: StepId
  /** Stable slug, used for keys and draft diffing. */
  key: 'tootuup' | 'hambad' | 'materjal' | 'tootmine' | 'tellimus' | 'kontroll'
  /** Label in the horizontal tracker. */
  short: string
  /** <h2> rendered by the shell. */
  title: string
  /** Sub-line under the <h2>, rendered by the shell. */
  subtitle: string
}

export const WIZARD_STEPS: readonly StepMeta[] = [
  { id: 1, key: 'tootuup',  short: t('wizardRules.workType'), title: t('wizardRules.whatAreWeMaking'), subtitle: t('wizardRules.chooseOneOrMoreWorkTypes') },
  { id: 2, key: 'hambad',   short: t('wizardRules.teeth'), title: t('wizardRules.chooseTeeth'), subtitle: t('wizardRules.markTheTeethThisJobInvolves') },
  { id: 3, key: 'materjal', short: t('wizardRules.material'), title: t('wizardRules.materialAndShade'), subtitle: t('wizardRules.chooseTheMaterialAndIfNeeded') },
  { id: 4, key: 'tootmine', short: t('wizardRules.production'), title: t('wizardRules.production'), subtitle: t('wizardRules.machineAssigneesAndDueDate') },
  { id: 5, key: 'tellimus', short: t('wizardRules.order'), title: t('wizardRules.patientAndOrder'), subtitle: t('wizardRules.whoThisJobIsFor') },
  { id: 6, key: 'kontroll', short: t('wizardRules.review'), title: t('wizardRules.reviewTheJob'), subtitle: t('wizardRules.checkTheDetailsAndCreateThe') },
] as const

const ALL_STEPS: readonly StepId[] = [1, 2, 3, 4, 5, 6]

const clamp = (n: number): StepId =>
  (n < 1 ? 1 : n > 6 ? 6 : n) as StepId

/** Step 2 is skipped when rules.teethStepMode === 'none'. Nothing else skips. */
export function isStepSkipped(step: StepId, rules: JobRules): boolean {
  return step === 2 && !rules.needsTeethStep
}

/** Next/previous non-skipped step, clamped to 1..6. */
export function nextStep(current: StepId, rules: JobRules): StepId {
  let s = clamp(current + 1)
  while (s < 6 && isStepSkipped(s, rules)) s = clamp(s + 1)
  return s
}

export function prevStep(current: StepId, rules: JobRules): StepId {
  let s = clamp(current - 1)
  while (s > 1 && isStepSkipped(s, rules)) s = clamp(s - 1)
  return s
}

/**
 * Highest step the user may jump to: the first non-skipped step that still has
 * a blocking error, or 6 when everything validates.
 *
 * Forward jumps past an unanswered required question are what turn a wizard
 * back into the wall of fields it exists to replace — but going BACK is always
 * allowed, so nothing the user already typed is unreachable.
 */
export function maxReachableStep(state: NewJobState, types: readonly WorkType[]): StepId {
  const rules = jobRules(state.jobTypes, types)
  for (const step of ALL_STEPS) {
    if (isStepSkipped(step, rules)) continue
    if (!canContinue(step, state, types)) return step
  }
  return 6
}

/** 'done' | 'current' | 'skipped' | 'todo' — what the tracker paints. */
export type StepStatus = 'done' | 'current' | 'skipped' | 'todo'

export function stepStatus(
  step: StepId, state: NewJobState, types: readonly WorkType[]
): StepStatus {
  const rules = jobRules(state.jobTypes, types)
  if (isStepSkipped(step, rules)) return 'skipped'
  if (step === state.currentStep) return 'current'
  // 'done' means visited AND valid, not merely valid: step 4 has no required
  // fields, and ticking it before the user has seen it is a lie.
  if (step < state.currentStep) return canContinue(step, state, types) ? 'done' : 'todo'
  return 'todo'
}
