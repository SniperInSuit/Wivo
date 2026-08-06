/**
 * The contract every step component codes against.
 *
 * All six steps take the SAME props, so the shell can render them from a lookup
 * table and never special-case a step. A step that needs one more thing gets it
 * out of `state` or out of a hook of its own — it does not grow the prop list,
 * because the moment one step is special the shell has to know which one, and
 * then the shell has six branches instead of a table.
 */
import type { JobRules, NewJobState, StepId, ValidationError } from '@shared/wizard'

export interface WizardStepProps {
  state: NewJobState
  /** Shallow merge into wizard state. The ONLY way a step writes. */
  patch: (patch: Partial<NewJobState>) => void
  /** Derived from state.jobTypes + useWorkTypes().types by the shell. */
  rules: JobRules
  /** validateStep() output for THIS step. Steps render field errors from it. */
  errors: ValidationError[]
  /** false until the user presses a blocked Continue — do not shout on load. */
  showErrors: boolean
  /** Step 6's "Muuda" buttons. Also used by inline "vaata üle" links. */
  goToStep: (step: StepId) => void
}

/** Every step component matches this. No step may add or drop a prop. */
export type WizardStepComponent = (props: WizardStepProps) => JSX.Element

/**
 * Helper every step uses to pick its own field errors out of `errors`.
 *
 * With `workType` omitted this returns EVERY issue on the field, including the
 * per-work-type ones — that is what a field-level error line wants. Pass
 * `workType` when the message is rendered next to one type's own control.
 */
export function fieldErrors(
  errors: ValidationError[],
  field: ValidationError['field'],
  workType?: string
): ValidationError[] {
  return errors.filter(
    e => e.field === field && (workType === undefined || e.workType === workType)
  )
}
