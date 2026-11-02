/**
 * Inventory (spec, Phase 2): how often to count, the count itself (expected
 * beside counted, a reason for every difference) and the history. A count is
 * saved in one go; the expected numbers are the stock at saving (sql/094).
 */
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useInventoryHistory, useInventorySchedule, useStockAction } from '@/hooks/useStock'
import { usePermissions } from '@/hooks/usePermissions'
import { stockItemLabel, type StockLevel } from '../../lib/stockWarnings'
import { describeError } from '../Patients/errors'
import { shortDate } from './StockView'
import { t, dateLocale } from '@/lib/i18n'

export function InventoryTab({ rows }: { rows: StockLevel[] }) {
  const { can } = usePermissions()
  const { data: schedule } = useInventorySchedule()
  const { data: history = [] } = useInventoryHistory()
  const [counting, setCounting] = useState<Date | null>(null)
  const label = useMemo(() => new Map(rows.map(r => [r.id, `${stockItemLabel(r)} · ${r.lot}`])), [rows])

  return (
    <div className="overflow-y-auto space-y-5">
      <ScheduleForm schedule={schedule ?? null} writable={can('stock.write')} />

      {can('stock.write') && !counting && (
        <button type="button" onClick={() => setCounting(new Date())} className="btn-primary">{t('stock.startCount')}</button>
      )}
      {counting && <CountScreen rows={rows.filter(r => !r.archived_at)} startedAt={counting} onDone={() => setCounting(null)} />}

      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{t('stock.pastCounts')}</h3>
        {history.length === 0 ? <p className="text-sm text-ink-muted">{t('stock.noCountsYet')}</p> : (
          <ul className="space-y-3">
            {history.map(c => {
              const diffs = c.lines.filter(l => l.counted !== l.expected)
              return (
                <li key={c.id} className="card p-3 text-sm">
                  <p className="font-semibold text-ink">
                    {format(new Date(c.finished_at), 'd MMM yyyy HH:mm', { locale: dateLocale })}
                    <span className="font-normal text-ink-muted"> · {t('stock.countSummary', { items: c.lines.length, diffs: diffs.length })}</span>
                  </p>
                  {diffs.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {diffs.map(l => (
                        <li key={l.item_id} className="text-ink-soft">
                          {label.get(l.item_id) ?? '—'}: {l.expected} → <span className="font-semibold text-ink">{l.counted}</span>
                          <span className="text-ink-muted"> · {l.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function ScheduleForm({ schedule, writable }: { schedule: { interval_months: number; next_due: string } | null; writable: boolean }) {
  const action = useStockAction()
  const [months, setMonths] = useState(String(schedule?.interval_months ?? 3))
  const [due, setDue] = useState(schedule?.next_due ?? '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    if (!due) { setMsg({ ok: false, text: t('stock.needNextDue') }); return }
    try {
      await action.mutateAsync({ fn: 'set_inventory_schedule', args: { p_interval_months: Number(months), p_next_due: due } })
      setMsg({ ok: true, text: t('stock.saved') })
    } catch (e) {
      setMsg({ ok: false, text: describeError(e) })
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink">{t('stock.schedule')}</h3>
      <p className="text-sm text-ink-soft">
        {schedule ? t('stock.nextCountOn', { date: shortDate(schedule.next_due) }) : t('stock.noSchedule')}
      </p>
      {writable && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="label">{t('stock.countEvery')}</span>
            <select className="input w-40" value={months} onChange={e => setMonths(e.target.value)}>
              {[1, 2, 3, 6, 12].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="label">{t('stock.nextCount')}</span>
            <input type="date" className="input w-44" value={due} onChange={e => setDue(e.target.value)} />
          </label>
          <button type="button" onClick={save} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.save')}</button>
          {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-rose-500'}`}>{msg.text}</span>}
        </div>
      )}
    </section>
  )
}

function CountScreen({ rows, startedAt, onDone }: { rows: StockLevel[]; startedAt: Date; onDone: () => void }) {
  const action = useStockAction()
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const filled = rows.filter(r => (counted[r.id] ?? '') !== '')

  async function save() {
    setError(null)
    if (filled.length === 0) { setError(t('stock.nothingCounted')); return }
    const missing = filled.find(r => Number(counted[r.id]) !== r.qty && !(reasons[r.id] ?? '').trim())
    if (missing) { setError(t('stock.differenceNeedsReason', { item: stockItemLabel(missing) })); return }
    try {
      await action.mutateAsync({
        fn: 'record_inventory_count',
        args: {
          p_started_at: startedAt.toISOString(),
          p_lines: filled.map(r => ({ item_id: r.id, counted: Number(counted[r.id]), reason: reasons[r.id] ?? null })),
        },
      })
      onDone()
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">{t('stock.count')}</h3>
        <span className="text-xs text-ink-muted">{t('stock.countedOf', { n: filled.length, total: rows.length })}</span>
      </div>
      <p className="text-xs text-ink-muted">{t('stock.countHelp')}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="py-2 pr-3">{t('stock.item')}</th>
            <th className="py-2 pr-3">{t('stock.lot')}</th>
            <th className="py-2 pr-3 text-right">{t('stock.expected')}</th>
            <th className="py-2 pr-3">{t('stock.counted')}</th>
            <th className="py-2">{t('stock.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const v = counted[r.id] ?? ''
            const differs = v !== '' && Number(v) !== r.qty
            return (
              <tr key={r.id} className="border-t border-ink-faint/15">
                <td className="py-1.5 pr-3">{stockItemLabel(r)}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{r.lot}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.qty}</td>
                <td className="py-1.5 pr-3">
                  <input type="number" min={0} className={`input w-20 ${differs ? 'border-amber-500' : ''}`} value={v}
                    aria-label={t('stock.countedFor', { item: stockItemLabel(r) })}
                    onChange={e => setCounted(x => ({ ...x, [r.id]: e.target.value }))} />
                </td>
                <td className="py-1.5">
                  {differs && (
                    <input className="input w-full" value={reasons[r.id] ?? ''} placeholder={t('stock.whyDifferent')}
                      aria-label={t('stock.reason')} onChange={e => setReasons(x => ({ ...x, [r.id]: e.target.value }))} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={action.isPending} className="btn-primary disabled:opacity-50">{t('stock.saveCount')}</button>
        <button type="button" onClick={onDone} className="btn-ghost">{t('stock.cancel')}</button>
      </div>
    </section>
  )
}
