/**
 * Searching the audit log (sql/105 audit_search): the filters as the database
 * takes them, paging, and the CSV. The CSV holds exactly the columns the
 * screen shows — nothing the audit log does not already show.
 *
 * Edits (sql/114, docs/AUDIT.md) are read here into a line: "Teeth 11,21 →
 * 11,21,22 · Material Zirkoon → E.max · Description changed". Members and
 * clients are named from the clinic's own lists (`Names`); a patient is only
 * ever their id, as the log holds them.
 */
import { format } from 'date-fns'
import type { CsvColumn } from '@shared/export/csv'
import type { MessageKey } from '@shared/i18n'
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

/** Names for the ids an entry holds: the clinic's members and clients. Anyone not in it has left. */
export type Names = ReadonlyMap<string, string>
const NO_NAMES: Names = new Map()

/** Every kind of entry the log holds (sql/114 audit_log_action_valid). */
export const AUDIT_ACTIONS = [
  'create', 'edit', 'view', 'download', 'upload', 'file_deleted', 'share', 'unshare', 'stage_move', 'partnership',
  'export', 'question', 'delete', 'restore', 'permission', 'stock_override', 'mfa_added', 'mfa_removed', 'mfa_reset',
  'account_deleted',
] as const

export function actionLabel(a: string): string {
  return ({
    view: t('audit.view'), download: t('audit.download'), upload: t('audit.upload'), share: t('audit.share'),
    unshare: t('audit.unshare'), stage_move: t('audit.stageMove'), partnership: t('audit.partnership'),
    export: t('audit.export'), question: t('audit.question'),
    delete: t('audit.delete'), restore: t('audit.restore'), stock_override: t('audit.stockOverride'),
    mfa_added: t('audit.mfaAdded'), mfa_removed: t('audit.mfaRemoved'), mfa_reset: t('audit.mfaReset'),
    account_deleted: t('audit.accountDeleted'),
    create: t('audit.create'), edit: t('audit.edit'), permission: t('audit.permission'), file_deleted: t('audit.fileDeleted'),
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

// ── Edits (sql/114) ─────────────────────────────────────────────────────────

/** The fields an edit names: jobs, work items, remakes, patients and the tooth chart (audit_field_rules). */
const FIELD_LABELS: Record<string, MessageKey> = {
  too: 'auditField.workType', materjal: 'auditField.material', varv: 'auditField.shade', kondivarv: 'auditField.stumpShade',
  masina: 'auditField.machine', hambad: 'auditField.teeth', kiirtoo: 'auditField.rush', mudel: 'auditField.model',
  materjali_yhikud: 'auditField.materialUnits', assigned_to: 'auditField.technician', designed_by: 'auditField.designer',
  kuupaev: 'auditField.received', valmis_aeg: 'auditField.deadline', valmis_kuupaev: 'auditField.finished',
  delivery_status: 'auditField.delivery', delivered_at: 'auditField.delivered', customer_id: 'auditField.client',
  patient_id: 'auditField.patient', hind: 'auditField.price', disain_hind: 'auditField.designPrice', makstud: 'auditField.paid',
  makse_kuupaev: 'auditField.paymentDate', extras: 'auditField.extras', kulu_yle: 'auditField.costOverrides',
  rev_hambad: 'auditField.remakeTeeth', rev_varv: 'auditField.remakeShade', uus_valmis: 'auditField.newDeadline',
  status: 'auditField.stage', patsient: 'auditField.patientName', kirjeldus: 'auditField.description',
  muudatused: 'auditField.changeNotes', customer_ref: 'auditField.clientReference', print_id: 'auditField.printId',
  disain_id: 'auditField.designId', mudel_id: 'auditField.modelId', extra_costs: 'auditField.extraCosts',
  markused: 'auditField.notes',
  // a work item
  bridge: 'auditField.bridge', implantaadid: 'auditField.implants', kruvi: 'auditField.abutment',
  kruvid: 'auditField.abutmentsPerTooth', disain_hambad: 'auditField.designedTeeth', note: 'auditField.note',
  // a remake
  reasons: 'auditField.reasons', reason: 'auditField.reasons', purunenud_hambad: 'auditField.brokenTeeth',
  deadline: 'auditField.deadline', price: 'auditField.price', taspidev: 'auditField.billable',
  uusi_tarvikuid: 'auditField.newParts',
  // a patient
  nimi: 'auditField.name', synniaeg: 'auditField.birthDate', telefon: 'auditField.phone', email: 'auditField.email',
  arst: 'auditField.doctor', kliinik: 'auditField.referringClinic', ravikaart: 'auditField.medicalCard',
  allergiad: 'auditField.allergies', eelistused: 'auditField.preferences', lougad: 'auditField.jaws',
  markmed: 'auditField.notes', varvi_eelistus: 'auditField.shadePreference', lougaliiges: 'auditField.jawJoint',
  turundusnousolek: 'auditField.marketingConsent', nousoleku_aeg: 'auditField.consentTime',
  // the tooth chart
  staatus: 'auditField.toothStatus', markus: 'auditField.note',
}

const fieldLabel = (k: string): string => (FIELD_LABELS[k] ? t(FIELD_LABELS[k]) : k)

const MEMBER_FIELDS = new Set(['assigned_to', 'designed_by'])
const BOOLEAN_FIELDS = new Set(['kiirtoo', 'mudel', 'makstud', 'bridge', 'taspidev'])
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

const CODE_LABELS: Record<string, Record<string, MessageKey>> = {
  turundusnousolek: { jah: 'patient.allowed', ei: 'patient.declined', kysimata: 'patient.notAsked' },
  staatus: { ravi: 'audit.toothTreatment', puudub: 'audit.toothMissing', terve: 'audit.toothHealthy' },
}

const PERMISSION_LABELS: Record<string, MessageKey> = {
  'jobs.read': 'usePermissions.viewJobs', 'jobs.write': 'usePermissions.editJobs', 'jobs.delete': 'usePermissions.deleteJobs',
  'patients.read': 'usePermissions.viewPatients', 'patients.write': 'usePermissions.editPatients',
  'visits.read': 'usePermissions.viewVisits', 'visits.write': 'usePermissions.manageVisits',
  'stats.read': 'usePermissions.viewStatistics', 'payments.read': 'usePermissions.viewPayments',
  'payments.write': 'usePermissions.managePayments', 'settings.read': 'usePermissions.viewSettings',
  'pipeline.write': 'usePermissions.editStages', 'payroll.manage': 'usePermissions.managePayroll',
  'stock.read': 'usePermissions.viewStock', 'stock.write': 'usePermissions.manageStock',
}

const ROLE_LABELS: Record<string, MessageKey> = {
  owner: 'audit.roleOwner', admin: 'audit.roleAdmin', doctor: 'audit.roleDoctor', technician: 'audit.roleTechnician',
  assistant: 'audit.roleAssistant', worker: 'audit.roleTechnician',
}

const FILE_TYPE_LABELS: Record<string, MessageKey> = {
  scan: 'files.typeScan', photo: 'files.typePhoto', xray: 'files.typeXray', print: 'files.typePrint',
  design: 'files.typeDesign', other: 'files.typeOther',
}

const label = (labels: Record<string, MessageKey>, v: string): string => (labels[v] ? t(labels[v]) : v)

/** A patient as the log names them: by id, never by name. */
export const patientShort = (id: string): string => t('audit.patientShort', { id: id.slice(0, 8) })

function valueText(field: string, v: unknown, names: Names): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (MEMBER_FIELDS.has(field)) return s === 'job' ? t('audit.asOnJob') : s === '' ? t('audit.nobody') : names.get(s) ?? t('audit.formerMember')
  if (BOOLEAN_FIELDS.has(field)) return s === 'true' ? t('audit.yes') : t('audit.no')
  if (field === 'staatus' && s === '') return t('audit.toothUnmarked')
  if (s === '') return '—'
  if (field === 'customer_id') return names.get(s) ?? t('audit.formerClient')
  if (field === 'patient_id') return patientShort(s)
  if (CODE_LABELS[field]) return label(CODE_LABELS[field], s)
  if (ISO_TIME.test(s)) return format(new Date(s), 'd MMM yyyy HH:mm', { locale: dateLocale })
  return s
}

type Item = { item?: string; remake?: number; change?: string; changes?: Record<string, unknown> }

/** One work item or remake: "Added: Kroon 22", "Remake 1: Teeth 11 → 11,12". */
function listText(list: unknown, names: Names): string[] {
  if (!Array.isArray(list)) return []
  return (list as Item[]).map(x => {
    const name = typeof x.remake === 'number' ? t('audit.remake', { n: x.remake }) : String(x.item ?? '')
    if (x.change === 'added') return t('audit.added', { item: name })
    if (x.change === 'removed') return t('audit.removed', { item: name })
    return `${name}: ${changesText(x.changes, names).join(', ')}`
  })
}

/** The changes of one row or element, each as "Field old → new" or "Field changed". */
function changesText(changes: unknown, names: Names): string[] {
  if (!changes || typeof changes !== 'object') return []
  return Object.entries(changes as Record<string, unknown>).flatMap(([k, v]) => {
    if (k === 'unreadable') return [t('audit.unreadable')]
    if (k === 'work_items') return listText(v, names)
    if (v === 'changed') return [t('audit.fieldChanged', { field: fieldLabel(k) })]
    if (v === 'added') return [t('audit.noteAdded')]
    if (v && typeof v === 'object' && 'new' in v) {
      const { old, new: now } = v as { old: unknown; new: unknown }
      return [`${fieldLabel(k)} ${valueText(k, old, names)} → ${valueText(k, now, names)}`]
    }
    return [fieldLabel(k)]
  })
}

function editText(d: Record<string, unknown>, names: Names): string {
  if (d.unreadable) return t('audit.unreadable')
  const parts = [...changesText(d.changes, names), ...listText(d.work_items, names), ...listText(d.remakes, names)]
  return typeof d.tooth === 'number' ? `${t('audit.tooth', { n: d.tooth })}: ${parts.join(', ')}` : parts.join(' · ')
}

function permissionText(d: Record<string, unknown>): string {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(p => label(PERMISSION_LABELS, String(p))).join(', ') : '')
  const role = d.role as { old?: string; new?: string } | undefined
  return [
    Array.isArray(d.granted) && d.granted.length ? t('audit.granted', { list: list(d.granted) }) : '',
    Array.isArray(d.removed) && d.removed.length ? t('audit.revoked', { list: list(d.removed) }) : '',
    role ? t('audit.roleChange', { old: label(ROLE_LABELS, String(role.old ?? '')), new: label(ROLE_LABELS, String(role.new ?? '')) }) : '',
  ].filter(Boolean).join(' · ')
}

/** The detail column. */
export function describeEntry(e: AuditEntry, names: Names = NO_NAMES): string {
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
  // sql/114: edits, permissions, a deleted file.
  if (e.action === 'edit') return editText(d, names)
  if (e.action === 'permission') return permissionText(d)
  if (e.action === 'file_deleted') return t('audit.fileDeletedDetail', { type: label(FILE_TYPE_LABELS, String(d.type ?? '')), version: Number(d.version ?? 0) })
  return ''
}

export const entryWhen = (e: AuditEntry): string => format(new Date(e.at), 'd MMM yyyy HH:mm:ss', { locale: dateLocale })
export const entryWho = (e: AuditEntry): string => e.user_name || t('audit.system')

/** The patient an entry is about, if any: their id. */
export const entryPatient = (e: AuditEntry): string | null => (e.object.startsWith('patient:') ? e.object.slice(8) : null)

/** What the entry is about: a job's code, a patient's short id, a member's name, an export. Never a raw id. */
export function entryWhat(e: AuditEntry, names: Names = NO_NAMES): string {
  if (e.job_code) return e.job_code
  if (e.object.startsWith('csv:')) return `CSV: ${exportKindLabel(e.object.slice(4))}`
  const patient = entryPatient(e)
  if (patient) return patientShort(patient)
  if (e.object.startsWith('user:')) return names.get(e.object.slice(5)) ?? t('audit.formerMember')
  return e.object
}

// ── The patient's tooth chart: one entry per click, one row on screen ───────

export const isChartEntry = (e: AuditEntry): boolean =>
  e.action === 'edit' && e.object.startsWith('patient:') && typeof e.detail?.tooth === 'number'

export type AuditRow =
  | { kind: 'entry'; entry: AuditEntry }
  | { kind: 'chart'; entries: AuditEntry[] }

/**
 * Consecutive chart clicks by the same person on the same patient become one
 * row that expands. Only how they are shown: every entry stays as stored.
 */
export function groupRows(rows: AuditEntry[]): AuditRow[] {
  const out: AuditRow[] = []
  for (const e of rows) {
    const last = out[out.length - 1]
    if (isChartEntry(e) && last && (last.kind === 'chart' || isChartEntry(last.entry))) {
      const first = last.kind === 'chart' ? last.entries[0] : last.entry
      if (first.object === e.object && first.user_name === e.user_name) {
        if (last.kind === 'chart') last.entries.push(e)
        else out[out.length - 1] = { kind: 'chart', entries: [last.entry, e] }
        continue
      }
    }
    out.push({ kind: 'entry', entry: e })
  }
  return out
}

/** A grouped row's line: "Tooth chart: 3 changes (16, 21, 22)". */
export function chartSummary(entries: AuditEntry[]): string {
  const teeth = [...new Set(entries.map(e => Number(e.detail.tooth)))].sort((a, b) => a - b)
  return t('audit.chartChanges', { n: entries.length, teeth: teeth.join(', ') })
}

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

/** The CSV: the screen's columns, in its words; one line per entry, as stored. */
export function auditCsvColumns(names: Names = NO_NAMES): CsvColumn<AuditEntry>[] {
  return [
    { header: t('audit.when'), value: entryWhen },
    { header: t('audit.who'), value: entryWho },
    { header: t('audit.action'), value: e => actionLabel(e.action) },
    { header: t('audit.what'), value: e => entryWhat(e, names) },
    { header: t('audit.detail'), value: e => describeEntry(e, names) },
  ]
}

/** The most rows one CSV takes; above it the export says to narrow the search. */
export const CSV_MAX_ROWS = 10_000
