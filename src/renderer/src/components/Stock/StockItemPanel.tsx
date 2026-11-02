/**
 * One stock item (a lot): what it is, its warnings, the actions (each one a
 * movement, sql/093) and its history. "Use on a job" links the movement to a
 * job of this clinic; that link never leaves the clinic.
 *
 * Rules the database enforces, offered here so nobody hits a refusal blind:
 * implants, abutments, bone material and membranes go out only on a job, or
 * as a write-off with a reason; expired goods are not used on a job unless
 * the clinic's owner or an org admin overrides with a reason (logged, sql/096). The warning threshold
 * belongs to the product — every lot of it — not to this lot.
 */
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { X, AlertTriangle } from 'lucide-react'
import { useStockAction, useStockMovements, type StockMovement } from '@/hooks/useStock'
import { usePermissions } from '@/hooks/usePermissions'
import { usePartnerOrgs } from '@/hooks/usePartners'
import { useAuth } from '@/context/AuthContext'
import {
  lotWarnings, isLow, isExpired, stockItemLabel, NEEDS_JOB,
  type StockLevel, type ProductLevel, type LotWarningKind,
} from '../../lib/stockWarnings'
import { describeError } from '../Patients/errors'
import type { Job } from '../../types/job'
import { categoryLabel, shortDate } from './StockView'
import { t, dateLocale } from '@/lib/i18n'

type Action = 'use' | 'writeoff' | 'receive' | 'return' | 'buy' | 'adjust' | 'threshold' | 'edit'
type ReasonCode = NonNullable<StockMovement['reason_code']>
const REASON_CODES: ReasonCode[] = ['damaged', 'expired', 'opened', 'returned']

const kindLabel = (k: StockMovement['kind']): string => ({
  in: t('stock.kindIn'), use: t('stock.kindUse'), return: t('stock.kindReturn'), buy: t('stock.kindBuy'),
  adjust: t('stock.kindAdjust'), writeoff: t('stock.kindWriteoff'),
})[k]

export const reasonCodeLabel = (c: ReasonCode): string => ({
  damaged: t('stock.reasonDamaged'), expired: t('stock.reasonExpired'),
  opened: t('stock.reasonOpened'), returned: t('stock.reasonReturned'),
})[c]

const warningText = (w: LotWarningKind | 'low'): string => ({
  low: t('stock.warnLow'), consignment: t('stock.warnConsignment'), expiry: t('stock.warnExpiry'),
})[w]

