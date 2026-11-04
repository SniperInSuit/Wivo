/**
 * Searching the audit log (sql/105 audit_search): the filters as the database
 * takes them, paging, and the CSV. The CSV holds exactly the columns the
 * screen shows — nothing the audit log does not already show.
 */
import { format } from 'date-fns'
import type { CsvColumn } from '@shared/export/csv'
import { t, dateLocale } from '@/lib/i18n'

export interface AuditEntry {
  id: number
  at: string
  user_name: string | null
  action: string
  object: string
  job_code: string | null
  detail: Record<string, unknown>
}

/** Every kind of entry the log holds (sql/097 audit_log_action_valid). */
export const AUDIT_ACTIONS = [
  'view', 'download', 'upload', 'share', 'unshare', 'stage_move', 'partnership', 'export', 'question',
  'delete', 'restore', 'stock_override', 'mfa_added', 'mfa_removed', 'mfa_reset', 'account_deleted',
] as const

export function actionLabel(a: string): string {
  return ({
    view: t('audit.view'), download: t('audit.download'), upload: t('audit.upload'), share: t('audit.share'),
    unshare: t('audit.unshare'), stage_move: t('audit.stageMove'), partnership: t('audit.partnership'),
    export: t('audit.export'), question: t('audit.question'),
    delete: t('audit.delete'), restore: t('audit.restore'), stock_override: t('audit.stockOverride'),
    mfa_added: t('audit.mfaAdded'), mfa_removed: t('audit.mfaRemoved'), mfa_reset: t('audit.mfaReset'),
    account_deleted: t('audit.accountDeleted'),
  } as Record<string, string>)[a] ?? a
}

/** The CSV exports (sql/106), by the name the screen gives them. */
export function exportKindLabel(kind: string): string {
  return ({
    audit_log: t('audit.csvAuditLog'), jobs: t('audit.csvJobs'), customers: t('audit.csvCustomers'),
    invoices: t('audit.csvInvoices'), patient_contacts: t('audit.csvPatientContacts'), payouts: t('audit.csvPayouts'),
    payout_lines: t('audit.csvPayoutLines'), revision_repricing: t('audit.csvRevisionRepricing'),
  } as Record<string, string>)[kind] ?? kind
}

/** A recorded export's filters, short: "Stage: print · Search". */
export function filtersText(filters: unknown): string {
  if (!filters || typeof filters !== 'object') return ''
  const label = (k: string): string => ({
    search: t('audit.fSearch'), stage: t('audit.fStage'), period: t('audit.fPeriod'), workTypes: t('audit.fWorkTypes'),
    pay: t('audit.fPay'), revisions: t('audit.fRevisions'), debtors: t('audit.fDebtors'), archived: t('audit.fArchived'),
    status: t('audit.fStatus'), person: t('audit.who'), action: t('audit.action'), jobCode: t('audit.jobCode'),
    from: t('audit.from'), to: t('audit.to'),
  } as Record<string, string>)[k] ?? k
  return Object.entries(filters as Record<string, unknown>).map(([k, v]) => {
    if (v === true) return label(k)
    const value = Array.isArray(v) ? v.join(', ') : k === 'action' ? actionLabel(String(v)) : String(v)
    return `${label(k)}: ${value}`
  }).join(' · ')
}

/** The detail column, as the screen has always shown it. */
export function describeEntry(e: AuditEntry): string {
  const d = e.detail ?? {}
  if (e.action === 'stage_move') return `${d.from ?? ''} → ${d.to ?? ''}`
  if (e.action === 'partnership') return String(d.step ?? '')
  // A CSV export (sql/106): how many rows and with which filters.
  if (e.action === 'export' && typeof d.kind === 'string') {
    const f = filtersText(d.filters)
    return [t('audit.rows', { n: Number(d.rows ?? 0) }), f].filter(Boolean).join(' · ')
  }
  if (e.action === 'export') return t('audit.files', { n: Number(d.files ?? 0) })
  // Two-factor sign-in (sql/097): whose, which authenticator, why.
  if (e.action === 'mfa_added') return String(d.name ?? '')
  if (e.action === 'mfa_removed') return t('audit.mfaRemovedDetail', { name: String(d.name ?? ''), how: d.how === 'password' ? t('audit.byPassword') : t('audit.byCode') })
  if (e.action === 'mfa_reset') return t('audit.mfaResetDetail', { who: String(d.target_name ?? ''), reason: String(d.reason ?? '') })
  // An account deleted for good (sql/110): whose.
  if (e.action === 'account_deleted') return String(d.target_name ?? '')
  return ''
}

export const entryWhen = (e: AuditEntry): string => format(new Date(e.at), 'd MMM yyyy HH:mm:ss', { locale: dateLocale })
export const entryWho = (e: AuditEntry): string => e.user_name || t('audit.system')
export const entryWhat = (e: AuditEntry): string =>
  e.job_code ?? (e.object.startsWith('csv:') ? `CSV: ${exportKindLabel(e.object.slice(4))}` : e.object)

export interface AuditFilters {
  userId: string
  action: string
  jobCode: string
  /** yyyy-MM-dd, this computer's day; both ends included. Empty: open. */
  from: string
  to: string
}

export const NO_FILTERS: AuditFilters = { userId: '', action: '', jobCode: '', from: '', to: '' }

/** A local day → the moment it starts. */
function dayStart(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** The filters as audit_search takes them: from the start of the first day to the start of the day after the last. */
export function filterArgs(f: AuditFilters): Record<string, string | null> {
  const from = dayStart(f.from)
  const to = dayStart(f.to)
  if (to) to.setDate(to.getDate() + 1)
  return {
    p_user: f.userId || null,
    p_action: f.action || null,
    p_job_code: f.jobCode.trim() || null,
    p_from: from ? from.toISOString() : null,
    p_to: to ? to.toISOString() : null,
  }
}

/** Where the next page starts: after the last row of this one. */
export interface Cursor { at: string; id: number }
export const cursorAfter = (rows: AuditEntry[]): Cursor | null =>
  rows.length ? { at: rows[rows.length - 1].at, id: rows[rows.length - 1].id } : null

/** The CSV: the screen's columns, in its words. */
export const AUDIT_CSV_COLUMNS: CsvColumn<AuditEntry>[] = [
  { header: t('audit.when'), value: entryWhen },
  { header: t('audit.who'), value: entryWho },
  { header: t('audit.action'), value: e => actionLabel(e.action) },
  { header: t('audit.what'), value: entryWhat },
  { header: t('audit.detail'), value: describeEntry },
]

/** The most rows one CSV takes; above it the export says to narrow the search. */
export const CSV_MAX_ROWS = 10_000
