/**
 * Seaded → Hinnad → recalculate every job's price from the current price list.
 *
 * Two-step on purpose. This rewrites a financial field on rows that already
 * exist, and the only honest way to offer that is to show precisely what will
 * change — how many jobs, from what total to what total — before anything is
 * written. There is no undo.
 */
import { useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'
import { useJobs, useUpdateJob } from '../../hooks/useJobs'
import { useInvoices } from '../../hooks/useInvoices'
import { useSettings } from '../../stores/useSettings'
import { planReprice, type RepricePlan } from '../../lib/repriceJobs'
import { describeError } from '../Patients/errors'

export function RepriceJobsSection() {
  const { data: jobs = [] } = useJobs()
  const { data: invoices = [] } = useInvoices()
  const { settings } = useSettings()
  const updateJob = useUpdateJob()

  const [includeBilled, setIncludeBilled] = useState(true)
  const [revisionMode, setRevisionMode] = useState<'skip' | 'zero' | 'recalc'>('skip')
  const [plan, setPlan] = useState<RepricePlan | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const billedJobIds = useMemo(() => {
    const set = new Set<string>()
    for (const inv of invoices) {
      if (inv.status === 'tuhistatud') continue
      for (const l of inv.lines) if (l.job_id) set.add(l.job_id)
    }
    return set
  }, [invoices])

  const preview = () => {
    setError(null); setDone(null)
    setPlan(planReprice(jobs, settings, { includeBilled, billedJobIds, revisionMode }))
  }

  async function apply() {
    if (!plan) return
    setRunning(true); setError(null)
    try {
      // Chunked rather than one big Promise.all: a few hundred simultaneous
      // requests is how you get rate-limited half way through and end up with a
      // partially repriced job list.
      const CHUNK = 15

      // One write per job, carrying both the new price and the rewritten
      // revisions array — two passes over the same row would be a lost update.
      const perJob = new Map<string, { job: typeof plan.changes[number]['job']; hind?: number; revs?: boolean }>()
      for (const c of plan.changes) {
        perJob.set(c.job.id, { ...(perJob.get(c.job.id) ?? { job: c.job }), job: c.job, hind: c.newPrice })
      }
      for (const r of plan.revisionChanges) {
        const cur = perJob.get(r.job.id) ?? { job: r.job }
        perJob.set(r.job.id, { ...cur, job: r.job, revs: true })
      }

      const entries = [...perJob.values()]
      let written = 0
      for (let i = 0; i < entries.length; i += CHUNK) {
        const batch = entries.slice(i, i + CHUNK)
        await Promise.all(batch.map(e => {
          const patch: { id: string; hind?: number; revisions?: typeof e.job.revisions } = { id: e.job.id }
          if (e.hind != null) patch.hind = e.hind
          if (e.revs) {
            const forJob = plan.revisionChanges.filter(r => r.job.id === e.job.id)
            patch.revisions = (e.job.revisions ?? []).map(rev => {
              const hit = forJob.find(r => r.revId === rev.id)
              return hit ? { ...rev, price: hit.newPrice } : rev
            })
          }
          return updateJob.mutateAsync(patch)
        }))
        written += batch.length
      }
      setDone(written)
      setPlan(null)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <RefreshCw size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">Arvuta tööde hinnad ümber</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3 leading-relaxed">
        Kirjutab olemasolevate tööde hinnad praeguse hinnakirja järgi üle — töö tüübi
        hind, siis materjali hind, siis €/hammas, ja kiirtöö kordaja peale.
        <strong className="text-ink-muted"> Juba väljastatud arveid see ei muuda</strong> —
        arve read on koopiad arveldamise hetkest.
        <br />
        Tagasivõtmise nuppu ei ole. Vaata ülevaade enne kinnitamist üle.
      </p>

      <label className="flex items-center gap-1.5 text-xs text-ink-muted mb-2 cursor-pointer">
        <input
          type="checkbox" checked={includeBilled}
          onChange={e => { setIncludeBilled(e.target.checked); setPlan(null) }}
          className="accent-accent"
        />
        Kaasa ka tööd, mis on juba arvel
      </label>

      {/* Revisions are priced independently of the job, so they are handled
          independently: a lab that stops charging for its own rework should not
          have to touch the client prices to do it. */}
      <div className="mb-3">
        <p className="text-xs text-ink-muted mb-1">Muudatuste hinnad</p>
        <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
          {([
            { key: 'skip', label: 'Jäta puutumata' },
            { key: 'zero', label: 'Nulli (0 €)' },
            { key: 'recalc', label: `Arvuta ümber (${settings.muudatusHambaHind} €/hammas)` },
          ] as const).map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => { setRevisionMode(o.key); setPlan(null) }}
              className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
                revisionMode === o.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {done != null && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-1.5">
          <CheckCircle2 size={13} /> {done} tööd uuendatud.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {!plan ? (
        <button onClick={preview} className="btn-ghost border border-ink-faint/25">
          <RefreshCw size={13} /> Vaata ülevaadet
        </button>
      ) : (
        <div className="rounded-xl border border-ink-faint/20 overflow-hidden">
          <div className="px-3 py-2.5 bg-bg-sidebar grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Muutub" value={`${plan.changes.length} tööd`} />
            <Stat label="Jääb samaks" value={`${plan.unchanged} tööd`} />
            <Stat label="Praegu kokku" value={`${plan.oldTotal.toFixed(2)} €`} />
            <Stat label="Uus kokku" value={`${plan.newTotal.toFixed(2)} €`} accent />
          </div>

          {plan.revisionChanges.length > 0 && (
            <div className="px-3 py-2 border-t border-ink-faint/15 grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Muudatusi muutub" value={`${plan.revisionChanges.length}`} />
              <Stat label="Muudatused praegu" value={`${plan.revisionOldTotal.toFixed(2)} €`} />
              <Stat label="Muudatused uus" value={`${plan.revisionNewTotal.toFixed(2)} €`} accent />
            </div>
          )}

          {plan.skipped.length > 0 && (
            <p className="px-3 py-2 text-[11px] text-orange-600 bg-orange-50 border-t border-orange-200 flex items-start gap-1.5">
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              {plan.skipped.length} tööd jäetakse vahele — hinda ei saa arvutada
              (nt hambaid pole valitud ja töö tüübil pole hinda). Need jäävad muutmata.
            </p>
          )}

          {plan.changes.length > 0 && (
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-card">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                    <th className="px-3 py-1.5 font-semibold">Töö</th>
                    <th className="px-3 py-1.5 font-semibold">Patsient</th>
                    <th className="px-3 py-1.5 font-semibold">Alus</th>
                    <th className="px-3 py-1.5 font-semibold text-right">Praegu</th>
                    <th className="px-3 py-1.5 font-semibold text-right">Uus</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.changes.slice(0, 200).map(c => (
                    <tr key={c.job.id} className="border-b border-ink-faint/10 last:border-0">
                      <td className="px-3 py-1 text-ink truncate max-w-[160px]">
                        {c.job.too ?? '—'}
                        {c.billed && (
                          <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-bg-sidebar text-ink-faint">
                            arvel
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-ink-muted truncate max-w-[140px]">{c.job.patsient}</td>
                      <td className="px-3 py-1 text-ink-faint">{c.source}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-ink-muted">{c.oldPrice.toFixed(2)}</td>
                      <td className="px-3 py-1 text-right tabular-nums font-semibold text-ink">{c.newPrice.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.changes.length > 200 && (
                <p className="px-3 py-1.5 text-[11px] text-ink-faint">
                  Näidatud esimesed 200 rida {plan.changes.length}-st. Kinnitamine puudutab kõiki.
                </p>
              )}
            </div>
          )}

          <div className="px-3 py-2.5 flex items-center gap-2 border-t border-ink-faint/15">
            <button
              onClick={apply}
              disabled={running || (plan.changes.length === 0 && plan.revisionChanges.length === 0)}
              className="btn-primary disabled:opacity-50"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Kinnita ja kirjuta üle ({plan.changes.length + plan.revisionChanges.length})
            </button>
            <button onClick={() => setPlan(null)} disabled={running} className="btn-ghost border border-ink-faint/25">
              Loobu
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-ink-muted uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${accent ? 'text-accent' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
