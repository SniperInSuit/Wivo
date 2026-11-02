/**
 * One stock item: what it is, its warnings, the actions (each one a
 * movement, sql/093) and its history. "Use on a job" links the movement to a
 * job of this clinic; that link never leaves the clinic.
 */
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { X, AlertTriangle } from 'lucide-react'
import { useStockAction, useStockMovements, type StockMovement } from '@/hooks/useStock'
import { usePermissions } from '@/hooks/usePermissions'
import { usePartnerOrgs } from '@/hooks/usePartners'
import { itemWarnings, stockItemLabel, type StockLevel, type StockWarningKind } from '../../lib/stockWarnings'
import { describeError } from '../Patients/errors'
import type { Job } from '../../types/job'
import { categoryLabel, shortDate } from './StockView'
import { t, dateLocale } from '@/lib/i18n'

type Action = 'use' | 'receive' | 'return' | 'buy' | 'adjust' | 'edit'

const kindLabel = (k: StockMovement['kind']): string => ({
  in: t('stock.kindIn'), use: t('stock.kindUse'), return: t('stock.kindReturn'), buy: t('stock.kindBuy'), adjust: t('stock.kindAdjust'),
})[k]

const warningText = (w: StockWarningKind): string => ({
  low: t('stock.warnLow'), consignment: t('stock.warnConsignment'), expiry: t('stock.warnExpiry'),
})[w]