export function StockItemPanel({ item, product, jobs, onClose }: {
  item: StockLevel; product: ProductLevel | null; jobs: Job[]; onClose: () => void
}) {
  const { can } = usePermissions()
  const { role, profile } = useAuth()
  const { data: moves = [] } = useStockMovements(item.id)
  const { data: partners = [] } = usePartnerOrgs()
  const ownerName = item.owner_supplier ?? partners.find(p => p.org_id === item.owner_org)?.name ?? t('stock.partner')
  const action = useStockAction()
  const [open, setOpen] = useState<Action | null>(null)
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('')
  const [jobQuery, setJobQuery] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(product?.min_qty == null ? '' : String(product.min_qty))
  const [edit, setEdit] = useState({
    manufacturer: item.manufacturer ?? '', system: item.system ?? '', size: item.size ?? '', product: item.product ?? '',
    lot: item.lot, expiry: item.expiry_date, due: item.consignment_due ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const today = new Date()
  const consignment = item.consignment_due != null
  const writable = can('stock.write') && !item.archived_at
  const needsJob = NEEDS_JOB.has(item.category)
  const expired = isExpired(item, today)
  // sql/096: the owner or an org admin may override expiry, with a reason.
  const canOverride = role === 'owner' || profile?.org_role === 'owner' || profile?.org_role === 'admin'
  const warnings: (LotWarningKind | 'low')[] = [...(product && isLow(product) ? ['low' as const] : []), ...lotWarnings(item, today)]
  const jobCode = useMemo(() => new Map(jobs.map(j => [j.id, j.job_code ?? j.id.slice(0, 8)])), [jobs])
  const jobMatches = useMemo(() => {
    const q = jobQuery.trim().toLowerCase()
    if (!q) return []
    return jobs.filter(j => (j.job_code ?? '').toLowerCase().includes(q) || (j.patsient ?? '').toLowerCase().includes(q)).slice(0, 6)
  }, [jobs, jobQuery])

  function start(a: Action) {
    setOpen(o => (o === a ? null : a))
    setQty(a === 'adjust' ? '-1' : '1'); setReason(''); setReasonCode(''); setJobId(null); setJobQuery(''); setError(null)
  }

  async function run() {
    setError(null)
    const n = Number(qty)
    const calls: Record<Action, () => { fn: string; args: Record<string, unknown> } | string> = {
      use: () => (!(n > 0) ? t('stock.needQty')
        : needsJob && !jobId ? t('stock.needJob')
        : expired && !reason.trim() ? t('stock.needOverrideReason')
        : { fn: 'use_stock', args: { p_item: item.id, p_qty: n, p_job: jobId, p_override_reason: expired ? reason : null } }),
      writeoff: () => (!(n > 0) ? t('stock.needQty') : !reasonCode ? t('stock.needWriteoffReason')
        : { fn: 'writeoff_stock', args: { p_item: item.id, p_qty: n, p_reason_code: reasonCode, p_note: reason || null } }),
      receive: () => (n > 0 ? { fn: 'receive_stock', args: { p_item: item.id, p_qty: n } } : t('stock.needQty')),
      return: () => (n > 0 ? { fn: 'return_stock', args: { p_item: item.id, p_qty: n, p_reason: reason || null } } : t('stock.needQty')),
      buy: () => (n > 0 ? { fn: 'buy_out_stock', args: { p_item: item.id, p_qty: n } } : t('stock.needQty')),
      adjust: () => (n === 0 || !Number.isInteger(n) ? t('stock.needChange') : !reason.trim() ? t('stock.needReason')
        : { fn: 'adjust_stock', args: { p_item: item.id, p_delta: n, p_reason: reason } }),
      threshold: () => (threshold !== '' && !(Number(threshold) >= 0) ? t('stock.needThreshold')
        : { fn: 'set_stock_threshold', args: { p_item: item.id, p_min_qty: threshold === '' ? null : Number(threshold) } }),
      edit: () => (!edit.lot.trim() ? t('stock.needLot') : !edit.expiry ? t('stock.needExpiry')
        : !edit.manufacturer.trim() && !edit.product.trim() ? t('stock.needName')
        : { fn: 'update_stock_item', args: {
            p_item: item.id, p_manufacturer: edit.manufacturer, p_system: edit.system, p_size: edit.size, p_product: edit.product,
            p_lot: edit.lot, p_expiry: edit.expiry, p_consignment_due: consignment ? edit.due || null : null } }),
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
    { key: 'use', label: t('stock.useOnJob'), show: item.qty > 0 && (!expired || canOverride) },
    { key: 'writeoff', label: t('stock.writeOff'), show: item.qty > 0 },
    { key: 'receive', label: t('stock.receiveMore'), show: true },
    { key: 'return', label: t('stock.returnToOwner'), show: consignment && item.qty > 0 },
    { key: 'buy', label: t('stock.buyOut'), show: consignment && item.qty > 0 },
    { key: 'adjust', label: t('stock.correct'), show: true },
    { key: 'threshold', label: t('stock.setThreshold'), show: true },
    { key: 'edit', label: t('stock.edit'), show: true },
  ]
  const label = (text: string, required = false) => (
    <span className="label">{text}{required && <span className="text-rose-500"> *</span>}</span>
  )

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
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.inThisLot')}</dt><dd className="text-2xl font-semibold text-ink">{item.qty}</dd></div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.productTotal')}</dt>
          <dd className="text-ink">
            {product ? t('stock.productTotalLine', { qty: product.qty, lots: product.lots }) : '—'}
            <span className="block text-xs text-ink-muted">
              {product?.min_qty != null ? t('stock.warnBelowN', { n: product.min_qty }) : t('stock.noWarning')}
            </span>
          </dd>
        </div>
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.lot')}</dt><dd className="font-mono text-ink">{item.lot}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.expiry')}</dt><dd className={expired ? 'text-rose-600 font-semibold' : 'text-ink'}>{shortDate(item.expiry_date)}</dd></div>
        <div className="col-span-2">
          <dt className="text-[11px] uppercase tracking-wider text-ink-muted">{t('stock.owner')}</dt>
          <dd className="text-ink">
            {consignment ? t('stock.consignmentFromUntil', { owner: ownerName, date: shortDate(item.consignment_due) }) : t('stock.ownGoods')}
          </dd>
        </div>
      </dl>

      {(warnings.length > 0 || expired) && (
        <ul className="space-y-1">
          {expired && (
            <li className="flex items-start gap-2 text-sm text-rose-600 font-semibold">
              <AlertTriangle size={13} className="mt-0.5" aria-hidden="true" /> {canOverride ? t('stock.expiredOwner') : t('stock.expiredNotOwner')}
            </li>
          )}
          {warnings.filter(w => !(expired && w === 'expiry')).map(w => (
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

          {open && open !== 'edit' && open !== 'threshold' && (
            <div className="card p-3 space-y-2">
              <label className="block text-sm">
                {label(open === 'adjust' ? t('stock.changeBy') : t('stock.quantity'))}
                <input type="number" className="input w-32" value={qty} onChange={e => setQty(e.target.value)} />
              </label>
              {open === 'adjust' && <p className="text-xs text-ink-muted">{t('stock.changeHelp')}</p>}
              {open === 'use' && (
                <div className="space-y-1">
                  {label(t('stock.job'), needsJob)}
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
                      <p className="text-xs text-ink-muted">{needsJob ? t('stock.jobRequiredHelp') : t('stock.jobHelp')}</p>
                    </>
                  )}
                </div>
              )}
              {open === 'use' && expired && (
                <label className="block text-sm">
                  {label(t('stock.overrideReason'), true)}
                  <input className="input w-full" value={reason} onChange={e => setReason(e.target.value)} />
                  <span className="block text-xs text-ink-muted">{t('stock.overrideHelp')}</span>
                </label>
              )}
              {open === 'writeoff' && (
                <>
                  <label className="block text-sm">
                    {label(t('stock.reason'), true)}
                    <select className="input w-full" value={reasonCode} onChange={e => setReasonCode(e.target.value as ReasonCode | '')}>
                      <option value="">{t('stock.chooseReason')}</option>
                      {REASON_CODES.map(c => <option key={c} value={c}>{reasonCodeLabel(c)}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">
                    {label(t('stock.note'))}
                    <input className="input w-full" value={reason} onChange={e => setReason(e.target.value)} />
                  </label>
                </>
              )}
              {(open === 'adjust' || open === 'return') && (
                <label className="block text-sm">
                  {label(t('stock.reason'), open === 'adjust')}
                  <input className="input w-full" value={reason} onChange={e => setReason(e.target.value)} />
                </label>
              )}
              {open === 'buy' && <p className="text-xs text-ink-muted">{t('stock.buyOutHelp')}</p>}
              <button type="button" onClick={run} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.save')}</button>
            </div>
          )}

          {open === 'threshold' && (
            <div className="card p-3 space-y-2">
              <label className="block text-sm">
                {label(t('stock.warnBelowProduct'))}
                <input type="number" min={0} className="input w-32" value={threshold} placeholder={t('stock.noWarning')}
                  onChange={e => setThreshold(e.target.value)} />
              </label>
              <p className="text-xs text-ink-muted">{t('stock.thresholdHelp')}</p>
              <button type="button" onClick={run} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.save')}</button>
            </div>
          )}

          {open === 'edit' && (
            <div className="card p-3 grid grid-cols-2 gap-2">
              {([['manufacturer', t('stock.manufacturer')], ['system', t('stock.system')], ['size', t('stock.size')], ['product', t('stock.product')], ['lot', t('stock.lot')]] as const).map(([k, text]) => (
                <label key={k} className="block text-sm">
                  {label(text)}
                  <input className="input w-full" value={edit[k]} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} />
                </label>
              ))}
              <label className="block text-sm">
                {label(t('stock.expiry'))}
                <input type="date" className="input w-full" value={edit.expiry} onChange={e => setEdit(x => ({ ...x, expiry: e.target.value }))} />
              </label>
              {consignment && (
                <label className="block text-sm">
                  {label(t('stock.consignmentDue'))}
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
                {m.reason_code && <span> · {reasonCodeLabel(m.reason_code)}</span>}
                {m.job_id && <span className="font-mono text-ink"> · {jobCode.get(m.job_id) ?? t('stock.jobNotLoaded')}</span>}
                {m.count_id && <span> · {t('stock.fromCount')}</span>}
                {m.expired_override && <span className="text-rose-600 font-semibold"> · {t('stock.usedAfterExpiry')}</span>}
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
