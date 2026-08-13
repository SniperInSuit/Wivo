/**
 * The wizard's one piece of state.
 *
 * Every step writes through `patch` and nothing else keeps a copy — a step that
 * held its own useState would lose it the moment the user pressed Tagasi, which
 * is the single most damaging thing a six-step form can do.
 *
 * The hook also owns the two things that are easy to bolt on badly: the
 * localStorage draft (debounced, so typing a patient name is not 20 writes) and
 * `showErrors`, which stays false until a blocked Continue is pressed. Shouting
 * "Patsiendi nimi on kohustuslik" at someone who has just opened step 5 is how
 * a form teaches people to ignore its errors.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkTypes } from '@/stores/useSettings'
import type {
  JobRules, NewJobState, NewJobStateInit, StepId, ValidationError,
} from '@shared/wizard'
import {
  canContinue as canContinueStep,
  canCreate as canCreateJob,
  createEmptyNewJobState,
  jobRules,
  maxReachableStep,
  nextStep,
  prevStep,
  validateStep,
} from '@shared/wizard'
import type { WorkType } from '@shared/pricing/workTypes'
import { clearDraft, readDraft, writeDraft } from './draft'

export interface UseNewJobWizard {
  state: NewJobState
  rules: JobRules
  /** Shallow merge. The only mutator every step gets. */
  patch: (patch: Partial<NewJobState>) => void
  goToStep: (step: StepId) => void
  goNext: () => void
  goBack: () => void
  maxStep: StepId
  errors: ValidationError[]
  showErrors: boolean
  canContinue: boolean
  canCreate: boolean
  isDirty: boolean
  draftSavedAt: string | null
  /** false → localStorage refused it; the draft is NOT saved. */
  saveDraft: () => boolean
  discardDraft: () => void
  /** true when a draft was auto-restored on mount (shell shows the banner). */
  restored: boolean
  /** Work types that were in the draft and no longer exist in Seaded. Named in
   *  the restore banner — the user CAN act on this by re-picking the renamed
   *  type, so dropping them silently was hiding a decision from them. */
  droppedTypes: string[]
  /** 'YYYY-MM-DD' when a restored draft's deadline was replaced by the day the
   *  user just clicked in the calendar. null when nothing was overridden. */
  seededDeadline: string | null
}

/** How long to wait after the last keystroke before writing the draft. */
const DRAFT_DEBOUNCE_MS = 400

interface Sanitized {
  state: NewJobState
  /** Names that were in the draft's jobTypes and are no longer in Seaded. */
  dropped: string[]
  /** The deadline taken from `init` in preference to the draft's own. */
  seededDeadline: string | null
}

/**
 * Make a restored draft safe to render.
 *
 * A draft is JSON that has been sitting on a user's disk, possibly for weeks,
 * possibly written by an earlier build. Three things can be wrong with it, and
 * all three are fatal further down:
 *
 *  1. MISSING FIELDS. Anything absent is read straight into validation, where
 *     `state.materials.filter(…)` on undefined throws — and the wizard is
 *     rendered from App, so that crash takes the whole window. Merging over a
 *     fresh state means an unknown-shaped draft degrades to blank fields.
 *  2. DELETED WORK TYPES. A type the lab has since renamed or removed in Seaded
 *     no longer matches by name. It is dropped — but REPORTED, and the step is
 *     forced back to 1, because a draft saved on step 6 whose bridge silently
 *     vanished would otherwise be created from a review page that lost a work
 *     item without saying so.
 *  3. AN IMPOSSIBLE STEP. `currentStep` indexes WIZARD_STEPS and the step
 *     lookup table; out of range renders `undefined.title`.
 *
 * `init` wins over the draft for the deadline. The user clicked a specific slot
 * in the calendar a second ago; the draft's date is from last week. Silently
 * keeping the older answer meant clicking 12 September opened a job due on the
 * 3rd, with nothing on screen admitting it.
 */
function sanitize(
  state: NewJobState, types: readonly WorkType[], init: NewJobStateInit
): Sanitized {
  const base = createEmptyNewJobState()
  const merged: NewJobState = { ...base, ...state }

  const known = new Set(types.map(t => t.nimi))
  const asked = Array.isArray(merged.jobTypes) ? merged.jobTypes : []
  merged.jobTypes = asked.filter(t => known.has(t))
  const dropped = asked.filter(t => !known.has(t))

  merged.selectedTeeth = merged.selectedTeeth ?? {}
  merged.materialByType = (merged.materialByType && typeof merged.materialByType === 'object')
    ? merged.materialByType
    : {}
  merged.pricing = { ...base.pricing, ...(merged.pricing ?? {}) }
  // A draft is never resumed mid-insert.
  merged.status = 'draft'

  let seededDeadline: string | null = null
  if (init.deadline && init.deadline !== merged.deadline) {
    merged.deadline = init.deadline
    merged.time = init.time ?? merged.time
    // Applied together: NewJobStateInit only carries a `date` when the clicked
    // day is in the past, and a deadline before the received date is a blocking
    // step-4 error the user never typed.
    if (init.date) merged.date = init.date
    seededDeadline = init.deadline
  }

  const step = Number(merged.currentStep)
  const inRange = (Number.isInteger(step) && step >= 1 && step <= 6 ? step : 1) as StepId
  // Anything dropped sends the user back to step 1 to re-confirm the type list
  // rather than reviewing a job that quietly changed under them.
  merged.currentStep = dropped.length > 0
    ? 1
    : Math.min(inRange, maxReachableStep(merged, types)) as StepId

  return { state: merged, dropped, seededDeadline }
}

