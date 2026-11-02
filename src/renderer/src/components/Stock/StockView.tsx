/**
 * Stock (spec, Phase 2): the clinic's goods, consignment included, an
 * inventory count, and — for a partner — its own goods on other clinics'
 * shelves (`partner_stock`, totals only).
 *
 * Every number on screen comes from movements (sql/093); every action here
 * is a movement through an RPC. Red: consignment due within a month, or
 * goods expiring within a month (lib/stockWarnings).
 */
import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Package, Plus, Search, AlertTriangle } from 'lucide-react'
import { useStockLevels, useStockProducts, usePartnerStock } from '@/hooks/useStock'
import { usePermissions } from '@/hooks/usePermissions'
import { lotWarnings, isLow, isRed, stockItemLabel, type StockLevel, type StockCategory } from '../../lib/stockWarnings'
import { describeError } from '../Patients/errors'
import type { Job } from '../../types/job'
import { AddStockItem } from './AddStockItem'
import { StockItemPanel } from './StockItemPanel'
import { InventoryTab } from './InventoryTab'
import { PartnerStockTab } from './PartnerStockTab'
import { InventoryBanner } from './InventoryBanner'
import { t, dateLocale } from '@/lib/i18n'

export const CATEGORIES: StockCategory[] = ['implant', 'abutment', 'bone', 'membrane', 'other']

export const categoryLabel = (c: StockCategory): string => ({
  implant: t('stock.categoryImplant'), abutment: t('stock.categoryAbutment'),
  bone: t('stock.categoryBone'), membrane: t('stock.categoryMembrane'), other: t('stock.categoryOther'),
})[c]

export const shortDate = (d: string | null): string => (d ? format(parseISO(d), 'd MMM yyyy', { locale: dateLocale }) : '—')

type Tab = 'items' | 'inventory' | 'partner'

export function StockView({ jobs }: { jobs: Job[] }) {
  const { can } = usePermissions()
  const { data: rows = [], isLoading, error } = useStockLevels()
  const { data: products = [] } = useStockProducts()
  const { data: partnerRows = [] } = usePartnerStock()
  const [tab, setTab] = useState<Tab>('items')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<StockLevel['category'] | 'all'>('all')
  const [showEmpty, setShowEmpty] = useState(false)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const today = new Date()
  const low = useMemo(() => products.filter(isLow), [products])
  const lowKeys = useMemo(() => new Set(low.map(p => p.product_key)), [low])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      // A lot at zero leaves the list (its product's low warning stays, above).
      .filter(r => showEmpty || (!r.archived_at && r.qty > 0))
      .filter(r => category === 'all' || r.category === category)
      .filter(r => !q || [stockItemLabel(r), r.lot, r.owner_supplier].some(s => s?.toLowerCase().includes(q)))
  }, [rows, query, category, showEmpty])
  const open = rows.find(r => r.id === openId) ?? null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'items', label: t('stock.tabItems') },
    { key: 'inventory', label: t('stock.tabInventory') },
    ...(partnerRows.length > 0 ? [{ key: 'partner' as const, label: t('stock.tabPartner') }] : []),
  ]

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
        <InventoryBanner onOpen={() => setTab('inventory')} />
        <div className="flex items-center gap-3">
          <Package className="text-accent" size={18} aria-hidden="true" />
          <h2 className="text-base font-semibold text-ink">{t('stock.stock')}</h2>
          <div className="flex gap-1 ml-2" role="tablist">
            {tabs.map(x => (
              <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
                className={`px-3 py-1.5 rounded-lg text-sm ${tab === x.key ? 'bg-bg-sidebar text-ink font-semibold' : 'text-ink-muted hover:text-ink'}`}>
                {x.label}
              </button>
            ))}
          </div>
          {tab === 'items' && can('stock.write') && (
            <button type="button" onClick={() => setAdding(true)} className="btn-primary ml-auto">
              <Plus size={14} aria-hidden="true" /> {t('stock.addGoods')}
            </button>
          )}
        </div>

        {tab === 'inventory' && <InventoryTab rows={rows} />}
        {tab === 'partner' && <PartnerStockTab rows={partnerRows} />}
        {tab === 'items' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('stock.search')} aria-label={t('stock.search')}
                  className="input pl-8 w-64" />
              </label>
              <select value={category} onChange={e => setCategory(e.target.value as typeof category)} aria-label={t('stock.category')} className="input w-44">
                <option value="all">{t('stock.allCategories')}</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} />
                {t('stock.showEmpty')}
              </label>
            </div>

            {low.length > 0 && (
              <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                  <AlertTriangle size={14} aria-hidden="true" /> {t('stock.runningLow')}
                </p>
                <ul className="mt-1 space-y-0.5 text-ink">
                  {low.map(p => (
                    <li key={p.product_key}>
                      {stockItemLabel(p)} <span className="text-ink-muted">· {categoryLabel(p.category)}</span>
                      {' — '}{t('stock.lowLine', { qty: p.qty, min: p.min_qty ?? 0 })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error ? (
              <p role="alert" className="text-sm text-rose-500">{describeError(error)}</p>
            ) : isLoading ? (
              <p className="text-sm text-ink-muted">{t('stock.loading')}</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-ink-muted">{rows.length === 0 ? t('stock.empty') : t('stock.noMatches')}</p>
            ) : (
              <div className="overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-ink-muted">
                    <tr>
                      <th className="py-2 pr-3">{t('stock.item')}</th>
                      <th className="py-2 pr-3">{t('stock.category')}</th>
                      <th className="py-2 pr-3">{t('stock.lot')}</th>
                      <th className="py-2 pr-3">{t('stock.expiry')}</th>
                      <th className="py-2 pr-3">{t('stock.owner')}</th>
                      <th className="py-2 pr-3 text-right">{t('stock.inStock')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => {
                      const warnings = lotWarnings(r, today)
                      const red = isRed(r, today)
                      return (
                        <tr key={r.id} onClick={() => setOpenId(r.id)}
                          className={`cursor-pointer border-t border-ink-faint/15 ${red ? 'bg-rose-500/10 text-rose-600' : 'hover:bg-bg-sidebar'} ${r.id === openId ? 'outline outline-1 outline-accent' : ''}`}>
                          <td className="py-2 pr-3 font-medium">
                            {stockItemLabel(r)}
                            {r.archived_at && <span className="ml-2 text-xs text-ink-muted">{t('stock.archived')}</span>}
                          </td>
                          <td className="py-2 pr-3">{categoryLabel(r.category)}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{r.lot}</td>
                          <td className={`py-2 pr-3 ${warnings.includes('expiry') ? 'font-semibold' : ''}`}>{shortDate(r.expiry_date)}</td>
                          <td className="py-2 pr-3">
                            {r.consignment_due ? (
                              <span className={warnings.includes('consignment') ? 'font-semibold' : ''}>
                                {t('stock.consignmentUntil', { date: shortDate(r.consignment_due) })}
                              </span>
                            ) : t('stock.ownGoods')}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {lowKeys.has(r.product_key) && (
                              <AlertTriangle size={13} className="inline mr-1 text-amber-500" aria-label={t('stock.lowStock')} />
                            )}
                            <span className="font-semibold">{r.qty}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {tab === 'items' && open && (
        <StockItemPanel item={open} product={products.find(p => p.product_key === open.product_key) ?? null} jobs={jobs} onClose={() => setOpenId(null)} />
      )}
      {adding && <AddStockItem onClose={() => setAdding(false)} onAdded={id => { setAdding(false); setOpenId(id) }} />}
    </div>
  )
}
