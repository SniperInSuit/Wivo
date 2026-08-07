/**
 * Statistika → Rahandus. What came in, what went out, what is left.
 *
 * Every total here is only as complete as the data behind it, so each one that
 * depends on optional fields carries a coverage note. A margin that silently
 * ignored the jobs with no technician assigned would read as good news and be
 * fiction — the whole point of this screen is that the owner can trust it.
 */
import { useMemo, useState } from 'react'
import {
  TrendingUp, TrendingDown, Euro, Wallet, Package, AlertTriangle, Clock,
  FileWarning, Repeat, Users, Info, Building2
} from 'lucide-react'
import { startOfWeek, startOfMonth, startOfQuarter, startOfYear, format } from 'date-fns'
import type { Job } from '../../types/job'
import { jobPeriodDate } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings, useWorkTypes } from '../../stores/useSettings'
import { useInvoices, usePayments } from '../../hooks/useInvoices'
import { useWorkerRates, useWorkHours, useWorkerPayouts } from '../../hooks/useWorkerPay'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { calculateFinance, type Coverage } from '../../lib/finance'
import { employerCost, employerTaxAmount } from '../../lib/earnings'
import type { Period, DateRange } from './useDashboardStats'
import { customIsUsable, orderRange } from './useDashboardStats'

interface FinanceViewProps {
  jobs: Job[]
  period: Period
  /** Only read when `period` is 'custom'. */
  custom?: DateRange | null
}

/**
 * The window every figure on this page is measured over.
 *
 * "Kõik" gets `null` rather than a sentinel span. It used to return
 * 1900-01-01 → 2999-12-31, and overheads are charged BY THE MONTH and prorated
 * across the period — so 2 000 €/kuus rent came out as 13 199 months of it,
 * 26 397 306 €, and the profit line read minus twenty-six million. The caller
 * fills the null from the data's own span, which is the only honest answer to
 * "how long has this lab been running".
 */
function periodRange(period: Period, custom?: DateRange | null): { start: string; end: string } | null {
  const now = new Date()
  // An explicit range is taken exactly as typed, both ends inclusive.
  if (period === 'custom') return customIsUsable(custom) ? orderRange(custom) : null
  // Always today, never the end of the period: money that has not arrived yet
  // is not revenue, and a month-to-date figure compared against a full month's
  // overheads would read as a loss for the first three weeks of every month.
  const end = format(now, 'yyyy-MM-dd')
  if (period === 'week')    return { start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'), end }
  if (period === 'month')   return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end }
  if (period === 'quarter') return { start: format(startOfQuarter(now), 'yyyy-MM-dd'), end }
  if (period === 'year')    return { start: format(startOfYear(now), 'yyyy-MM-dd'), end }
  return null
}

