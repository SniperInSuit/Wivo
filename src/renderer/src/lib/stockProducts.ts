/**
 * Picking an existing product instead of typing a new spelling of it
 * (Kevin, RUN-4: "Nobel Active" and "NobelActive" must not become two
 * products). No catalogue yet: the products are the ones already in stock
 * (`stock_product_levels`).
 *
 * Matching ignores case, spaces and punctuation, and looks across all of a
 * product's words: "NobelActive" typed as the name finds manufacturer
 * "Nobel", system "Active".
 */
import type { ProductLevel, StockCategory } from './stockWarnings'

export interface ProductEntry {
  category: StockCategory
  manufacturer: string
  system: string
  size: string
  product: string
}

/** The same key the database computes (sql/093, stock_item.product_key). */
export function productKey(e: ProductEntry): string {
  const part = (s: string) => s.trim().toLowerCase()
  return [e.category, part(e.manufacturer), part(e.system), part(e.size), part(e.product)].join('|')
}

const squash = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Existing products that fit what has been typed so far: every filled field
 * (two characters or more) must appear somewhere in the product. The same
 * category first, then the products with more in stock. The product typed
 * exactly is not suggested — it is already the one.
 */
export function suggestProducts(products: ProductLevel[], entry: ProductEntry, limit = 6): ProductLevel[] {
  const typed = [entry.manufacturer, entry.system, entry.size, entry.product].map(squash).filter(s => s.length >= 2)
  if (typed.length === 0) return []
  const key = productKey(entry)
  return products
    .filter(p => p.product_key !== key)
    .filter(p => {
      const all = squash([p.manufacturer, p.system, p.size, p.product].join(' '))
      return typed.every(s => all.includes(s))
    })
    .sort((a, b) => Number(b.category === entry.category) - Number(a.category === entry.category) || b.qty - a.qty)
    .slice(0, limit)
}

/** The existing product this entry is exactly, if any. */
export function existingProduct(products: ProductLevel[], entry: ProductEntry): ProductLevel | null {
  const key = productKey(entry)
  return products.find(p => p.product_key === key) ?? null
}
