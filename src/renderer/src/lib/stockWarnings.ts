/**
 * When stock needs attention (spec, Phase 2; sounds: "stock under its
 * minimum, or consignment goods turning red a month before they are due").
 *
 * Per LOT (a stock item):
 *  - consignment: due within a month (or past due) — the row turns red.
 *  - expiry: the goods expire within a month (or have expired).
 *  A lot at zero, or archived, never warns.
 *
 * Per PRODUCT (the same reference across lots, sql/093 `product_key`):
 *  - low: the total of all its lots is below the product's threshold. A
 *    product whose lots are all used up is still low — that is when to order.
 */
import { addMonths, parseISO, startOfDay } from 'date-fns'

export type StockCategory = 'implant' | 'abutment' | 'bone' | 'membrane' | 'other'

export interface StockLevel {
  id: string
  owner_org: string | null
  owner_supplier: string | null
  category: StockCategory
  manufacturer: string | null
  system: string | null
  size: string | null
  product: string | null
  product_key: string
  lot: string
  expiry_date: string
  consignment_due: string | null
  archived_at: string | null
  created_at: string
  qty: number
}

export interface ProductLevel {
  product_key: string
  category: StockCategory
  manufacturer: string | null
  system: string | null
  size: string | null
  product: string | null
  qty: number
  lots: number
  min_qty: number | null
}

/** Implants, abutments, bone material, membranes: used only on a job (sql/093). */
export const NEEDS_JOB: ReadonlySet<StockCategory> = new Set(['implant', 'abutment', 'bone', 'membrane'])

export type LotWarningKind = 'consignment' | 'expiry'

export type StockWarning =
  | { kind: LotWarningKind; itemId: string }
  | { kind: 'low'; productKey: string }

const withinAMonth = (date: string, today: Date): boolean => parseISO(date) <= addMonths(today, 1)

/** Past its expiry date (it can still be used on the day itself). */
export const isExpired = (row: Pick<StockLevel, 'expiry_date'>, today: Date): boolean =>
  parseISO(row.expiry_date) < startOfDay(today)

export function lotWarnings(row: StockLevel, today: Date): LotWarningKind[] {
  if (row.archived_at || row.qty <= 0) return []
  const out: LotWarningKind[] = []
  if (row.consignment_due && withinAMonth(row.consignment_due, today)) out.push('consignment')
  if (withinAMonth(row.expiry_date, today)) out.push('expiry')
  return out
}

export const isLow = (p: ProductLevel): boolean => p.min_qty != null && p.qty < p.min_qty

export function stockWarnings(rows: StockLevel[], products: ProductLevel[], today: Date): StockWarning[] {
  return [
    ...products.filter(isLow).map(p => ({ kind: 'low' as const, productKey: p.product_key })),
    ...rows.flatMap(r => lotWarnings(r, today).map(kind => ({ kind, itemId: r.id }))),
  ]
}

/** Red in the list: consignment due within a month (the spec's rule), or expiring. */
export function isRed(row: StockLevel, today: Date): boolean {
  return lotWarnings(row, today).length > 0
}

export const warningKey = (w: StockWarning): string =>
  w.kind === 'low' ? `product:${w.productKey}:low` : `${w.itemId}:${w.kind}`

/**
 * Warnings the person has not been told about yet. The sound plays once per
 * warning, not on every refresh; a warning that went away and comes back is
 * new again, so `seen` keeps only what is still current.
 */
export function freshWarnings(current: StockWarning[], seen: Set<string>): { fresh: StockWarning[]; nextSeen: Set<string> } {
  return { fresh: current.filter(w => !seen.has(warningKey(w))), nextSeen: new Set(current.map(warningKey)) }
}

/** "Straumann BLT 4.1x10 RC": what the item or product is called in a list. */
export function stockItemLabel(r: Pick<StockLevel, 'manufacturer' | 'system' | 'size' | 'product'>): string {
  return [r.manufacturer, r.system, r.size, r.product].filter(Boolean).join(' ')
}
