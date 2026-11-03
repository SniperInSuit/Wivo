/**
 * When an old build restarts (desktop) or reloads (phone) to update —
 * docs/MIN-VERSION.md §4 and §5, Kevin's decisions: a 60-second countdown,
 * up to three postponements of 15 minutes each, never while something is
 * open. Pure, so it can be tested; the components only feed it.
 */
import { versionBelow } from './appVersion'

export const COUNTDOWN_SECONDS = 60
export const POSTPONE_MS = 15 * 60_000
export const MAX_POSTPONEMENTS = 3
/** The phone reloads at most once in this long; after that it asks. */
export const PHONE_RELOAD_GAP_MS = 10 * 60_000

export interface Minimum { min_version: string; required: boolean }

export interface DesktopInput {
  running: string
  minimum: Minimum | null
  /** The updater has the new version downloaded and staged. */
  downloaded: boolean
  /** A form, an upload, a download or a print (lib/restartGuard). */
  blocked: boolean
  postponedUntil: number
  now: number
}

/**
 * - none:      nothing required of this build
 * - fetch:     required, but the update is not downloaded yet: ask the updater
 * - wait:      required and ready, but something is open, or it was postponed
 * - countdown: required, ready, nothing open: start (or keep) the 60 s countdown
 */
export type DesktopDecision = 'none' | 'fetch' | 'wait' | 'countdown'

export function decideRequiredRestart(i: DesktopInput): DesktopDecision {
  if (!i.minimum?.required || !versionBelow(i.running, i.minimum.min_version)) return 'none'
  if (!i.downloaded) return 'fetch'
  if (i.blocked || i.now < i.postponedUntil) return 'wait'
  return 'countdown'
}

/** "Wait" is offered while postponements are left; after three, only "Restart now". */
export const canPostpone = (postponements: number): boolean => postponements < MAX_POSTPONEMENTS

export interface PhoneInput {
  running: string
  /** The minimum, or null if none applies. */
  minimum: string | null
  /** A save was refused for the version (426) in this session. */
  refused: boolean
  /** The camera is open, or something is typed (lib/restartGuard). */
  blocked: boolean
  /** When this tab last reloaded for an update (sessionStorage), or null. */
  lastReloadAt: number | null
  now: number
}

/**
 * - ok:     new enough
 * - wait:   too old, but something is open: try again later
 * - reload: too old: reload to get the new version
 * - notice: too old and reloaded only just now (the new version is not
 *           published yet, or the phone is offline): say so, with a button,
 *           rather than reload in a loop
 */
export type PhoneDecision = 'ok' | 'wait' | 'reload' | 'notice'

export function decidePhoneReload(i: PhoneInput): PhoneDecision {
  const tooOld = i.refused || (i.minimum !== null && versionBelow(i.running, i.minimum))
  if (!tooOld) return 'ok'
  if (i.lastReloadAt !== null && i.now - i.lastReloadAt < PHONE_RELOAD_GAP_MS) return 'notice'
  return i.blocked ? 'wait' : 'reload'
}
