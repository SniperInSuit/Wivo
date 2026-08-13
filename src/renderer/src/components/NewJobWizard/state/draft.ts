/**
 * The half-filled job, kept in localStorage.
 *
 * localStorage and not the database on purpose: there is no draft status in the
 * pipeline, and inventing one would put unfinished work on every board. A draft
 * is therefore local to this machine — which is what "Salvesta mustand" means
 * here, and what the wizard must say.
 *
 * Every access is wrapped: localStorage throws on a quota error and on a
 * hardened profile, and losing a draft is annoying while crashing the wizard on
 * open is not survivable.
 */
import type { NewJobState } from '@shared/wizard'

export const DRAFT_KEY = 'wivo_newjob_draft_v1'
// v2 added `modelId`, v3 added `dieShade`. An older draft has no such key, and
// a v1 draft on a Mudel job would reach StepReview's `state.modelId.trim()` as
// undefined — so old drafts are dropped rather than patched, per the rule above.
export const DRAFT_VERSION = 3 as const

export interface NewJobDraft {
  v: typeof DRAFT_VERSION
  /** ISO timestamp of the last write — shown as "Salvestatud HH:mm". */
  savedAt: string
  state: NewJobState
}

export function readDraft(): NewJobDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NewJobDraft>
    // A draft written by an older shape cannot be trusted field by field, and
    // migrating one is more code than re-asking six questions.
    if (parsed?.v !== DRAFT_VERSION || !parsed.state) {
      localStorage.removeItem(DRAFT_KEY)
      return null
    }
    return { v: DRAFT_VERSION, savedAt: parsed.savedAt ?? '', state: parsed.state }
  } catch {
    return null
  }
}

/** true when the draft actually reached localStorage. */
export function writeDraft(state: NewJobState): boolean {
  try {
    const draft: NewJobDraft = { v: DRAFT_VERSION, savedAt: new Date().toISOString(), state }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    // Quota or a blocked store — the wizard keeps working from memory, but the
    // caller must not tell the user their draft is safe when it is not.
    return false
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* nothing to do — see writeDraft */
  }
}
