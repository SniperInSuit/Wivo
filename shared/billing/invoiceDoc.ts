/**
 * What an invoice SAYS, once. Not how it looks.
 *
 * The invoice is about to exist twice: the printed page (`InvoicePrintView`,
 * Tailwind, modern CSS) and the emailed one (an edge function, tables and
 * inline styles, because mail clients strip everything else). Those two cannot
 * share markup — the constraints are genuinely different — so what they share
 * is this: every derived number, every composed line of the address block, and
 * every string ALREADY FORMATTED.
 *
 * Pre-formatted on purpose. If one renderer writes `toFixed(2)` and the other
 * writes its own, the day someone changes a separator only one of them changes,
 * and the document in the accountant's folder stops matching the one in the
 * patient's mailbox. This file is the only place a number becomes text.
 *
 * NO DEPENDENCIES — `shared/README.md`. That includes date-fns, so the date
 * formatting below is hand-rolled, and it includes the renderer's own `Clinic`
 * and `InvoiceFull` types, so the inputs are declared structurally here and the
 * caller's objects satisfy them by shape.
 */

/** The subset of an invoice line this document needs. */
export interface DocInvoiceLine {
  description: string
  qty: number | string
  unit_price: number | string
}

/** The subset of an invoice this document needs. */
export interface DocInvoice {
  number: string
  status: string
  patsient: string
  issue_date: string | null
  due_date: string | null
  vat_rate: number | string
  net_total: number | string
  vat_total: number | string
  gross_total: number | string
  note: string | null
  lines: DocInvoiceLine[]
  payments?: { amount: number | string }[]
}

/** The subset of the clinic that appears on the document. */
export interface DocClinic {
  name?: string | null
  address?: string | null
  postal_code?: string | null
  city?: string | null
  reg_code?: string | null
  vat_number?: string | null
  phone?: string | null
  email?: string | null
  bank_name?: string | null
  bank_account?: string | null
}

export interface DocLine {
  description: string
  qty: number
  unitPrice: number
  total: number
  qtyText: string
  unitPriceText: string
  totalText: string
}

export interface InvoiceDoc {
  number: string
  /** 'dd.MM.yyyy', or '—' when the date is missing or unreadable. */
  issueDate: string
  dueDate: string
  hasDueDate: boolean
  cancelled: boolean

  seller: {
    name: string
    /** Address, reg code, VAT number, phone, email — already composed, blanks
     *  dropped. A renderer just prints the lines it is given. */
    lines: string[]
  }
  buyer: { name: string }

  lines: DocLine[]

  totals: {
    net: number; netText: string
    vatRate: number; vatLabel: string
    vat: number; vatText: string
    gross: number; grossText: string
    paid: number; paidText: string
    due: number; dueText: string
    /** Only worth showing the paid/outstanding pair once money has arrived. */
    showPaid: boolean
  }

  /** Null when the clinic has filled in no bank details at all. */
  payment: { bankName: string | null; iban: string | null; reference: string } | null
  note: string | null

  /**
   * Clinic details an Estonian invoice is expected to carry and this one does
   * not. Non-empty means the document goes out incomplete — the caller decides
   * whether to warn or to refuse.
   */
  missing: string[]
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** `1234.5` → `'1234.50 €'`. The one place a sum becomes text. */
export const money = (v: number | string | null | undefined): string =>
  `${num(v).toFixed(2)} €`

/**
 * 'YYYY-MM-DD' → 'dd.MM.yyyy'. Strict, and '—' on anything else: a half-typed
 * date guessed into a real one would put a due date on a document nobody chose.
 */
export function docDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return '—'
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '—'
  return `${m[3]}.${m[2]}.${m[1]}`
}

const trimmed = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s ? s : null
}

/** Everything the document says, derived once. */
export function invoiceDoc(invoice: DocInvoice, clinic: DocClinic | null): InvoiceDoc {
  const c = clinic ?? {}

  const missing: string[] = []
  if (!trimmed(c.name)) missing.push('nimi')
  if (!trimmed(c.reg_code)) missing.push('registrikood')
  if (!trimmed(c.bank_account)) missing.push('IBAN')
  if (!trimmed(c.address)) missing.push('aadress')

  const sellerLines: string[] = []
  const addr = trimmed(c.address)
  if (addr) sellerLines.push(addr)
  const town = [trimmed(c.postal_code), trimmed(c.city)].filter(Boolean).join(' ')
  if (town) sellerLines.push(town)
  if (trimmed(c.reg_code)) sellerLines.push(`Reg nr ${trimmed(c.reg_code)}`)
  if (trimmed(c.vat_number)) sellerLines.push(`KMKR ${trimmed(c.vat_number)}`)
  if (trimmed(c.phone)) sellerLines.push(trimmed(c.phone) as string)
  if (trimmed(c.email)) sellerLines.push(trimmed(c.email) as string)

  const lines: DocLine[] = (invoice.lines ?? []).map(l => {
    const qty = num(l.qty)
    const unitPrice = num(l.unit_price)
    const total = round2(qty * unitPrice)
    return {
      description: l.description ?? '',
      qty,
      unitPrice,
      total,
      // An integer quantity prints as "1", not "1.00" — invoices say one crown,
      // not one-point-zero-zero crowns.
      qtyText: Number.isInteger(qty) ? String(qty) : String(qty),
      unitPriceText: money(unitPrice),
      totalText: money(total),
    }
  })

  const paid = round2((invoice.payments ?? []).reduce((s, p) => s + num(p.amount), 0))
  const gross = round2(num(invoice.gross_total))
  // Cancelled owes nothing regardless of what was billed, exactly as
  // `outstanding()` in types/invoice decided — restated here because shared/
  // cannot import it, and stated once so the two cannot disagree.
  const cancelled = invoice.status === 'tuhistatud'
  const due = cancelled ? 0 : round2(Math.max(0, gross - paid))
  const vatRate = num(invoice.vat_rate)

  const bankName = trimmed(c.bank_name)
  const iban = trimmed(c.bank_account)

  return {
    number: invoice.number,
    issueDate: docDate(invoice.issue_date),
    dueDate: docDate(invoice.due_date),
    hasDueDate: docDate(invoice.due_date) !== '—',
    cancelled,
    seller: { name: trimmed(c.name) ?? '—', lines: sellerLines },
    buyer: { name: invoice.patsient },
    lines,
    totals: {
      net: round2(num(invoice.net_total)), netText: money(invoice.net_total),
      vatRate, vatLabel: `Käibemaks ${vatRate}%`,
      vat: round2(num(invoice.vat_total)), vatText: money(invoice.vat_total),
      gross, grossText: money(gross),
      paid, paidText: money(paid),
      due, dueText: money(due),
      showPaid: paid > 0,
    },
    payment: (bankName || iban)
      ? { bankName, iban, reference: `arve ${invoice.number}` }
      : null,
    note: trimmed(invoice.note),
    missing,
  }
}
