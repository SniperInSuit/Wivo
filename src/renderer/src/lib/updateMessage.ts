/**
 * What an update failure says, in the user's language.
 *
 * ── Why both screens call this instead of reading `state.message` ───────────
 * `message` is written in the MAIN process, which has no access to the
 * interface language — so whatever it says is said in one fixed language to
 * everybody. Every failure a person can actually be shown therefore carries a
 * `code`, and this is the single place that turns a code into words.
 *
 * The fallback is still `message`, because a failure nobody foresaw is better
 * reported in the wrong language than swallowed. It is English in the main
 * process for the same reason English is this app's source language.
 */
import { t } from './i18n'
import type { UpdateState } from '../../../types/update'

type Failed = Extract<UpdateState, { stage: 'failed' }>

export function updateFailureText(state: Failed): string {
  switch (state.code) {
    case 'unsigned': return t('updateBanner.notSignedByWivo')
    case 'noSpace': return t('updateBanner.noDiskSpace')
    case 'downloadFailed': return t('updateBanner.downloadFailed')
    case 'installFailed': return t('updateBanner.installFailed', { version: state.version ?? '' })
    case 'devBuild': return t('updateBanner.installedBuildOnly')
    case 'checkFailed': return t('updateBanner.checkFailed')
    default: return state.message
  }
}
