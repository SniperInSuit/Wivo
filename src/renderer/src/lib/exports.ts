/**
 * What each screen exports, and the browser side of saving it.
 *
 * The column sets live here rather than in the components so that "what is in
 * the jobs export" is one answer, findable, and reviewable next to the others —
 * an accountant asking "why is VAT missing" should not need to read a React
 * component to find out.
 */
import { toCsv, csvFileName, type CsvColumn } from '@shared/export/csv'
// @shared/i18n, not ./i18n: that module touches `document` and `window` when
// it loads, and node tests import this file. Same reason as types/invoice.ts.
import { t } from '@shared/i18n'
import type { Job } from '../types/job'
import { jobDesigners } from '../types/job'
import type { InvoiceFull } from '../types/invoice'
import type { Customer } from '../types/customer'
import type { Patient } from '../types/patient'
import { CONSENT_KEY } from '../types/patient'
import type { WorkerPayout } from '../hooks/useWorkerPay'
import { DELIVERY_KEY } from '../types/customer'
import { INVOICE_STATUS_KEY, outstanding, paidAmount } from '../types/invoice'
import { jobTotalValue } from './jobPayments'

/** Trigger a download. The only part of exporting that touches the DOM. */
export function downloadCsv(filename: string, csv: string): void {
  // text/csv rather than a generic blob: Windows then offers Excel by default.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Revoking immediately can cancel the download in some builds; a tick is
  // enough for the browser to have taken it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Any file, as a download: for a ZIP of several CSVs (exportAudit `auditedZipExport`). */
export function downloadFile(filename: string, data: Uint8Array, type: string): void {
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv<T>(
  base: string, rows: T[], columns: CsvColumn<T>[]
): void {
  downloadCsv(csvFileName(base, new Date()), toCsv(rows, columns))
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export function jobColumns(
  stageLabel: (key: string) => string,
  customerName: (id: string | null) => string,
  workerName: (id: string | null) => string,
  money = true,
): CsvColumn<Job>[] {
  const columns: CsvColumn<Job>[] = [
    { header: t('exports.date'),       value: j => j.kuupaev },
    { header: t('exports.status'),       value: j => stageLabel(j.status) },
    { header: t('exports.customer'),       value: j => customerName(j.customer_id) },
    { header: t('exports.customerRef'), value: j => j.customer_ref },
    { header: t('exports.patient'),      value: j => j.patsient },
    { header: t('exports.work'),           value: j => j.too },
    { header: t('exports.material'),      value: j => j.materjal },
    { header: t('exports.shade'),          value: j => j.varv },
    { header: t('exports.dieShade'),     value: j => j.kondivarv ?? null },
    { header: t('exports.teeth'),        value: j => j.hambad },
    { header: t('exports.toothCount'),       value: j => (j.hambad ?? '').split(',').filter(Boolean).length },
    { header: t('exports.printId'),      value: j => j.print_id },
    { header: t('exports.modelId'),      value: j => j.mudel_id ?? null },
    { header: t('exports.machine'),         value: j => j.masina },
    { header: t('exports.technician'),      value: j => workerName(j.assigned_to) },
    // Every designer on the job, not just the one named at job level: a case
    // split between two of them exported one name and read as if the other had
    // done nothing.
    { header: t('exports.designer'),     value: j => jobDesigners(j).map(workerName).join(', ') },
    { header: t('exports.rush'),       value: j => j.kiirtoo },
    { header: t('exports.deadline'),       value: j => j.valmis_aeg },
    { header: t('exports.completed'),        value: j => j.valmis_kuupaev },
    { header: t('exports.delivery'),     value: j => t(DELIVERY_KEY[j.delivery_status ?? 'labor']) },
    { header: t('exports.handedOver'),     value: j => j.delivered_at },
    { header: t('exports.price'),          value: j => j.hind, money: true },
    { header: t('exports.designPrice'),  value: j => j.disain_hind, money: true },
    { header: t('exports.extras'),  value: j => (j.extras ?? []).map(e => e.nimi).join(', '), money: true },
    // Through jobTotalValue so the export cannot disagree with what every
    // screen shows the job is worth — extras included.
    { header: t('exports.total'),         value: j => jobTotalValue(j), money: true },
    { header: t('exports.paid'),       value: j => j.makstud, money: true },
    { header: t('exports.revisions'),     value: j => (j.revisions ?? []).length },
  ]
  // By the flag, not by the heading text — see `money` on CsvColumn.
  return money ? columns : columns.filter(c => !c.money)
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export const INVOICE_COLUMNS: CsvColumn<InvoiceFull>[] = [
  { header: t('exports.number'),      value: i => i.number },
  { header: t('exports.date'),     value: i => i.issue_date },
  { header: t('exports.deadline'),     value: i => i.due_date },
  { header: t('exports.recipient'),       value: i => i.patsient },
  { header: t('exports.recipientKind'),  value: i => t(i.bill_to_kind === 'customer' ? 'exports.customer' : 'exports.patient') },
  { header: t('exports.status'),     value: i => t(INVOICE_STATUS_KEY[i.status]) },
  { header: t('exports.net'),   value: i => Number(i.net_total) },
  { header: t('exports.vatRate'),   value: i => Number(i.vat_rate) },
  { header: t('exports.vatAmount'),    value: i => Number(i.vat_total) },
  { header: t('exports.gross'),   value: i => Number(i.gross_total) },
  { header: t('exports.received'),    value: i => paidAmount(i) },
  { header: t('exports.outstanding'),    value: i => outstanding(i) },
  { header: t('exports.lineCount'),        value: i => i.lines.length },
  { header: t('exports.note'),      value: i => i.note },
]

// ─── Payouts — the one an accountant actually asked for ───────────────────────

export function payoutColumns(workerName: (id: string) => string): CsvColumn<WorkerPayout>[] {
  return [
    { header: t('exports.worker'),        value: p => workerName(p.profile_id) },
    { header: t('exports.periodStart'),  value: p => p.period_start },
    { header: t('exports.periodEnd'),   value: p => p.period_end },
    { header: t('exports.amount'),          value: p => Number(p.total) },
    { header: t('exports.status'),        value: p => t(p.status === 'makstud' ? 'exports.paid' : 'exports.confirmed') },
    { header: t('exports.paid'),        value: p => p.paid_at },
    { header: t('exports.lineCount'),           value: p => p.lines.length },
    { header: t('exports.note'),         value: p => p.note },
  ]
}

/** One row per payout LINE — what the money was actually for. */
export function payoutLineColumns(workerName: (id: string) => string): CsvColumn<{
  payout: WorkerPayout
  line: WorkerPayout['lines'][number]
}>[] {
  return [
    { header: t('exports.worker'),       value: r => workerName(r.payout.profile_id) },
    { header: t('exports.periodStart'), value: r => r.payout.period_start },
    { header: t('exports.periodEnd'),  value: r => r.payout.period_end },
    { header: t('exports.description'),     value: r => r.line.description },
    { header: t('exports.kind'),          value: r => r.line.kind },
    { header: t('exports.quantity'),         value: r => r.line.qty },
    { header: t('exports.rate'),          value: r => Number(r.line.rate) },
    { header: t('exports.amount'),         value: r => Number(r.line.amount) },
    { header: t('exports.status'),       value: r => t(r.payout.status === 'makstud' ? 'exports.paid' : 'exports.confirmed') },
  ]
}

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * The patient contact list, for a mailing tool. NOT the patient record.
 *
 * An ALLOWLIST, named column by column, exactly like the public `/services`
 * query — and for the same reason. `ravikaart`, `allergiad`, `eelistused`,
 * `lougad`, `lougaliiges` and the notes are GDPR Article 9 health data. A
 * `select *` here, or a helpful addition later, would put a treatment record
 * into a marketing spreadsheet that gets emailed around. A column that is never
 * named cannot leak.
 *
 * Consent travels WITH the row. A mailing tool that receives the list without
 * it has no way to honour a withdrawal, and the clinic has no way to prove the
 * basis it sent on.
 */
export const PATIENT_MARKETING_COLUMNS: CsvColumn<Patient>[] = [
  { header: t('exports.name'),       value: p => p.nimi },
  { header: t('exports.email'),     value: p => p.email },
  { header: t('exports.phone'),    value: p => p.telefon },
  { header: t('exports.consent'),   value: p => t(CONSENT_KEY[p.turundusnousolek]) },
  { header: t('exports.consentAt'), value: p => p.nousoleku_aeg },
  // The referring practice is a business relationship, not health data, and it
  // is what a clinic segments a mailing by.
  { header: t('exports.clinic'),    value: p => p.kliinik },
]

export const CUSTOMER_COLUMNS: CsvColumn<Customer>[] = [
  { header: t('exports.name'),           value: c => c.name },
  { header: t('exports.regCode'),   value: c => c.reg_code },
  { header: t('exports.vatNumber'),           value: c => c.vat_number },
  { header: t('exports.address'),        value: c => c.address },
  { header: t('exports.contactPerson'),    value: c => c.contact_name },
  { header: t('exports.email'),         value: c => c.email },
  { header: t('exports.phone'),        value: c => c.phone },
  { header: t('exports.billing'),       value: c => t(c.billing_mode === 'monthly' ? 'exports.monthlyInvoice' : 'exports.perJob') },
  { header: t('exports.paymentTerms'),   value: c => c.payment_terms_days },
  { header: t('exports.archived'),   value: c => c.archived_at },
]
