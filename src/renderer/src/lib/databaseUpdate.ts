/**
 * "Database update ready", for approvers (docs/ARCHITECTURE-INSTANCES.md 5b):
 * which version the clinic's own list offers, and asking the clinic's own
 * `wivo-update` to install it, or to check the list now. The function checks
 * everything itself (signature, list, package, ledger); the app only asks.
 */
import { compareVersions, type IndexEntry } from '@shared/release/release'
import { t } from '@/lib/i18n'
import { supabase } from './supabase'
import type { UpdateStatus } from './updateStatus'

/**
 * The newest version the list offers above the installed one, not
 * withdrawn. None while the list is stale: installs wait until a current
 * list arrives (5g), and the stale warning says so instead.
 */
export function pendingDatabaseUpdate(status: UpdateStatus | null): IndexEntry | null {
  if (!status || status.stale || !status.list?.content || !status.installed) return null
  const installed = status.installed.version
  const withdrawn = new Set(status.list.content.withdrawn.map(w => w.version))
  return status.list.content.versions
    .filter(e => compareVersions(e.version, installed) > 0 && !withdrawn.has(e.version))
    .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null
}

/** What `wivo-update` answered, as a person reads it. Unknown codes are shown as they are, for support. */
export function updateReasonText(reason: string): string {
  if (reason.includes(' ')) return t('dbUpdate.reasonFailed', { code: reason })
  if (reason.startsWith('list_')) return t('dbUpdate.reasonList')
  const known: Record<string, Parameters<typeof t>[0]> = {
    not_approver: 'dbUpdate.reasonNotApprover',
    not_fresh: 'dbUpdate.reasonNotFresh',
    sign_in: 'dbUpdate.reasonNotFresh',
    not_newer: 'dbUpdate.reasonNotNewer',
    too_old: 'dbUpdate.reasonTooOld',
    withdrawn: 'dbUpdate.reasonWithdrawn',
    not_listed: 'dbUpdate.reasonNotListed',
    package_unreachable: 'dbUpdate.reasonUnreachable',
    functions_not_yet: 'dbUpdate.reasonFunctionsNotYet',
    ledger_changed: 'dbUpdate.reasonHistory',
    ledger_missing: 'dbUpdate.reasonHistory',
    out_of_order: 'dbUpdate.reasonHistory',
    not_set_up: 'dbUpdate.reasonHistory',
  }
  return known[reason] ? t(known[reason]) : t('dbUpdate.reasonOther', { code: reason })
}

export type UpdateAnswer = { ok: true; to?: string } | { ok: false; reason: string }

async function call(body: Record<string, unknown>): Promise<UpdateAnswer> {
  const { data, error } = await supabase.functions.invoke('wivo-update', { body, timeout: 300_000 })
  if (error) {
    // A non-2xx answer: the function's own body says why.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context
    const answer = (await context?.json?.().catch(() => null)) as { error?: string } | null
    return { ok: false, reason: answer?.error ?? 'no_answer' }
  }
  const d = data as { ok?: boolean; to?: string; reason?: string } | null
  return d?.ok ? { ok: true, to: d.to } : { ok: false, reason: d?.reason ?? 'failed' }
}

/** Installs `version`. Call it right after a fresh code (FreshCodeDialog): the function asks for one under 5 minutes old. */
export const installDatabaseUpdate = (version: string) => call({ action: 'install', version })

/** Fetches and checks the list now, instead of at the night's check. */
export const checkDatabaseUpdates = () => call({ action: 'check' })