/** Navigation and status are not user data — moving between steps is not an
 *  unsaved change, and the close dialog must not claim it is. */
const dataOf = (s: NewJobState): string => {
  const { currentStep: _step, status: _status, ...data } = s
  return JSON.stringify(data)
}

export function useNewJobWizard(init: NewJobStateInit): UseNewJobWizard {
  const { types } = useWorkTypes()

  // `init` is captured once: the wizard is mounted fresh per open, and a
  // changing initial date must not overwrite what the user has already typed.
  const [boot] = useState(() => {
    const draft = readDraft()
    if (draft) {
      const clean = sanitize(draft.state, types, init)
      return {
        state: clean.state,
        restored: true,
        savedAt: draft.savedAt || null,
        dropped: clean.dropped,
        seededDeadline: clean.seededDeadline,
      }
    }
    return {
      state: createEmptyNewJobState(init),
      restored: false,
      savedAt: null as string | null,
      dropped: [] as string[],
      seededDeadline: null as string | null,
    }
  })

  const [state, setState] = useState<NewJobState>(boot.state)
  const [restored, setRestored] = useState(boot.restored)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(boot.savedAt)
  const [showErrors, setShowErrors] = useState(false)
  const pristine = useRef(dataOf(boot.state))

  const rules = useMemo(() => jobRules(state.jobTypes, types), [state.jobTypes, types])
  const errors = useMemo(
    () => validateStep(state.currentStep, state, types), [state, types]
  )
  const maxStep = useMemo(() => maxReachableStep(state, types), [state, types])
  const isDirty = useMemo(() => dataOf(state) !== pristine.current, [state])

  // A plain shallow merge. The arch auto-fill that used to live here wrote
  // selectedTeeth entries for arch-mode types, and nothing read them:
  // wizardWorkItems() derives an arch type's teeth from `selectedArch` itself.
  const patch = useCallback((next: Partial<NewJobState>) => {
    setState(prev => ({ ...prev, ...next }))
  }, [])

  const goToStep = useCallback((step: StepId) => {
    setState(prev => {
      // Forward jumps past an unanswered required question are refused here as
      // well as disabled in the tracker — a keyboard user can reach anything.
      if (step > maxReachableStep(prev, types)) return prev
      return { ...prev, currentStep: step }
    })
    setShowErrors(false)
  }, [types])

  const goNext = useCallback(() => {
    if (!canContinueStep(state.currentStep, state, types)) {
      setShowErrors(true)
      return
    }
    setState(prev => ({ ...prev, currentStep: nextStep(prev.currentStep, jobRules(prev.jobTypes, types)) }))
    setShowErrors(false)
  }, [state, types])

  const goBack = useCallback(() => {
    setState(prev => ({ ...prev, currentStep: prevStep(prev.currentStep, jobRules(prev.jobTypes, types)) }))
    setShowErrors(false)
  }, [types])

  const saveDraft = useCallback((): boolean => {
    const ok = writeDraft(state)
    if (ok) setDraftSavedAt(new Date().toISOString())
    return ok
  }, [state])

  const discardDraft = useCallback(() => {
    clearDraft()
    const fresh = createEmptyNewJobState(init)
    pristine.current = dataOf(fresh)
    setState(fresh)
    setDraftSavedAt(null)
    setRestored(false)
    setShowErrors(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init is captured once, see boot
  }, [])

  // Autosave. Debounced because every keystroke in a text field is a state
  // change, and JSON.stringify on each one is measurable on a slow machine.
  useEffect(() => {
    if (!isDirty || state.status !== 'draft') return
    const t = setTimeout(() => {
      writeDraft(state)
      setDraftSavedAt(new Date().toISOString())
    }, DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [state, isDirty])

  return {
    state,
    rules,
    patch,
    goToStep,
    goNext,
    goBack,
    maxStep,
    errors,
    showErrors,
    canContinue: canContinueStep(state.currentStep, state, types),
    canCreate: canCreateJob(state, types),
    isDirty,
    draftSavedAt,
    saveDraft,
    discardDraft,
    restored,
    droppedTypes: boot.dropped,
    seededDeadline: boot.seededDeadline,
  }
}
