/**
 * What each screen exports, and the browser side of saving it.
 *
 * The column sets live here rather than in the components so that "what is in
 * the jobs export" is one answer, findable, and reviewable next to the others —
 * an accountant asking "why is VAT missing" should not need to read a React
 * component to find out.
 */
import { toCsv, csvFileName, type CsvColumn } from '@shared/export/csv'
import type { Job } from '../types/job'
import type { InvoiceFull } from '../types/invoice'
import type { Customer } from '../types/customer'
import type { WorkerPayout } from '../hooks/useWorkerPay'
import { DELIVERY_LABEL } from '../types/customer'
import { INVOICE_STATUS_LABEL, outstanding, paidAmount } from '../types/invoice'
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
): CsvColumn<Job>[] {
  return [
    { header: 'Kuupäev',       value: j => j.kuupaev },
    { header: 'Staatus',       value: j => stageLabel(j.status) },
    { header: 'Tellija',       value: j => customerName(j.customer_id) },
    { header: 'Tellija viide', value: j => j.customer_ref },
    { header: 'Patsient',      value: j => j.patsient },
    { header: 'Töö',           value: j => j.too },
    { header: 'Materjal',      value: j => j.materjal },
    { header: 'Värv',          value: j => j.varv },
    { header: 'Hambad',        value: j => j.hambad },
    { header: 'Hambaid',       value: j => (j.hambad ?? '').split(',').filter(Boolean).length },
    { header: 'Print ID',      value: j => j.print_id },
    { header: 'Mudel ID',      value: j => j.mudel_id ?? null },
    { header: 'Masin',         value: j => j.masina },
    { header: 'Teostaja',      value: j => workerName(j.assigned_to) },
    { header: 'Disainija',     value: j => workerName(j.designed_by) },
    { header: 'Kiirtöö',       value: j => j.kiirtoo },
    { header: 'Tähtaeg',       value: j => j.valmis_aeg },
    { header: 'Valmis',        value: j => j.valmis_kuupaev },
    { header: 'Väljastus',     value: j => DELIVERY_LABEL[j.delivery_status ?? 'labor'] },
    { header: 'Üle antud',     value: j => j.delivered_at },
    { header: 'Hind',          value: j => j.hind },
    { header: 'Disaini hind',  value: j => j.disain_hind },
    { header: 'Lisateenused',  value: j => (j.extras ?? []).map(e => e.nimi).join(', ') },
    // Through jobTotalValue so the export cannot disagree with what every
    // screen shows the job is worth — extras included.
    { header: 'Kokku',         value: j => jobTotalValue(j) },
    { header: 'Makstud',       value: j => j.makstud },
    { header: 'Muudatusi',     value: j => (j.revisions ?? []).length },
  ]
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export const INVOICE_COLUMNS: CsvColumn<InvoiceFull>[] = [
  { header: 'Number',      value: i => i.number },
  { header: 'Kuupäev',     value: i => i.issue_date },
  { header: 'Tähtaeg',     value: i => i.due_date },
  { header: 'Saaja',       value: i => i.patsient },
  { header: 'Saaja liik',  value: i => i.bill_to_kind === 'customer' ? 'Klient' : 'Patsient' },
  { header: 'Staatus',     value: i => INVOICE_STATUS_LABEL[i.status] },
  { header: 'Netosumma',   value: i => Number(i.net_total) },
  { header: 'KM määr %',   value: i => Number(i.vat_rate) },
  { header: 'KM summa',    value: i => Number(i.vat_total) },
  { header: 'Kogusumma',   value: i => Number(i.gross_total) },
  { header: 'Laekunud',    value: i => paidAmount(i) },
  { header: 'Tasumata',    value: i => outstanding(i) },
  { header: 'Ridu',        value: i => i.lines.length },
  { header: 'Märkus',      value: i => i.note },
]

// ─── Payouts — the one an accountant actually asked for ───────────────────────

export function payoutColumns(workerName: (id: string) => string): CsvColumn<WorkerPayout>[] {
  return [
    { header: 'Töötaja',        value: p => workerName(p.profile_id) },
    { header: 'Periood algus',  value: p => p.period_start },
    { header: 'Periood lõpp',   value: p => p.period_end },
    { header: 'Summa',          value: p => Number(p.total) },
    { header: 'Staatus',        value: p => p.status === 'makstud' ? 'Makstud' : 'Kinnitatud' },
    { header: 'Makstud',        value: p => p.paid_at },
    { header: 'Ridu',           value: p => p.lines.length },
    { header: 'Märkus',         value: p => p.note },
  ]
}

/** One row per payout LINE — what the money was actually for. */
export function payoutLineColumns(workerName: (id: string) => string): CsvColumn<{
  payout: WorkerPayout
  line: WorkerPayout['lines'][number]
}>[] {
  return [
    { header: 'Töötaja',       value: r => workerName(r.payout.profile_id) },
    { header: 'Periood algus', value: r => r.payout.period_start },
    { header: 'Periood lõpp',  value: r => r.payout.period_end },
    { header: 'Kirjeldus',     value: r => r.line.description },
    { header: 'Liik',          value: r => r.line.kind },
    { header: 'Kogus',         value: r => r.line.qty },
    { header: 'Määr',          value: r => Number(r.line.rate) },
    { header: 'Summa',         value: r => Number(r.line.amount) },
    { header: 'Staatus',       value: r => r.payout.status === 'makstud' ? 'Makstud' : 'Kinnitatud' },
  ]
}

// ─── Customers ────────────────────────────────────────────────────────────────

export const CUSTOMER_COLUMNS: CsvColumn<Customer>[] = [
  { header: 'Nimi',           value: c => c.name },
  { header: 'Registrikood',   value: c => c.reg_code },
  { header: 'KMKR',           value: c => c.vat_number },
  { header: 'Aadress',        value: c => c.address },
  { header: 'Kontaktisik',    value: c => c.contact_name },
  { header: 'E-post',         value: c => c.email },
  { header: 'Telefon',        value: c => c.phone },
  { header: 'Arveldus',       value: c => c.billing_mode === 'monthly' ? 'Kuu koondarve' : 'Töö kaupa' },
  { header: 'Maksetähtaeg',   value: c => c.payment_terms_days },
  { header: 'Arhiveeritud',   value: c => c.archived_at },
]
