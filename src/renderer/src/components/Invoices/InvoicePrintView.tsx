/**
 * Printable invoice → PDF via the system print dialog (Electron prints to PDF
 * natively, so this needs no PDF library and no bundled fonts).
 *
 * The layout is deliberately plain and light-on-white regardless of the app
 * theme: this leaves the screen as a document, and a navy background would both
 * waste toner and make the copy in someone's accounting folder unreadable.
 *
 * Fields follow what an Estonian invoice is expected to carry — seller details
 * with registry and VAT number, bank account, document number, issue and due
 * dates, itemised lines, VAT shown separately, total. What is missing is
 * whatever the clinic has not filled in under Seaded → Kliinik; the banner says
 * so rather than printing a document with blanks in it.
 */
import { useEffect } from 'react'
import { X, Printer, AlertTriangle } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Clinic } from '../../context/AuthContext'
import {
  INVOICE_STATUS_LABEL, lineTotal, paidAmount, outstanding, type InvoiceFull
} from '../../types/invoice'

interface InvoicePrintViewProps {
  invoice: InvoiceFull
  clinic: Clinic | null
  onClose: () => void
}

export function InvoicePrintView({ invoice, clinic, onClose }: InvoicePrintViewProps) {
  // Esc closes — the print overlay covers everything, so a user who opened it
  // by accident needs a way out that is not the print dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const missing: string[] = []
  if (!clinic?.name) missing.push('nimi')
  if (!clinic?.reg_code) missing.push('registrikood')
  if (!clinic?.bank_account) missing.push('IBAN')
  if (!clinic?.address) missing.push('aadress')

  const due = outstanding(invoice)
  const paid = paidAmount(invoice)

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 overflow-y-auto print:bg-white print:static print:overflow-visible">
      {/* Toolbar — screen only */}
      <div className="sticky top-0 flex items-center gap-2 px-5 py-3 bg-bg-card border-b border-ink-faint/15 print:hidden">
        <p className="text-sm font-bold text-ink">Arve {invoice.number}</p>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-primary">
            <Printer size={14} /> Prindi / salvesta PDF
          </button>
          <button onClick={onClose} className="btn-ghost border border-ink-faint/25">
            <X size={14} /> Sulge
          </button>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="mx-auto max-w-[210mm] mt-4 print:hidden">
          <div className="flex items-start gap-2 text-xs rounded-xl border border-orange-200 bg-orange-50 text-orange-800 px-3 py-2">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <p>
              Kliiniku andmetes puudub: <strong>{missing.join(', ')}</strong>. Täienda
              Seaded → Kliinik, muidu läheb arve välja puudulike rekvisiitidega.
            </p>
          </div>
        </div>
      )}

      {/* ── The document ── */}
      <div className="mx-auto my-4 bg-white text-[#111] w-[210mm] min-h-[297mm] p-[16mm] shadow-panel
        print:shadow-none print:my-0 print:w-auto print:min-h-0 print:p-0">

        <div className="flex justify-between items-start gap-8 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">ARVE</h1>
            <p className="text-sm">
              <span className="text-[#666]">Number </span>
              <strong className="tabular-nums">{invoice.number}</strong>
            </p>
            <p className="text-sm">
              <span className="text-[#666]">Kuupäev </span>
              <span className="tabular-nums">{fmt(invoice.issue_date)}</span>
            </p>
            {invoice.due_date && (
              <p className="text-sm">
                <span className="text-[#666]">Maksetähtaeg </span>
                <strong className="tabular-nums">{fmt(invoice.due_date)}</strong>
              </p>
            )}
            {invoice.status === 'tuhistatud' && (
              <p className="mt-1 inline-block text-xs font-bold uppercase tracking-wider text-red-600 border border-red-400 rounded px-1.5 py-0.5">
                {INVOICE_STATUS_LABEL.tuhistatud}
              </p>
            )}
          </div>

          <div className="text-right text-sm leading-relaxed">
            <p className="font-bold text-base">{clinic?.name ?? '—'}</p>
            {clinic?.address && <p>{clinic.address}</p>}
            {(clinic?.postal_code || clinic?.city) && (
              <p>{[clinic.postal_code, clinic.city].filter(Boolean).join(' ')}</p>
            )}
            {clinic?.reg_code && <p className="text-[#666]">Reg nr {clinic.reg_code}</p>}
            {clinic?.vat_number && <p className="text-[#666]">KMKR {clinic.vat_number}</p>}
            {clinic?.phone && <p className="text-[#666]">{clinic.phone}</p>}
            {clinic?.email && <p className="text-[#666]">{clinic.email}</p>}
          </div>
        </div>

        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-wider text-[#666] mb-1">Maksja</p>
          <p className="text-base font-semibold">{invoice.patsient}</p>
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b-2 border-[#111]">
              <th className="text-left py-1.5 font-semibold">Kirjeldus</th>
              <th className="text-right py-1.5 font-semibold w-20">Kogus</th>
              <th className="text-right py-1.5 font-semibold w-28">Ühiku hind</th>
              <th className="text-right py-1.5 font-semibold w-28">Summa</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map(l => (
              <tr key={l.id} className="border-b border-[#ddd]">
                <td className="py-1.5 pr-2">{l.description}</td>
                <td className="py-1.5 text-right tabular-nums">{Number(l.qty)}</td>
                <td className="py-1.5 text-right tabular-nums">{Number(l.unit_price).toFixed(2)} €</td>
                <td className="py-1.5 text-right tabular-nums">{lineTotal(l).toFixed(2)} €</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <table className="text-sm min-w-[280px]">
            <tbody>
              <tr>
                <td className="py-1 pr-6 text-[#666]">Summa</td>
                <td className="py-1 text-right tabular-nums">{Number(invoice.net_total).toFixed(2)} €</td>
              </tr>
              <tr>
                <td className="py-1 pr-6 text-[#666]">
                  Käibemaks {Number(invoice.vat_rate)}%
                </td>
                <td className="py-1 text-right tabular-nums">{Number(invoice.vat_total).toFixed(2)} €</td>
              </tr>
              <tr className="border-t-2 border-[#111]">
                <td className="py-1.5 pr-6 font-bold">Kokku tasuda</td>
                <td className="py-1.5 text-right tabular-nums font-bold text-base">
                  {Number(invoice.gross_total).toFixed(2)} €
                </td>
              </tr>
              {paid > 0 && (
                <>
                  <tr>
                    <td className="py-1 pr-6 text-[#666]">Laekunud</td>
                    <td className="py-1 text-right tabular-nums">{paid.toFixed(2)} €</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-6 font-semibold">Tasumata</td>
                    <td className="py-1 text-right tabular-nums font-semibold">{due.toFixed(2)} €</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {(clinic?.bank_name || clinic?.bank_account) && (
          <div className="text-sm mb-6">
            <p className="text-[11px] uppercase tracking-wider text-[#666] mb-1">Makse</p>
            {clinic?.bank_name && <p>{clinic.bank_name}</p>}
            {clinic?.bank_account && <p className="tabular-nums">IBAN {clinic.bank_account}</p>}
            <p className="text-[#666]">
              Selgitus: arve {invoice.number}
            </p>
          </div>
        )}

        {invoice.note && (
          <div className="text-sm border-t border-[#ddd] pt-3">
            <p className="whitespace-pre-wrap">{invoice.note}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function fmt(d: string | null): string {
  if (!d) return '—'
  const parsed = parseISO(d)
  return isValid(parsed) ? format(parsed, 'dd.MM.yyyy') : '—'
}
