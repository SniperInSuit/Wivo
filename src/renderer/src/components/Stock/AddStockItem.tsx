/**
 * A manual add (spec: "on a manual add, expiry and lot are required").
 * Consignment when the goods belong to a partner organisation or an outside
 * supplier: due in three months unless another date is set (sql/093).
 */
import { useState } from 'react'
import { addMonths, format } from 'date-fns'
import { X } from 'lucide-react'
import { useStockAction } from '@/hooks/useStock'
import { usePartnerOrgs } from '@/hooks/usePartners'
import type { StockCategory } from '../../lib/stockWarnings'
import { describeError } from '../Patients/errors'
import { categoryLabel, CATEGORIES } from './StockView'
import { t } from '@/lib/i18n'

type Ownership = 'own' | 'partner' | 'supplier'

export function AddStockItem({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const action = useStockAction()
  const { data: partners = [] } = usePartnerOrgs()
  const active = partners.filter(p => p.status === 'active')
  const [f, setF] = useState({
    category: 'implant' as StockCategory, manufacturer: '', system: '', size: '', product: '',
    lot: '', expiry: '', qty: '1', minQty: '',
    ownership: 'own' as Ownership, partnerOrg: '', supplier: '',
    due: format(addMonths(new Date(), 3), 'yyyy-MM-dd'),
  })
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }))

  function problem(): string | null {
    if (!f.manufacturer.trim() && !f.product.trim()) return t('stock.needName')
    if (!f.lot.trim()) return t('stock.needLot')
    if (!f.expiry) return t('stock.needExpiry')
    if (!(Number(f.qty) > 0)) return t('stock.needQty')
    if (f.ownership === 'partner' && !f.partnerOrg) return t('stock.needPartner')
    if (f.ownership === 'supplier' && !f.supplier.trim()) return t('stock.needSupplier')
    return null
  }

  async function save() {
    const p = problem()
    if (p) { setError(p); return }
    setError(null)
    try {
      const consignment = f.ownership !== 'own'
      const id = await action.mutateAsync({
        fn: 'add_stock_item',
        args: {
          p_category: f.category, p_manufacturer: f.manufacturer, p_system: f.system, p_size: f.size,
          p_product: f.product, p_lot: f.lot, p_expiry: f.expiry, p_qty: Number(f.qty),
          p_min_qty: f.minQty === '' ? null : Number(f.minQty),
          p_owner_org: f.ownership === 'partner' ? f.partnerOrg : null,
          p_owner_supplier: f.ownership === 'supplier' ? f.supplier : null,
          p_consignment_due: consignment ? f.due || null : null,
        },
      })
      onAdded(id as string)
    } catch (e) {
      setError(describeError(e))
    }
  }

  const field = (label: string, el: React.ReactNode, required = false) => (
    <label className="block text-sm text-ink">
      <span className="label">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {el}
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={t('stock.addGoods')}>
        <div className="flex items-center">
          <h3 className="text-base font-semibold text-ink">{t('stock.addGoods')}</h3>
          <button type="button" onClick={onClose} className="ml-auto text-ink-muted" aria-label={t('stock.close')}><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {field(t('stock.category'), (
            <select className="input w-full" value={f.category} onChange={e => set({ category: e.target.value as StockCategory })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
          ))}
          {field(t('stock.manufacturer'), <input className="input w-full" value={f.manufacturer} onChange={e => set({ manufacturer: e.target.value })} />)}
          {field(t('stock.system'), <input className="input w-full" value={f.system} onChange={e => set({ system: e.target.value })} />)}
          {field(t('stock.size'), <input className="input w-full" value={f.size} onChange={e => set({ size: e.target.value })} />)}
          {field(t('stock.product'), <input className="input w-full" value={f.product} onChange={e => set({ product: e.target.value })} />)}
          {field(t('stock.lot'), <input className="input w-full font-mono" value={f.lot} onChange={e => set({ lot: e.target.value })} />, true)}
          {field(t('stock.expiry'), <input type="date" className="input w-full" value={f.expiry} onChange={e => set({ expiry: e.target.value })} />, true)}
          {field(t('stock.quantity'), <input type="number" min={1} className="input w-full" value={f.qty} onChange={e => set({ qty: e.target.value })} />, true)}
          {field(t('stock.warnBelowProduct'), <input type="number" min={0} className="input w-full" value={f.minQty} onChange={e => set({ minQty: e.target.value })} placeholder={t('stock.keepThreshold')} />)}
        </div>

        <fieldset className="space-y-2">
          <legend className="label">{t('stock.whoseGoods')}</legend>
          <div className="flex flex-wrap gap-4 text-sm text-ink">
            {(['own', 'partner', 'supplier'] as const).filter(o => o !== 'partner' || active.length > 0).map(o => (
              <label key={o} className="flex items-center gap-2">
                <input type="radio" name="ownership" checked={f.ownership === o} onChange={() => set({ ownership: o })} />
                {o === 'own' ? t('stock.ownGoods') : o === 'partner' ? t('stock.partnerConsignment') : t('stock.supplierConsignment')}
              </label>
            ))}
          </div>
          {f.ownership === 'partner' && (
            <select className="input w-full" value={f.partnerOrg} onChange={e => set({ partnerOrg: e.target.value })} aria-label={t('stock.partner')}>
              <option value="">{t('stock.choosePartner')}</option>
              {active.map(p => <option key={p.org_id} value={p.org_id}>{p.name}</option>)}
            </select>
          )}
          {f.ownership === 'supplier' && (
            <input className="input w-full" value={f.supplier} onChange={e => set({ supplier: e.target.value })} placeholder={t('stock.supplierName')} aria-label={t('stock.supplierName')} />
          )}
          {f.ownership !== 'own' && (
            <>
              {field(t('stock.consignmentDue'), <input type="date" className="input w-48" value={f.due} onChange={e => set({ due: e.target.value })} />)}
              <p className="text-xs text-ink-muted">{t('stock.consignmentHelp')}</p>
            </>
          )}
        </fieldset>

        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">{t('stock.cancel')}</button>
          <button type="button" onClick={save} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.save')}</button>
        </div>
      </div>
    </div>
  )
}
