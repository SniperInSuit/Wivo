/**
 * When stock needs attention (spec, Phase 2; sounds: "stock under its
 * minimum, or consignment goods turning red a month before they are due").
 *
 *  - low: fewer left than the item's threshold (`min_qty`).
 *  - consignment: due within a month (or past due) — the row turns red.
 *  - expiry: the goods expire within a month (or have expired).
 *
 * An empty item warns only about being low; an empty consignment item or
 * an expired empty lot is nothing to act on. Archived items never warn.
 */
import { addMonths, parseISO } from 'date-fns'

export interface StockLevel {
  id: string
  owner_org: string | null
  owner_supplier: string | null
  category: 'implant' | 'abutment' | 'bone' | 'other'
  manufacturer: string | null
  system: string | null
  size: string | null
  product: string | null
  lot: string
  expiry_date: string
  consignment_due: string | null
  min_qty: number | null
  archived_at: string | null
  created_at: string
  qty: number
}

export type StockWarningKind = 'low' | 'consignment' | 'expiry'

export interface StockWarning {
  itemId: string
  kind: StockWarningKind
}

const withinAMonth = (date: string, today: Date): boolean => parseISO(date) <= addMonths(today, 1)

export function itemWarnings(row: StockLevel, today: Date): StockWarningKind[] {
  if (row.archived_at) return []
  const out: StockWarningKind[] = []
  if (row.min_qty != null && row.qty < row.min_qty) out.push('low')
  if (row.qty > 0 && row.consignment_due && withinAMonth(row.consignment_due, today)) out.push('consignment')
  if (row.qty > 0 && withinAMonth(row.expiry_date, today)) out.push('expiry')
  return out
}

export function stockWarnings(rows: StockLevel[], today: Date): StockWarning[] {
  return rows.flatMap(r => itemWarnings(r, today).map(kind => ({ itemId: r.id, kind })))
}

/** Red in the list: consignment due within a month (the spec's rule), or expiring. */
export function isRed(row: StockLevel, today: Date): boolean {
  const w = itemWarnings(row, today)
  return w.includes('consignment') || w.includes('expiry')
}

export const warningKey = (w: StockWarning): string => `${w.itemId}:${w.kind}`

/**
 * Warnings the person has not been told about yet. The sound plays once per
 * warning, not on every refresh; a warning that went away and comes back is
 * new again, so `seen` keeps only what is still current.
 */
export function freshWarnings(current: StockWarning[], seen: Set<string>): { fresh: StockWarning[]; nextSeen: Set<string> } {
  const keys = current.map(warningKey)
  return { fresh: current.filter(w => !seen.has(warningKey(w))), nextSeen: new Set(keys) }
}

/** "Straumann BLT 4.1x10 RC": what the item is called in a list. */
export function stockItemLabel(r: Pick<StockLevel, 'manufacturer' | 'system' | 'size' | 'product'>): string {
  return [r.manufacturer, r.system, r.size, r.product].filter(Boolean).join(' ')
}
