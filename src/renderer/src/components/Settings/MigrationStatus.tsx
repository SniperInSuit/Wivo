/**
 * Which migrations have actually been run — asked of the database, not of a
 * list somebody keeps by hand.
 *
 * Migrations here are run by hand in the Supabase editor, so "did I run that
 * one" is answered by memory. Memory is wrong, and the way it turns out to be
 * wrong is a feature that silently keeps its data in localStorage, or a screen
 * that shows nothing with no error. That has now happened often enough to be
 * worth a screen of its own.
 *
 * ── How it checks ────────────────────────────────────────────────────────────
 * By SELECTING the column, `limit 0`. PostgREST answers PGRST204 / 42703 when a
 * column is missing and 42P01 when the table is. No rows are fetched and no
 * information_schema access is needed — the same request the app would make
 * anyway, just asking whether it is possible.
 *
 * A probe that fails for any OTHER reason (offline, RLS, permissions) reports
 * "ei saanud kontrollida" rather than "missing". Telling somebody to re-run a
 * migration they have already run is its own waste of an afternoon.
 */
import { useEffect, useState } from 'react'
import { Check, X, HelpCircle, RefreshCw, Database } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { t } from '@/lib/i18n'

interface Probe {
  table: string
  column: string
  mis: string
  /**
   * Probe by CALLING a function instead of selecting a column.
   *
   * A migration that only changes policies adds no column, so the comment below
   * used to say such migrations cannot be seen from here and left them out.
   * That is true of the policies — and not of the helper functions they are
   * built on. 064 is the first one it matters for: if it has not been run, the
   * permission checkboxes are decoration and the clinic has no idea, which is
   * exactly the kind of silence this screen exists to break.
   */
  rpc?: { fn: string; args: Record<string, unknown> }
}

/**
 * Only migrations that add something probeable, newest first. A migration that
 * changes a constraint or a policy cannot be seen this way and is deliberately
 * absent rather than guessed at.
 */
const PROBES: Probe[] = [
  { table: 'rpc', column: 'has_perm',
    rpc: { fn: 'has_perm', args: { perm: 'jobs.read' } },
    mis: t('settings.permissionTicksApplyOnTheServer') },
  { table: 'jobs', column: 'revisions',
    mis: t('settings.theJobsTableItselfBeforeThis') },
  { table: 'jobs', column: 'materjali_yhikud',
    mis: t('settings.howManyCapsulesAJobActually') },
  { table: 'visit_requests', column: 'id',
    mis: t('settings.requestsInRealTimeSameTable') },
  { table: 'visit_requests', column: 'soovitud_algus',
    mis: t('settings.visitFeeAndTheTimePicked') },
  { table: 'visit_requests', column: 'idempotency_key',
    mis: t('settings.visitRequestInbox') },
  { table: 'worker_payout_lines', column: 'line_key',
    mis: t('settings.aPayoutLineRemembersWhichLine') },
  { table: 'jobs', column: 'kulu_yle',
    mis: t('settings.manualCostOverride') },
  { table: 'profiles', column: 'ui_prefs',
    mis: t('settings.personalViewSettingsMyView') },
  { table: 'profiles', column: 'tasu_arvestus',
    mis: t('settings.netGrossPayAndTaxProfile') },
  { table: 'patients', column: 'turundusnousolek',
    mis: t('settings.marketingConsentAndContactExport') },
  { table: 'clinic_settings', column: 'email',
    mis: t('settings.emailSettingsAndSendingPermissions') },
  { table: 'invoices', column: 'sent_at',
    mis: t('settings.invoiceSendingSentAt') },
  { table: 'payment_plans', column: 'id',
    mis: t('settings.paymentPlans') },
  { table: 'clinic_settings', column: 'broneering',
    mis: t('settings.onlineBookingSettingsOpeningHoursVisit') },
  { table: 'clinic_settings', column: 'public_services',
    mis: t('settings.patientPriceListWithoutItThe') },
]

type State = 'ok' | 'missing' | 'unknown'

export function MigrationStatus() {
  const [state, setState] = useState<Record<string, State>>({})
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    const next: Record<string, State> = {}
    for (const p of PROBES) {
      const key = `${p.table}.${p.column}`
      try {
        const { error } = p.rpc
          ? await supabase.rpc(p.rpc.fn, p.rpc.args)
          : await supabase.from(p.table).select(p.column).limit(0)
        if (!error) { next[key] = 'ok'; continue }
        // PGRST204 / 42703 = no such column, 42P01 = no such table,
        // PGRST202 / 42883 = no such function. Anything else is a different
        // problem and must not read as "not run".
        const code = (error as { code?: string }).code ?? ''
        const msg = (error.message ?? '').toLowerCase()
        next[key] = ['PGRST204', '42703', '42P01', 'PGRST202', '42883'].includes(code)
          || msg.includes('could not find') || msg.includes('does not exist')
          ? 'missing'
          : 'unknown'
      } catch {
        next[key] = 'unknown'
      }
    }
    setState(next)
    setBusy(false)
  }

  useEffect(() => { check() }, [])

  const missing = PROBES.filter(p => state[`${p.table}.${p.column}`] === 'missing')

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Database size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('settings.migrationStatus')}</h3>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="ml-auto btn-ghost text-xs border border-ink-faint/25 flex items-center gap-1.5"
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> {t('settings.check')}
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-3">
        {t('settings.askedOfTheDatabaseNotFrom')}
      </p>

      {missing.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 mb-3">
          <p className="text-xs font-semibold text-orange-800">{t('settings.notAvailableN', { n: missing.length })}</p>
          <p className="text-[11px] text-orange-700 mt-0.5">{t('app.contactSupport')}</p>
        </div>
      )}

      <div className="space-y-1">
        {PROBES.map(p => {
          const s = state[`${p.table}.${p.column}`]
          return (
            <div key={`${p.table}.${p.column}`} className="flex items-start gap-2">
              {s === 'ok' && <Check size={12} className="text-emerald-600 flex-shrink-0 mt-0.5" />}
              {s === 'missing' && <X size={12} className="text-red-500 flex-shrink-0 mt-0.5" />}
              {(s === 'unknown' || !s) && (
                <HelpCircle size={12} className="text-ink-faint flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className={`text-xs ${s === 'missing' ? 'text-ink' : 'text-ink-muted'}`}>
                  {p.mis}
                </p>
                <p className="text-[10px] text-ink-faint font-mono">
                  {p.table}.{p.column}
                  {s === 'unknown' && t('settings.couldNotCheck')}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
