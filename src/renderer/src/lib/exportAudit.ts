/**
 * Every CSV export leaves an audit entry (sql/106): which export, how many
 * rows and the filters — who and when the database adds. Never the rows'
 * content: fixed choices (a stage, a status, dates) are recorded as they are;
 * free text and names only as "set", since a search typed into the job table
 * could be a patient's name. The file is made only once the entry is written.
 */
import { supabase } from './supabase'
import { exportCsv } from './exports'
import type { CsvColumn } from '@shared/export/csv'
import { describeError } from '../components/Patients/errors'

export type ExportKind =
  | 'audit_log' | 'jobs' | 'customers' | 'invoices' | 'patient_contacts'
  | 'payouts' | 'payout_lines' | 'revision_repricing'

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