export function FinanceView({ jobs, period, custom }: FinanceViewProps) {
  const { doneStageKey } = usePipeline()
  const { settings } = useSettings()
  const wt = useWorkTypes()
  const { data: invoices = [], isError: invoicesMissing } = useInvoices()
  const { data: payments = [] } = usePayments()
  const { data: rates = [] } = useWorkerRates()
  const { data: hours = [] } = useWorkHours()
  const { data: payouts = [] } = useWorkerPayouts()
  const { data: workers = [] } = useClinicProfiles()

  // "Kõik" spans whatever the data actually covers: the earliest thing on
  // record through today. Every other period is a real calendar window.
  const range = useMemo(() => {
    const fixed = periodRange(period, custom)
    if (fixed) return fixed
    const today = format(new Date(), 'yyyy-MM-dd')
    const earliest = [
      ...jobs.map(jobPeriodDate),
      ...invoices.map(i => i.issue_date ?? ''),
      ...payments.map(p => p.paid_at ?? ''),
    ].filter(Boolean).sort()[0]
    return { start: earliest ?? today, end: today }
  }, [period, custom?.start, custom?.end, jobs, invoices, payments])

  // jobPeriodDate — see types/job.ts. This used to lead with the deadline, so a
  // job due in July and finished in August put its material and labour cost on
  // July's finance page while its wages landed in August's payroll.
  const jobsInPeriod = useMemo(() => jobs.filter(j => {
    const d = jobPeriodDate(j)
    return d >= range.start && d <= range.end
  }), [jobs, range])

  const fin = useMemo(() => calculateFinance({
    jobs: jobsInPeriod,
    invoices,
    payments,
    payouts,
    rates,
    hours,
    workers: workers.map(w => ({ id: w.id, full_name: w.full_name, toosuhe: w.toosuhe })),
    types: wt.types,
    materialCosts: settings.materialCosts,
    fixedCosts: settings.fixedCostsPerJob,
    overheads: settings.yldkulud,
    doneStageKey,
    periodStart: range.start,
    periodEnd: range.end,
  }), [jobsInPeriod, invoices, payments, payouts, rates, hours, workers, wt.types, settings.materialCosts, settings.fixedCostsPerJob, doneStageKey, range])

  // Margin against the FULL cost of employment, not gross pay: the taxes are
  // real money leaving the account.
  // Employer tax applies to WAGES only. A contractor's invoice already carries
  // its own tax treatment, and grossing it up here would invent a liability.
  const employerTax = employerTaxAmount(fin.labourEmployeeGross, settings.tooandjaMaksudProtsent)
  // grossMargin already nets off material + consumables. Overheads come off on
  // top, so the headline is profit rather than contribution — but ONLY when
  // overheads are actually recorded. Subtracting an unentered zero and calling
  // the result "kasum" would be the same lie as a margin that ignores labour.
  const hasOverheads = fin.overheadCost > 0
  const marginAfterTax = Math.round((fin.grossMargin - employerTax - fin.overheadCost) * 100) / 100
  const marginPctAfterTax = fin.billed > 0
    ? Math.round((marginAfterTax / fin.billed) * 1000) / 10
    : 0

  return (
    <div className="space-y-6">
      {invoicesMissing && (
        <div className="card p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-muted">
            Arvete tabelit ei leitud — käibe numbrid on nullid. Käivita{' '}
            <code className="px-1 rounded bg-bg-sidebar">sql/020_invoices.sql</code>.
          </p>
        </div>
      )}

      {/* ── Money in ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> Sisse
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Money icon={Euro} label="Arveldatud" value={fin.billed} sub="käibemaksuta" />
          <Money icon={Wallet} label="Laekunud" value={fin.received} accent="#22C55E" />
          <Money icon={Clock} label="Tasumata" value={fin.outstanding} accent="#F59E0B"
            sub={fin.overdue > 0 ? `${fin.overdue.toFixed(2)} € üle tähtaja` : undefined} />
          <Money
            icon={FileWarning} label="Arveldamata" value={fin.unbilled} accent="#EF4444"
            sub={`${fin.unbilledJobs} valmis tööd ilma arveta`}
          />
        </div>
        {fin.unbilled > 0 && (
          <p className="text-[11px] text-ink-faint mt-2 flex items-start gap-1.5">
            <Info size={11} className="flex-shrink-0 mt-0.5" />
            "Arveldamata" on valmis töö, mille eest ei ole arvet tehtud — kulu on juba
            kantud, tulu mitte. Kõige kiirem koht raha leidmiseks.
          </p>
        )}
      </section>

      {/* ── Money out ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingDown size={13} /> Välja
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Money icon={Users} label="Tööjõukulu (bruto)" value={fin.labourAccrued} accent="#8B5CF6"
            coverage={fin.labourCoverage} coverageLabel="tööl on teostaja" />
          {/* Gross pay is not the cost of employing someone — the employer's
              share of payroll taxes is, and that is what has to be funded. */}
          <Money
            icon={Wallet}
            label="Tööjõukulu koos maksudega"
            value={fin.labourAccrued + employerTax}
            accent="#8B5CF6"
            sub={fin.labourContractor > 0
              ? `sh. maksud ${employerTax.toFixed(2)} € · arve alusel ${fin.labourContractor.toFixed(2)} €`
              : settings.tooandjaMaksudProtsent > 0
                ? `sh. maksud ${employerTax.toFixed(2)} €`
                : 'tööandja maksude määr on 0% — määra Seaded → Hinnad'}
          />
          <Money icon={Package} label="Materjal ja tarvikud" value={fin.materialCost + fin.consumableCost} accent="#F97316"
            sub={fin.consumableCost > 0
              ? `sh. tarvikud ${fin.consumableCost.toFixed(2)} €`
              : undefined}
            coverage={fin.materialCoverage} coverageLabel="tööl on omahind" />
          {fin.fixedCostTotal > 0 && (
            <Money icon={Package} label="Fikseeritud kulud" value={fin.fixedCostTotal} accent="#8B5CF6"
              sub={`${settings.fixedCostsPerJob.map(c => c.nimi).join(', ')}`} />
          )}
          {fin.overheadCost > 0 && (
            <Money icon={Building2} label="Üldkulud" value={fin.overheadCost} accent="#64748B"
              sub={`${settings.yldkulud.map(o => o.nimi).join(', ')} — perioodi osa`} />
          )}
          <Money icon={Repeat} label="Muudatuste kahju" value={fin.revisionLossTotal} accent="#EC4899"
            sub="tööjõud + materjal − tasutud" />
        </div>
      </section>

      {/* ── Result ── */}
      <section>
        <div className="card p-5 flex items-center gap-6 flex-wrap">
          <div>
            <p className="text-xs text-ink-muted mb-1">
              {hasOverheads
                ? 'Kasum (arveldatud − tööjõud koos maksudega − materjal − üldkulud)'
                : 'Kate (arveldatud − tööjõud koos maksudega − materjal)'}
            </p>
            <p className={`text-3xl font-bold tabular-nums leading-none ${
              marginAfterTax >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {marginAfterTax.toFixed(2)} €
            </p>
          </div>
          <div className="pl-6 border-l border-ink-faint/20">
            <p className="text-xs text-ink-muted mb-1">Katteprotsent</p>
            <p className={`text-2xl font-bold tabular-nums leading-none ${
              marginPctAfterTax >= 0 ? 'text-ink' : 'text-red-500'
            }`}>
              {marginPctAfterTax.toFixed(1)}%
            </p>
          </div>
          <p className="text-[11px] text-ink-faint max-w-sm ml-auto leading-relaxed">
            Arvutatud <strong className="text-ink-muted">arveldatud</strong> summast, mitte
            tööde hindadest: arve on see, mille saab reaalselt sisse nõuda. Üldkulud
            (rent, seadmed, tarkvara) ei ole siin arvestatud.
          </p>
        </div>
      </section>

      {/* ── By work type ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Kate töö tüübi järgi
        </h3>
        {fin.byWorkType.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">Andmed puuduvad</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">Töö tüüp</th>
                  <th className="px-3 py-2 font-semibold text-right">Töid</th>
                  <th className="px-3 py-2 font-semibold text-right">Arveldatud</th>
                  <th className="px-3 py-2 font-semibold text-right">Tööjõud</th>
                  <th className="px-3 py-2 font-semibold text-right">Materjal</th>
                  <th className="px-3 py-2 font-semibold text-right">Kate</th>
                  <th className="px-3 py-2 font-semibold text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {fin.byWorkType.map(t => (
                  <tr key={t.name} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                    <td className="px-3 py-2 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: wt.hex(t.name) }} />
                      <span className="text-ink truncate">{t.name}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{t.jobs}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{t.revenue.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{t.labour.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{t.material.toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      t.margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {t.margin.toFixed(2)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${
                      t.marginPct >= 0 ? 'text-ink-muted' : 'text-red-500'}`}>
                      {t.revenue > 0 ? `${t.marginPct.toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-faint mt-2">
          Tühi "Arveldatud" tähendab, et selle tüübi töid ei ole veel arveldatud — kate on
          siis negatiivne, sest kulu on olemas ja tulu mitte.
        </p>
      </section>

      {/* ── Revision loss ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Muudatuste kahju põhjuse järgi
        </h3>
        {fin.revisionLoss.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">Muudatusi ei olnud</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">Põhjus</th>
                  <th className="px-3 py-2 font-semibold text-right">Kordi</th>
                  <th className="px-3 py-2 font-semibold text-right">Tööjõud</th>
                  <th className="px-3 py-2 font-semibold text-right">Materjal</th>
                  <th className="px-3 py-2 font-semibold text-right">Tasutud</th>
                  <th className="px-3 py-2 font-semibold text-right">Netokahju</th>
                </tr>
              </thead>
              <tbody>
                {fin.revisionLoss.map(r => (
                  <tr key={r.reason} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                    <td className="px-3 py-2 text-ink">{r.reason}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{r.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{r.labour.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{r.material.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.recovered.toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      r.net > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {r.net.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-faint mt-2 leading-relaxed">
          Netokahju = mis ümbertegemine maksis, miinus see, mis selle eest küsiti.
          Kui muudatused ei ole tasureeglis tasustatud, on tööjõukulu 0 — ümbertegemise
          aeg läheb siis kaotsi tööajana, mitte rahana.
        </p>
      </section>

      {/* ── How clients paid ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Maksmise viis
        </h3>
        {fin.byPaymentMethod.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">
            Sellel perioodil ei ole makseid registreeritud.
          </div>
        ) : (
          <div className="card p-4 space-y-2.5">
            {fin.byPaymentMethod.map(m => (
              <div key={m.method}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-ink font-medium">{m.label}</span>
                  <span className="text-ink-muted tabular-nums">
                    {m.count} makset · <span className="font-semibold text-ink">{m.amount.toFixed(2)} €</span>
                    <span className="text-ink-faint"> · {m.share.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-bg-sidebar overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(2, m.share)}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-ink-faint pt-1 leading-relaxed">
              Arvestatakse perioodil <strong className="text-ink-muted">laekunud</strong> makseid,
              mitte väljastatud arveid — küsimus on, kuidas raha päriselt kohale jõuab.
              Sisaldab nii arvete makseid kui ka töö juures "Makstud" märkimisi.
            </p>
          </div>
        )}
      </section>

      {/* ── By worker ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Töötajate kaupa
        </h3>
        {fin.byWorker.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">
            Ühelegi tööle ei ole teostajat määratud.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">Töötaja</th>
                  <th className="px-3 py-2 font-semibold text-right">Töid</th>
                  <th className="px-3 py-2 font-semibold text-right">Hambaid</th>
                  <th className="px-3 py-2 font-semibold text-right">Arvestatud</th>
                  <th className="px-3 py-2 font-semibold text-right">Välja makstud</th>
                </tr>
              </thead>
              <tbody>
                {fin.byWorker.map(w => (
                  <tr key={w.profileId} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                    <td className="px-3 py-2 text-ink">{w.name}</td>
                    <td className="px-3 py-2 text-ink-muted text-xs">
                      {w.engagement === 'ettevote' ? 'Esitab arve' : 'Palgal'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{w.jobs}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{w.teeth}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{w.earned.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{w.paidOut.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Money({ icon: Icon, label, value, sub, accent, coverage, coverageLabel }: {
  icon: typeof Euro
  label: string
  value: number
  sub?: string
  accent?: string
  coverage?: Coverage
  coverageLabel?: string
}) {
  const missing = coverage?.missing ?? 0
  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${accent ?? '#0AB6C4'}18` }}
        >
          <Icon size={14} style={{ color: accent ?? '#0AB6C4' }} />
        </div>
        <span className="text-xs font-medium text-ink-muted">{label}</span>
      </div>
      <p className="text-xl font-bold text-ink leading-none tabular-nums">{value.toFixed(2)} €</p>
      {sub && <p className="text-[11px] text-ink-faint">{sub}</p>}
      {/* Says what the number could not see. A total that quietly omitted a
          third of the jobs is worse than no total at all. */}
      {coverage && missing > 0 && (
        <p className="text-[11px] text-orange-500 flex items-start gap-1">
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          {coverage.covered}/{coverage.total} {coverageLabel} — {missing} tööd puudu
        </p>
      )}
    </div>
  )
}
