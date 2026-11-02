/**
 * Our goods on partners' shelves (`partner_stock`, sql/093): where the
 * partnership shares stock, what we own there — lot, expiry, used and
 * remaining. Totals only: which job or patient used them stays with the clinic.
 */
import { lotWarnings, stockItemLabel } from '../../lib/stockWarnings'
import type { PartnerStockRow } from '@/hooks/useStock'
import { categoryLabel, shortDate } from './StockView'
import { t } from '@/lib/i18n'

export function PartnerStockTab({ rows }: { rows: PartnerStockRow[] }) {
  const today = new Date()
  return (
    <div className="overflow-y-auto space-y-2">
      <p className="text-xs text-ink-muted">{t('stock.partnerHelp')}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="py-2 pr-3">{t('stock.at')}</th>
            <th className="py-2 pr-3">{t('stock.item')}</th>
            <th className="py-2 pr-3">{t('stock.lot')}</th>
            <th className="py-2 pr-3">{t('stock.expiry')}</th>
            <th className="py-2 pr-3">{t('stock.consignmentDue')}</th>
            <th className="py-2 pr-3 text-right">{t('stock.received')}</th>
            <th className="py-2 pr-3 text-right">{t('stock.used')}</th>
            <th className="py-2 pr-3 text-right">{t('stock.returnedOrBought')}</th>
            <th className="py-2 pr-3 text-right">{t('stock.writtenOff')}</th>
            <th className="py-2 text-right">{t('stock.remaining')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            // Same red rule as on the clinic's own list.
            const red = lotWarnings({
              ...r, id: r.item_id, owner_org: null, owner_supplier: null, product_key: '', archived_at: null, created_at: '', qty: r.remaining,
            }, today).length > 0
            return (
              <tr key={r.item_id} className={`border-t border-ink-faint/15 ${red ? 'bg-rose-500/10 text-rose-600' : ''}`}>
                <td className="py-2 pr-3">{r.location_name}</td>
                <td className="py-2 pr-3">{stockItemLabel(r)} <span className="text-xs text-ink-muted">· {categoryLabel(r.category)}</span></td>
                <td className="py-2 pr-3 font-mono text-xs">{r.lot}</td>
                <td className="py-2 pr-3">{shortDate(r.expiry_date)}</td>
                <td className="py-2 pr-3">{shortDate(r.consignment_due)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.received}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.used}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.returned + r.bought}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.written_off}</td>
                <td className="py-2 text-right tabular-nums font-semibold">{r.remaining}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