export function StockItemPanel({ item, jobs, onClose }: { item: StockLevel; jobs: Job[]; onClose: () => void }) {
  const { can } = usePermissions()
  const { data: moves = [] } = useStockMovements(item.id)
  const { data: partners = [] } = usePartnerOrgs()
  const ownerName = item.owner_supplier ?? partners.find(p => p.org_id === item.owner_org)?.name ?? t('stock.partner')
  const action = useStockAction()
  const [open, setOpen] = useState<Action | null>(null)
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [jobQuery, setJobQuery] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [edit, setEdit] = useState({
    manufacturer: item.manufacturer ?? '', system: item.system ?? '', size: item.size ?? '', product: item.product ?? '',
    lot: item.lot, expiry: item.expiry_date, minQty: item.min_qty == null ? '' : String(item.min_qty), due: item.consignment_due ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const consignment = item.consignment_due != null
  const writable = can('stock.write') && !item.archived_at
  const warnings = itemWarnings(item, new Date())
  const jobCode = useMemo(() => new Map(jobs.map(j => [j.id, j.job_code ?? j.id.slice(0, 8)])), [jobs])
  const jobMatches = useMemo(() => {
    const q = jobQuery.trim().toLowerCase()
    if (!q) return []
    return jobs.filter(j => (j.job_code ?? '').toLowerCase().includes(q) || (j.patsient ?? '').toLowerCase().includes(q)).slice(0, 6)
  }, [jobs, jobQuery])

  function start(a: Action) {
    setOpen(o => (o === a ? null : a))
    setQty(a === 'adjust' ? '-1' : '1'); setReason(''); setJobId(null); setJobQuery(''); setError(null)
  }

  async function run() {
    setError(null)
    const n = Number(qty)
    const calls: Record<Action, () => { fn: string; args: Record<string, unknown> } | string> = {
      use: () => (n > 0 ? { fn: 'use_stock', args: { p_item: item.id, p_qty: n, p_job: jobId } } : t('stock.needQty')),
      receive: () => (n > 0 ? { fn: 'receive_stock', args: { p_item: item.id, p_qty: n } } : t('stock.needQty')),
      return: () => (n > 0 ? { fn: 'return_stock', args: { p_item: item.id, p_qty: n, p_reason: reason || null } } : t('stock.needQty')),
      buy: () => (n > 0 ? { fn: 'buy_out_stock', args: { p_item: item.id, p_qty: n } } : t('stock.needQty')),
      adjust: () => (n === 0 || !Number.isInteger(n) ? t('stock.needChange') : !reason.trim() ? t('stock.needReason')
        : { fn: 'adjust_stock', args: { p_item: item.id, p_delta: n, p_reason: reason } }),
      edit: () => (!edit.lot.trim() ? t('stock.needLot') : !edit.expiry ? t('stock.needExpiry')
        : !edit.manufacturer.trim() && !edit.product.trim() ? t('stock.needName')
        : { fn: 'update_stock_item', args: {
            p_item: item.id, p_manufacturer: edit.manufacturer, p_system: edit.system, p_size: edit.size, p_product: edit.product,
            p_lot: edit.lot, p_expiry: edit.expiry, p_min_qty: edit.minQty === '' ? null : Number(edit.minQty),
            p_consignment_due: consignment ? edit.due || null : null } }),
    }
    const call = calls[open!]()
    if (typeof call === 'string') { setError(call); return }
    try {
      await action.mutateAsync(call)
      setOpen(null)
    } catch (e) {
      setError(describeError(e))
    }
  }

  async function archive() {
    setError(null)
    try { await action.mutateAsync({ fn: 'archive_stock_item', args: { p_item: item.id } }); onClose() }
    catch (e) { setError(describeError(e)) }
  }

  const actions: { key: Action; label: string; show: boolean }[] = [
    { key: 'use', label: t('stock.useOnJob'), show: item.qty > 0 },
    { key: 'receive', label: t('stock.receiveMore'), show: true },
    { key: 'return', label: t('stock.returnToOwner'), show: consignment && item.qty > 0 },
    { key: 'buy', label: t('stock.buyOut'), show: consignment && item.qty > 0 },
    { key: 'adjust', label: t('stock.correct'), show: true },
    { key: 'edit', label: t('stock.edit'), show: true },
  ]

  return (
    <aside className="w-[380px] border-l border-ink-faint/20 bg-bg-card overflow-y-auto p-4 space-y-4">
      <div className="flex items-start gap-2">
        <div>
          <p className="text-xs text-ink-muted">{categoryLabel(item.category)}</p>
          <h3 className="text-base font-semibold text-ink">{stockItemLabel(item)}</h3>
        </div>
        <button type="button" onClick={onClose} className="ml-auto text-ink-muted" aria-label={t('stock.close')}><X size={16} /></button>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.inStock')}</dt><dd className="text-2xl font-semibold text-ink">{item.qty}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.warnBelow')}</dt><dd className="text-ink">{item.min_qty ?? '—'}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.lot')}</dt><dd className="font-mono text-ink">{item.lot}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.expiry')}</dt><dd className="text-ink">{shortDate(item.expiry_date)}</dd></div>
        <div className="col-span-2">
          <dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.owner')}</dt>
          <dd className="text-ink">
            {consignment
              ? t('stock.consignmentFromUntil', { owner: ownerName, date: shortDate(item.consignment_due) })
              : t('stock.ownGoods')}
          </dd>
        </div>
      </dl>

      {warnings.length > 0 && (
        <ul className="space-y-1">
          {warnings.map(w => (
            <li key={w} className={`flex items-center gap-2 text-sm ${w === 'low' ? 'text-amber-600' : 'text-rose-600 font-semibold'}`}>
              <AlertTriangle size={13} aria-hidden="true" /> {warningText(w)}
            </li>
          ))}
        </ul>
      )}

      {writable && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {actions.filter(a => a.show).map(a => (
              <button key={a.key} type="button" onClick={() => start(a.key)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${open === a.key ? 'border-accent text-accent' : 'border-ink-faint/30 text-ink-soft'}`}>
                {a.label}
              </button>
            ))}
            {item.qty === 0 && (
              <button type="button" onClick={archive} className="text-xs px-2.5 py-1.5 rounded-lg border border-ink-faint/30 text-ink-soft">
                {t('stock.archive')}
              </button>
            )}
          </div>

          {open && open !== 'edit' && (
            <div className="card p-3 space-y-2">
              <label className="block text-sm">
                <span className="label">{open === 'adjust' ? t('stock.changeBy') : t('stock.quantity')}</span>
                <input type="number" className="input w-32" value={qty} onChange={e => setQty(e.target.value)} />
              </label>
              {open === 'adjust' && <p className="text-xs text-ink-muted">{t('stock.changeHelp')}</p>}
              {open === 'use' && (
                <div className="space-y-1">
                  <span className="label">{t('stock.job')}</span>
                  {jobId ? (
                    <p className="text-sm text-ink">
                      <span className="font-mono">{jobCode.get(jobId)}</span>
                      <button type="button" onClick={() => setJobId(null)} className="ml-2 text-xs text-accent">{t('stock.change')}</button>
                    </p>
                  ) : (
                    <>
                      <input className="input w-full" value={jobQuery} onChange={e => setJobQuery(e.target.value)} placeholder={t('stock.findJob')} />
                      <ul className="text-sm">
                        {jobMatches.map(j => (
                          <li key={j.id}>
                            <button type="button" onClick={() => setJobId(j.id)} className="w-full text-left px-2 py-1 rounded hover:bg-bg-sidebar">
                              <span className="font-mono">{j.job_code}</span> · {j.patsient}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-ink-muted">{t('stock.jobHelp')}</p>
                    </>
                  )}
                </div>
              )}
              {(open === 'adjust' || open === 'return') && (
                <label className="block text-sm">
                  <span className="label">{t('stock.reason')}{open === 'adjust' && <span className="text-rose-500"> *</span>}</span>
                  <input className="input w-full" value={reason} onChange={e => setReason(e.target.value)} />
                </label>
              )}
              {open === 'buy' && <p className="text-xs text-ink-muted">{t('stock.buyOutHelp')}</p>}
              <button type="button" onClick={run} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.save')}</button>
            </div>
          )}

          {open === 'edit' && (
            <div className="card p-3 grid grid-cols-2 gap-2">
              {([['manufacturer', t('stock.manufacturer')], ['system', t('stock.system')], ['size', t('stock.size')], ['product', t('stock.product')], ['lot', t('stock.lot')]] as const).map(([k, label]) => (
                <label key={k} className="block text-sm">
                  <span className="label">{label}</span>
                  <input className="input w-full" value={edit[k]} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} />
                </label>
              ))}
              <label className="block text-sm">
                <span className="label">{t('stock.expiry')}</span>
                <input type="date" className="input w-full" value={edit.expiry} onChange={e => setEdit(x => ({ ...x, expiry: e.target.value }))} />
              </label>
              <label className="block text-sm">
                <span className="label">{t('stock.warnBelow')}</span>
                <input type="number" min={0} className="input w-full" value={edit.minQty} placeholder={t('stock.noWarning')}
                  onChange={e => setEdit(x => ({ ...x, minQty: e.target.value }))} />
              </label>
              {consignment && (
                <label className="block text-sm">
                  <span className="label">{t('stock.consignmentDue')}</span>
                  <input type="date" className="input w-full" value={edit.due} onChange={e => setEdit(x => ({ ...x, due: e.target.value }))} />
                </label>
              )}
              <div className="col-span-2">
                <button type="button" onClick={run} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.save')}</button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        </div>
      )}

      <section>
        <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{t('stock.history')}</h4>
        <ul className="space-y-1.5 text-sm">
          {moves.map(m => (
            <li key={m.id} className="flex gap-2">
              <span className={`tabular-nums w-10 text-right font-semibold ${m.delta > 0 ? 'text-emerald-600' : 'text-ink'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
              <span className="flex-1 text-ink-soft">
                {kindLabel(m.kind)}
                {m.job_id && <span className="font-mono text-ink"> · {jobCode.get(m.job_id) ?? t('stock.jobNotLoaded')}</span>}
                {m.count_id && <span> · {t('stock.fromCount')}</span>}
                {m.reason && <span className="block text-xs text-ink-muted">{m.reason}</span>}
              </span>
              <span className="text-xs text-ink-muted">{format(new Date(m.at), 'd MMM yyyy', { locale: dateLocale })}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
