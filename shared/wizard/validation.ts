/**
 * What is missing, per step, in Estonian.
 *
 * Two severities and only two: an 'error' blocks Continue, a 'warning' never
 * does. That distinction is the whole point — "Kiirtöö kahekordistab
 * tootmishinna" must be impossible to miss and equally impossible to be stuck
 * behind, while "Patsiendi nimi on kohustuslik" must stop the job being
 * created without one.
 *
 * The messages are the product, not debug output: they are shown to the user
 * verbatim and there is exactly one wording for each. A step that invents its
 * own phrasing for the same condition is how two screens end up disagreeing
 * about what is wrong.
 */
import type { WorkType } from '../pricing/workTypes'
import { checkConsecutive } from './archRules'
import type { NewJobState, StepId } from './types'
import { jobRules } from './workTypeRules'

export type WizardField =
  | 'jobTypes' | 'teeth' | 'arch'
  | 'materials' | 'defaultShade' | 'glaze' | 'texture'
  | 'machine' | 'designer' | 'technician' | 'date' | 'deadline' | 'time'
  | 'printId' | 'designId' | 'priority'
  | 'patient' | 'customer' | 'customerReference'
  | 'pricing'

export interface ValidationError {
  field: WizardField
  /** WorkType.nimi when the message is about one type. Undefined otherwise. */
  workType?: string
  /** Estonian, shown to the user VERBATIM. Never a code, never English. */
  message: string
  /** 'error' blocks Continue. 'warning' never blocks. */
  severity: 'error' | 'warning'
}

const err = (field: WizardField, message: string, workType?: string): ValidationError =>
  ({ field, message, severity: 'error', ...(workType ? { workType } : {}) })

const warn = (field: WizardField, message: string, workType?: string): ValidationError =>
  ({ field, message, severity: 'warning', ...(workType ? { workType } : {}) })

/** At most this many FDI numbers are named in a bridge-gap message. Beyond it
 *  the list stops being an instruction and becomes a wall of digits. */
const GAP_HINT_MAX = 6

/** ' Puudu: 15, 16.' — or '' when there is nothing useful to name. */
const gapHint = (missing: readonly number[]): string =>
  missing.length === 0 || missing.length > GAP_HINT_MAX
    ? ''
    : ` Puudu: ${missing.join(', ')}.`

/** Errors + warnings for ONE step. Pure; never throws. */
export function validateStep(
  step: StepId, state: NewJobState, types: readonly WorkType[]
): ValidationError[] {
  const out: ValidationError[] = []
  const rules = jobRules(state.jobTypes, types)

  if (step === 1) {
    if (state.jobTypes.length === 0) {
      out.push(err('jobTypes', 'Vali vähemalt üks töö tüüp.'))
    }
    return out
  }

  if (step === 2) {
    for (let i = 0; i < state.jobTypes.length; i++) {
      const name = state.jobTypes[i]
      const r = rules.perType[i]
      if (!r || r.toothMode !== 'tooth') continue
      const teeth = state.selectedTeeth[name] ?? []

      if (r.isBridge) {
        const check = checkConsecutive(teeth)
        if (!check.ok) {
          if (check.reason === 'empty') {
            out.push(err('teeth', `Vali hambad tööle „${name}".`, name))
          } else if (check.reason === 'too-few') {
            out.push(err('teeth', `„${name}" on sild — vali vähemalt kaks hammast.`, name))
          } else if (check.reason === 'mixed-arch') {
            out.push(err('teeth', `„${name}" on sild — hambad peavad olema samas lõualuus.`, name))
          } else {
            // Name the teeth that would close the gap. `missing` is already
            // computed by checkConsecutive and was previously thrown away,
            // leaving the user to work out which tooth the bridge is short of.
            // Capped: an 18–28 selection is missing fourteen numbers, and a
            // fourteen-number list is not an instruction.
            out.push(err('teeth', `„${name}" on sild — vali järjestikused hambad ühes lõualuus.${gapHint(check.missing)}`, name))
          }
        }
        continue
      }

      if (r.requiresTeeth && teeth.length === 0) {
        out.push(err('teeth', `Vali hambad tööle „${name}".`, name))
      }
      // Never a hard limit: a lab that quotes two separate crowns as one job is
      // doing something legitimate, it just usually is not what was meant.
      if (r.suggestSingleTooth && teeth.length > 1) {
        out.push(warn('teeth', `„${name}" jaoks on valitud rohkem kui üks hammas.`, name))
      }
    }

    // One arch answer covers every arch-level type on the job, so this is asked
    // (and reported) once rather than per type.
    if (rules.archTypes.length > 0 && !state.selectedArch) {
      out.push(err('arch', 'Vali lõualuu: ülemine, alumine või mõlemad.'))
    }
    return out
  }

  if (step === 3) {
    if (state.materials.filter(m => m.trim()).length === 0) {
      out.push(err('materials', 'Vali materjal või lisa oma materjal.'))
    }
    return out
  }

  if (step === 4) {
    // A time with no date cannot be stored: valmis_aeg is one timestamp, and
    // "17:00 on no particular day" has nowhere to go.
    if (state.time && !state.deadline) {
      out.push(err('deadline', 'Määra tähtaja kuupäev või eemalda kellaaeg.'))
    }
    // Plain string compare is correct for 'YYYY-MM-DD' and avoids a timezone.
    if (state.deadline && state.date && state.deadline < state.date) {
      out.push(err('deadline', 'Tähtaeg ei saa olla enne töö vastuvõtu kuupäeva.'))
    }
    if (state.priority === 'kiirtoo') {
      out.push(warn('priority', 'Kiirtöö kahekordistab tootmishinna.'))
    }
    return out
  }

  if (step === 5) {
    if (!state.patient?.name.trim()) {
      out.push(err('patient', 'Patsiendi nimi on kohustuslik.'))
    }
    return out
  }

  // Step 6 has no rules of its own — it shows everything the other steps found.
  return validateAll(state, types)
}

/** Every step's issues, in step order. Step 6 renders this. */
export function validateAll(
  state: NewJobState, types: readonly WorkType[]
): ValidationError[] {
  const steps: StepId[] = [1, 2, 3, 4, 5]
  return steps.flatMap(s => validateStep(s, state, types))
}

/** No 'error'-severity entries for this step. */
export function canContinue(
  step: StepId, state: NewJobState, types: readonly WorkType[]
): boolean {
  return !validateStep(step, state, types).some(e => e.severity === 'error')
}

/** No 'error'-severity entries anywhere. Gates the "Loo töö" button. */
export function canCreate(state: NewJobState, types: readonly WorkType[]): boolean {
  return !validateAll(state, types).some(e => e.severity === 'error')
}
