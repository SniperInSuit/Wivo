/**
 * Every CSV export leaves an audit entry (sql/106): which export, how many
 * rows and the filters — who and when the database adds. Never the rows'
 * content: fixed choices (a stage, a status, dates) are recorded as they are;
 * free text and names only as "set", since a search typed into the job table
 * could be a patient's name. The file is made only once the entry is written.
 */
import { supabase } from './supabase'
import { exportCsv, downloadFile } from './exports'
import { toCsv, csvFileName, type CsvColumn } from '@shared/export/csv'
import { zipStored } from '@shared/export/zip'
import { describeError } from '../components/Patients/errors'

export type ExportKind =
  | 'audit_log' | 'jobs' | 'customers' | 'invoices' | 'patient_contacts'
  | 'payouts' | 'payout_lines' | 'revision_repricing'
  | 'pay_people' | 'pay_lines'

type Plain = string | number | boolean
export type ExportFilters = Record<string, Plain | Plain[] | null | undefined>

/** Free text or a name: only whether it was used. */
export const isSet = (v: string | null | undefined): boolean => !!v?.trim()

/** Only the filters in use: nothing empty, "all", off or none; lists of at most 20. */
export function activeFilters(f: ExportFilters): Record<string, Plain | Plain[]> {
  const out: Record<string, Plain | Plain[]> = {}
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined || v === '' || v === 'all' || v === false || v === 0) continue
    if (Array.isArray(v)) { if (v.length) out[k] = v.slice(0, 20); continue }
    out[k] = v
  }
  return out
}

/** Write the audit entry. A database before sql/106 has no such function: then nothing to write. */
export async function recordExport(kind: ExportKind, rows: number, filters: ExportFilters = {}): Promise<void> {
  const { error } = await supabase.rpc('audit_export', { p_kind: kind, p_rows: rows, p_filters: activeFilters(filters) })
  if (error && error.code !== 'PGRST202' && error.code !== '42883') throw error
}

/**
 * Record, then make the CSV. If the entry cannot be written, no file is made
 * and the person is told why.
 */
export async function auditedCsvExport<T>(
  kind: ExportKind, base: string, rows: T[], columns: CsvColumn<T>[], filters: ExportFilters = {},
  onError: (message: string) => void = message => window.alert(message),
): Promise<boolean> {
  try {
    await recordExport(kind, rows.length, filters)
  } catch (e) {
    onError(describeError(e))
    return false
  }
  exportCsv(base, rows, columns)
  return true
}

/** One CSV of a ZIP export: its own kind and row count in the audit log. */
export interface ZipPart<T> {
  kind: ExportKind
  name: string
  rows: T[]
  columns: CsvColumn<T>[]
}

/**
 * Several CSVs as ONE download, a ZIP. Each file leaves its own audit entry
 * (its kind and row count), all of them before the file is made. One file,
 * because Chromium blocks a second automatic download from the same click:
 * two downloads lost the second file without a word.
 */
export async function auditedZipExport(
  base: string, parts: ZipPart<any>[], filters: ExportFilters = {}, // eslint-disable-line @typescript-eslint/no-explicit-any
  onError: (message: string) => void = message => window.alert(message),
): Promise<boolean> {
  try {
    for (const p of parts) await recordExport(p.kind, p.rows.length, filters)
  } catch (e) {
    onError(describeError(e))
    return false
  }
  const enc = new TextEncoder()
  const zip = zipStored(parts.map(p => ({ name: p.name, data: enc.encode(toCsv(p.rows, p.columns)) })))
  downloadFile(csvFileName(base, new Date()).replace(/\.csv$/, '.zip'), zip, 'application/zip')
  return true
}
