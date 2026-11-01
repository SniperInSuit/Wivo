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
import { format } from 'date-fns'
import type { Job } from '../../types/job'
import { jobPeriodDate } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings, useWorkTypes } from '../../stores/useSettings'
import { useInvoices, usePayments } from '../../hooks/useInvoices'
import { useWorkerRates, useWorkHours, useWorkerPayouts } from '../../hooks/useWorkerPay'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { calculateFinance, profitOf, type Coverage } from '../../lib/finance'
import { workTypeImage } from '../../lib/workTypeImages'
import { employerCost, employerTaxAmount } from '../../lib/earnings'
import { StatTile } from '../ui/StatTile'
import type { Period, DateRange } from './useDashboardStats'
import { periodMetrics, rangeFor, elapsedEndOf, unitSplitLabel, teethSplitLabel, MONEY_HINT } from '../../lib/periodMetrics'
import { t } from '@/lib/i18n'

interface FinanceViewProps {
  jobs: Job[]
  period: Period
  /** Only read when `period` is 'custom' or 'kuu' — both carry their window here. */
  custom?: DateRange | null
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
  // rangeFor, shared with Tootmine. This screen used to end its window at TODAY
  // while Tootmine ended it at the end of the month, so for most of any month
  // the same "See kuu" button counted two different sets of work. The reason
  // for ending at today was real but narrower than the change it made — see
  // `overheadEnd` below, which is where it actually belongs.
  const range = useMemo(() => {
    const fixed = rangeFor(period, custom)
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

  // Every count and money total that ALSO appears on Ülevaade or Tootmine.
  // Rahandus keeps its own cost attribution below; it no longer keeps its own
  // idea of how many tööd a period contains.
  const m = useMemo(() => periodMetrics(
    { jobs, invoices, payments, range },
    { dateAnchor: 'too', includeChanges: true, moneyConcept: 'kaive' },
  ), [jobs, invoices, payments, range])

  const fin = useMemo(() => calculateFinance({
    jobs: jobsInPeriod,
    allJobs: jobs,
    invoices,
    payments,
    payouts,
    rates,
    hours,
    workers: workers.map(w => ({
      id: w.id, full_name: w.full_name, toosuhe: w.toosuhe,
      // Without this the lab cost of every rush job is understated by exactly
      // the uplift the payroll screen does pay out.
      kiirtoo_kordaja: w.kiirtoo_kordaja,
      // And without these three, a wage agreed NET is read as gross: employer
      // tax then lands on a wage too small, and the shortfall goes straight
      // into the profit figure. See sql/054.
      tasu_arvestus: w.tasu_arvestus,
      kogumispension_protsent: w.kogumispension_protsent,
      maksuvaba_tulu: w.maksuvaba_tulu,
    })),
    taxRates: {
      tooandjaMaksudProtsent: settings.tooandjaMaksudProtsent,
      tulumaksProtsent: settings.tulumaksProtsent,
      maksuvabaTuluKuus: settings.maksuvabaTuluKuus,
      tootajaTootuskindlustusProtsent: settings.tootajaTootuskindlustusProtsent,
      kogumispensionProtsent: settings.kogumispensionProtsent,
    },
    types: wt.types,
    materialCosts: settings.materialCosts,
    materialPrices: settings.materialPrices,
    fixedCosts: settings.fixedCostsPerJob,
    overheads: settings.yldkulud,
    toopaevadNadalas: settings.toopaevadNadalas,
    doneStageKey,
    periodStart: range.start,
    periodEnd: range.end,
    // Rent does not accrue for days that have not happened. Counts use the
    // whole period; overheads use only the elapsed part of it.
    overheadEnd: elapsedEndOf(range),
  }), [jobsInPeriod, jobs, invoices, payments, payouts, rates, hours, workers, wt.types, settings.materialCosts, settings.materialPrices, settings.fixedCostsPerJob, settings.yldkulud, settings.toopaevadNadalas, settings.tooandjaMaksudProtsent, settings.tulumaksProtsent, settings.maksuvabaTuluKuus, settings.tootajaTootuskindlustusProtsent, settings.kogumispensionProtsent, doneStageKey, range])

  // Margin against the FULL cost of employment, not gross pay: the taxes are
  // real money leaving the account.
  // Employer tax applies to WAGES only. A contractor's invoice already carries
  // its own tax treatment, and grossing it up here would invent a liability.
  const employerTax = employerTaxAmount(fin.labourEmployeeGross, settings.tooandjaMaksudProtsent)
  const p = useMemo(
    () => profitOf(fin, settings.tooandjaMaksudProtsent),
    [fin, settings.tooandjaMaksudProtsent],
  )
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
            {t('Arvete tabelit ei leitud — käibe numbrid on nullid. Käivita', 'Invoices table not found — the revenue figures are zero. Run')}{' '}
            <code className="px-1 rounded bg-bg-sidebar">sql/020_invoices.sql</code>.
          </p>
        </div>
      )}

      {/* ── Summary: Tulu vs Kulu ── */}
      {(() => {
        // profitOf(), not arithmetic here: "Kasum" is a named number and more
        // than one panel now reads it. See lib/finance.ts.
        const { income: totalIncome, labour: labourTotal, material: materialTotal,
                costs: totalCosts, profit } = p
        const costParts = [
          labourTotal > 0 ? t(`Tööjõud ${labourTotal.toFixed(0)}`, `Labour ${labourTotal.toFixed(0)}`) : null,
          materialTotal > 0 ? t(`Materjal ${materialTotal.toFixed(0)}`, `Material ${materialTotal.toFixed(0)}`) : null,
          fin.fixedCostTotal > 0 ? t(`Fikseeritud ${fin.fixedCostTotal.toFixed(0)}`, `Fixed ${fin.fixedCostTotal.toFixed(0)}`) : null,
          fin.overheadCost > 0 ? t(`Üldkulud ${fin.overheadCost.toFixed(0)}`, `Overheads ${fin.overheadCost.toFixed(0)}`) : null,
        ].filter(Boolean)
        return (
          <section>
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-4">
                <p className="text-xs text-ink-muted mb-1">{t('Kasum (tulu − kulu)', 'Profit (income − cost)')}</p>
                <p className={`text-2xl font-bold tabular-nums ${profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {profit.toFixed(2)} €
                </p>
                <p className="text-[11px] text-ink-faint mt-1">
                  {t('Kate', 'Margin')} {totalIncome > 0 ? `${(profit / totalIncome * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-ink-muted mb-1">{t('Tulu (tööde hinnad)', 'Income (job prices)')}</p>
                <p className="text-2xl font-bold tabular-nums text-ink">{totalIncome.toFixed(2)} €</p>
                {/* From the shared aggregator, not from summing the table
                    below: that table splits a multi-type job across its types,
                    so its job column counts WORK ITEMS. Reading the headline
                    off it is what made this screen say 19 where Tootmine said
                    15 for the same month. */}
                <p className="text-[11px] text-ink-faint mt-1">
                  {unitSplitLabel(m)} · {t(`${m.hambad} hammast`, `${m.hambad} ${m.hambad === 1 ? 'tooth' : 'teeth'}`)}
                </p>
                <p className="text-[11px] text-ink-faint">{teethSplitLabel(m)}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-ink-muted mb-1">{t('Kulu kokku', 'Total cost')}</p>
                <p className="text-2xl font-bold tabular-nums text-red-500">{totalCosts.toFixed(2)} €</p>
                {costParts.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {labourTotal > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-ink-faint">{t('Tööjõud + maksud', 'Labour + taxes')}</span>
                        <span className="tabular-nums text-ink-muted">{labourTotal.toFixed(2)} €</span>
                      </div>
                    )}
                    {materialTotal > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-ink-faint">{t('Materjal + tarvikud', 'Materials + supplies')}</span>
                        <span className="tabular-nums text-ink-muted">{materialTotal.toFixed(2)} €</span>
                      </div>
                    )}
                    {fin.fixedCostTotal > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-ink-faint">{t('Fikseeritud', 'Fixed')}</span>
                        <span className="tabular-nums text-ink-muted">{fin.fixedCostTotal.toFixed(2)} €</span>
                      </div>
                    )}
                    {fin.overheadCost > 0 && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-ink-faint">{t('Üldkulud', 'Overheads')}</span>
                        <span className="tabular-nums text-ink-muted">{fin.overheadCost.toFixed(2)} €</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )
      })()}

      {/* ── Money in ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> {t('Sisse', 'In')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile money size="sm" icon={Euro} label={t('Arveldatud', 'Invoiced')} value={fin.billed} sub={MONEY_HINT.arveldatud} />
          {/* Same quantity Tootmine now shows under the same name. It used to
              show the list price of jobs whose legacy `makstud` boolean was
              ticked, which is why the two screens reported 12 800 and 21 980
              for one month. */}
          <StatTile money size="sm" icon={Wallet} label={t('Laekunud', 'Received')} value={fin.received} sub={MONEY_HINT.laekunud} accent="#22C55E" />
          {/* Invoice-based, and it has to say so. A lab that settles jobs
              without invoicing has no invoices to owe against, so this reads
              0.00 € — "nobody owes anything" — while Arveldamata next to it
              says otherwise. The Ülevaade counts the same debt job by job and
              reaches a different number for exactly this reason. */}
          <StatTile money size="sm" icon={Clock} label={t('Tasumata arvete järgi', 'Unpaid by invoice')} value={fin.outstanding} accent="#F59E0B"
            sub={fin.overdue > 0
              ? t(`${fin.overdue.toFixed(2)} € üle tähtaja`, `${fin.overdue.toFixed(2)} € overdue`)
              : t('Ainult väljastatud arved. Arveta tööd on kõrval „Arveldamata" all.', 'Issued invoices only. Jobs without an invoice are alongside, under “Not invoiced”.')} />
          <StatTile money size="sm"
            icon={FileWarning} label={t('Arveldamata', 'Not invoiced')} value={fin.unbilled} accent="#EF4444"
            sub={t(`${fin.unbilledJobs} valmis tööd ilma arveta`, `${fin.unbilledJobs} finished ${fin.unbilledJobs === 1 ? 'job' : 'jobs'} without an invoice`)}
          />
        </div>
        {fin.unbilled > 0 && (
          <p className="text-[11px] text-ink-faint mt-2 flex items-start gap-1.5">
            <Info size={11} className="flex-shrink-0 mt-0.5" />
            {t(
              '"Arveldamata" on valmis töö, mille eest ei ole arvet tehtud — kulu on juba kantud, tulu mitte. Kõige kiirem koht raha leidmiseks.',
              '"Not invoiced" is finished work with no invoice made for it — the cost is already booked, the income is not. The quickest place to find money.',
            )}
          </p>
        )}
      </section>

      {/* ── Money out ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingDown size={13} /> {t('Välja', 'Out')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Gross, including the gross-up of anyone paid a net wage — the
              figure payroll taxes are actually charged on. */}
          <StatTile money size="sm" icon={Users} label={t('Tööjõukulu (bruto)', 'Labour cost (gross)')} value={fin.labourAccrued} accent="#8B5CF6"
            coverage={fin.labourCoverage} coverageLabel={t('tööl on teostaja', 'jobs have an assignee')} />
          {/* Gross pay is not the cost of employing someone — the employer's
              share of payroll taxes is, and that is what has to be funded. */}
          <StatTile money size="sm"
            icon={Wallet}
            label={t('Tööjõud + maksud + arve', 'Labour + taxes + invoices')}
            value={fin.labourAccrued + employerTax}
            accent="#8B5CF6"
            sub={[
              t(`Bruto ${fin.labourEmployeeGross.toFixed(2)} €`, `Gross ${fin.labourEmployeeGross.toFixed(2)} €`),
              employerTax > 0 ? t(`Maksud ${employerTax.toFixed(2)} €`, `Taxes ${employerTax.toFixed(2)} €`) : null,
              fin.labourContractor > 0 ? t(`Arve alusel ${fin.labourContractor.toFixed(2)} €`, `Contractor invoices ${fin.labourContractor.toFixed(2)} €`) : null,
            ].filter(Boolean).join(' · ') || (
              settings.tooandjaMaksudProtsent > 0 ? undefined : t('tööandja maksude määr on 0%', 'employer tax rate is 0%')
            )}
          />
          <StatTile money size="sm" icon={Package} label={t('Materjal ja tarvikud', 'Materials and supplies')} value={fin.materialCost + fin.consumableCost} accent="#F97316"
            sub={fin.consumableCost > 0
              ? t(`sh. tarvikud ${fin.consumableCost.toFixed(2)} €`, `incl. supplies ${fin.consumableCost.toFixed(2)} €`)
              : undefined}
            coverage={fin.materialCoverage} coverageLabel={t('tööl on omahind', 'jobs have a cost price')} />
          {fin.fixedCostTotal > 0 && (
            <StatTile money size="sm" icon={Package} label={t('Fikseeritud kulud', 'Fixed costs')} value={fin.fixedCostTotal} accent="#8B5CF6"
              sub={`${settings.fixedCostsPerJob.map(c => c.nimi).join(', ')}`} />
          )}
          {fin.overheadCost > 0 && (
            <StatTile money size="sm" icon={Building2} label={t('Üldkulud', 'Overheads')} value={fin.overheadCost} accent="#64748B"
              sub={t(`${settings.yldkulud.map(o => o.nimi).join(', ')} — perioodi osa`, `${settings.yldkulud.map(o => o.nimi).join(', ')} — share for the period`)} />
          )}
          <StatTile money size="sm" icon={Repeat} label={t('Muudatuste kahju', 'Cost of revisions')} value={fin.revisionLossTotal} accent="#EC4899"
            sub={t('tööjõud + materjal − tasutud', 'labour + material − charged')} />
        </div>
      </section>

      {/* ── By work type ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">
          {t('Kate töö tüübi järgi', 'Margin by work type')}
        </h3>
        {/* Said once, here, rather than left for the reader to deduce from a
            footer that does not add up to the headline. */}
        <p className="text-[11px] text-ink-faint mb-3 max-w-2xl leading-relaxed">
          {t('Ridade ühik on', 'The unit of each row is the')} <strong className="text-ink-muted">{t('tööosa', 'work item')}</strong>{t(
            `, mitte töö: mitme tööosaga töö jaguneb oma tüüpide vahel, seega on veerg „Tööosi" summa suurem kui tööde arv (${unitSplitLabel(m)}). Muudatused lisavad hambaid ja kulu, aga mitte tööosi — rida kujul „0 tööosa · hambaid · negatiivne kate" on eelmisest perioodist pärit töö tasuta ümbertegemine ja on niimoodi õige.`,
            `, not the job: a job with several work items is split across its types, so the “Work items” column adds up to more than the number of jobs (${unitSplitLabel(m)}). Revisions add teeth and cost but not work items — a row reading “0 work items · teeth · negative margin” is a free remake of a job from an earlier period, and that is correct.`,
          )}
        </p>
        {fin.byWorkType.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">{t('Andmed puuduvad', 'No data')}</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">{t('Töö tüüp', 'Work type')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Tööosi', 'Work items')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Hambaid', 'Teeth')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Tulu', 'Income')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kulu', 'Cost')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Tööjõud', 'Labour')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Materjal', 'Material')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kate', 'Margin')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kate %', 'Margin %')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kesk. tulu', 'Avg income')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kesk. kulu', 'Avg cost')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kesk. kate', 'Avg margin')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('€/hammas tulu', 'Income €/tooth')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('€/hammas kulu', 'Cost €/tooth')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('€/hammas kate', 'Margin €/tooth')}</th>
                </tr>
              </thead>
              <tbody>
                {/* A COPY. `fin.byWorkType` is memoised inside calculateFinance and
                    sorting it in place mutated the aggregator's own result mid-render. */}
                {[...fin.byWorkType]
                  .sort((a, b) => b.revenue - a.revenue)
                  .map(type => {
                    const img = workTypeImage(type.name)
                    const avgIncome = type.jobs > 0 ? type.income / type.jobs : 0
                    const avgCost = type.jobs > 0 ? (type.labour + type.material + type.costs) / type.jobs : 0
                    return (
                      <tr key={type.name} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {img
                              ? <img src={img} alt="" className="w-6 h-6 object-contain flex-shrink-0" />
                              : <span className="w-3 h-3 rounded flex-shrink-0" style={{ backgroundColor: wt.hex(type.name) }} />
                            }
                            <span className="text-ink font-medium truncate">{type.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{type.jobs}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-faint">{type.teeth || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{type.income.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{type.costs > 0 ? type.costs.toFixed(2) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{type.labour.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{type.material.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          type.margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {type.margin.toFixed(2)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${
                          type.marginPct >= 0 ? 'text-ink-muted' : 'text-red-500'}`}>
                          {type.income > 0 ? `${type.marginPct.toFixed(0)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-muted">
                          {type.jobs > 0 ? `${avgIncome.toFixed(0)} €` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-muted">
                          {type.jobs > 0 ? `${avgCost.toFixed(0)} €` : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums text-xs ${type.margin >= 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                          {type.jobs > 0 ? `${(type.margin / type.jobs).toFixed(0)} €` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-emerald-600">
                          {type.teeth > 0 ? `${(type.income / type.teeth).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-red-400">
                          {type.teeth > 0 ? `${((type.labour + type.material + type.costs) / type.teeth).toFixed(2)}` : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums text-xs ${type.margin >= 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                          {type.teeth > 0 ? `${(type.margin / type.teeth).toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-faint/20 bg-bg-sidebar/60 font-semibold text-xs">
                  <td className="px-3 py-2 text-ink-muted">{t('Kokku', 'Total')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {fin.byWorkType.reduce((s, type) => s + type.jobs, 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                    {fin.byWorkType.reduce((s, type) => s + type.teeth, 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {fin.byWorkType.reduce((s, type) => s + type.income, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {fin.byWorkType.reduce((s, type) => s + type.costs, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {fin.byWorkType.reduce((s, type) => s + type.labour, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {fin.byWorkType.reduce((s, type) => s + type.material, 0).toFixed(2)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${
                    fin.byWorkType.reduce((s, type) => s + type.margin, 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {fin.byWorkType.reduce((s, type) => s + type.margin, 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {(() => {
                      const totalIncome = fin.byWorkType.reduce((s, type) => s + type.income, 0)
                      const totalMargin = fin.byWorkType.reduce((s, type) => s + type.margin, 0)
                      return totalIncome > 0 ? `${(totalMargin / totalIncome * 100).toFixed(0)}%` : '—'
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-muted">
                    {(() => {
                      const tj = fin.byWorkType.reduce((s, type) => s + type.jobs, 0)
                      const ti = fin.byWorkType.reduce((s, type) => s + type.income, 0)
                      return tj > 0 ? `${(ti / tj).toFixed(0)} €` : '—'
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-muted">
                    {(() => {
                      const tj = fin.byWorkType.reduce((s, type) => s + type.jobs, 0)
                      const tc = fin.byWorkType.reduce((s, type) => s + type.labour + type.material + type.costs, 0)
                      return tj > 0 ? `${(tc / tj).toFixed(0)} €` : '—'
                    })()}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums text-xs ${fin.byWorkType.reduce((s, type) => s + type.margin, 0) >= 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                    {(() => {
                      const tj = fin.byWorkType.reduce((s, type) => s + type.jobs, 0)
                      const tm = fin.byWorkType.reduce((s, type) => s + type.margin, 0)
                      return tj > 0 ? `${(tm / tj).toFixed(0)} €` : '—'
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-emerald-600">
                    {(() => {
                      const tt = fin.byWorkType.reduce((s, type) => s + type.teeth, 0)
                      const ti = fin.byWorkType.reduce((s, type) => s + type.income, 0)
                      return tt > 0 ? (ti / tt).toFixed(2) : '—'
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-red-400">
                    {(() => {
                      const tt = fin.byWorkType.reduce((s, type) => s + type.teeth, 0)
                      const tc = fin.byWorkType.reduce((s, type) => s + type.labour + type.material + type.costs, 0)
                      return tt > 0 ? (tc / tt).toFixed(2) : '—'
                    })()}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums text-xs ${fin.byWorkType.reduce((s, type) => s + type.margin, 0) >= 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                    {(() => {
                      const tt = fin.byWorkType.reduce((s, type) => s + type.teeth, 0)
                      const tm = fin.byWorkType.reduce((s, type) => s + type.margin, 0)
                      return tt > 0 ? (tm / tt).toFixed(2) : '—'
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-[11px] text-ink-faint mt-2">
          {t(
            'Tühi "Arveldatud" tähendab, et selle tüübi töid ei ole veel arveldatud — kate on siis negatiivne, sest kulu on olemas ja tulu mitte.',
            'An empty "Invoiced" means jobs of this type have not been invoiced yet — the margin is then negative, because the cost exists and the income does not.',
          )}
        </p>
      </section>

      {/* ── Revision loss ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          {t('Muudatuste kahju põhjuse järgi', 'Cost of revisions by reason')}
        </h3>
        {fin.revisionLoss.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">{t('Muudatusi ei olnud', 'There were no revisions')}</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">{t('Põhjus', 'Reason')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Kordi', 'Times')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Tööjõud', 'Labour')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Materjal', 'Material')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Tasutud', 'Charged')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Netokahju', 'Net loss')}</th>
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
          {t(
            'Netokahju = mis ümbertegemine maksis, miinus see, mis selle eest küsiti. Kui muudatused ei ole tasureeglis tasustatud, on tööjõukulu 0 — ümbertegemise aeg läheb siis kaotsi tööajana, mitte rahana.',
            'Net loss = what the remake cost, minus what was charged for it. If revisions are not paid under the pay rules, the labour cost is 0 — the remake time is then lost as working time, not as money.',
          )}
        </p>
      </section>

      {/* ── How clients paid ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          {t('Maksmise viis', 'Payment method')}
        </h3>
        {fin.byPaymentMethod.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">
            {t('Sellel perioodil ei ole makseid registreeritud.', 'No payments recorded in this period.')}
          </div>
        ) : (
          <div className="card p-4 space-y-2.5">
            {fin.byPaymentMethod.map(m => (
              <div key={m.method}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-ink font-medium">{m.label}</span>
                  <span className="text-ink-muted tabular-nums">
                    {t(`${m.count} makset`, `${m.count} ${m.count === 1 ? 'payment' : 'payments'}`)} · <span className="font-semibold text-ink">{m.amount.toFixed(2)} €</span>
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
              {t('Arvestatakse perioodil', 'Counts payments')} <strong className="text-ink-muted">{t('laekunud', 'received')}</strong>{t(
                ' makseid, mitte väljastatud arveid — küsimus on, kuidas raha päriselt kohale jõuab. Sisaldab nii arvete makseid kui ka töö juures "Makstud" märkimisi.',
                ' in the period, not invoices issued — the question is how the money actually arrives. Includes both invoice payments and jobs marked "Paid".',
              )}
            </p>
          </div>
        )}
      </section>

      {/* ── By worker ── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          {t('Töötajate kaupa', 'By employee')}
        </h3>
        {fin.byWorker.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-faint">
            {t('Ühelegi tööle ei ole teostajat määratud.', 'No job has an assignee.')}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-3 py-2 font-semibold">{t('Töötaja', 'Employee')}</th>
                  {/* The engagement cell existed in every row but had no header,
                      so all five columns to its right were labelled with their
                      left-hand neighbour's name. */}
                  <th className="px-3 py-2 font-semibold">{t('Töösuhe', 'Employment')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Töid', 'Jobs')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Hambaid', 'Teeth')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Arvestatud', 'Earned')}</th>
                  <th className="px-3 py-2 font-semibold text-right">{t('Välja makstud', 'Paid out')}</th>
                </tr>
              </thead>
              <tbody>
                {fin.byWorker.map(w => (
                  <tr key={w.profileId} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                    <td className="px-3 py-2 text-ink">{w.name}</td>
                    <td className="px-3 py-2 text-ink-muted text-xs">
                      {w.engagement === 'ettevote' ? t('Esitab arve', 'Contractor') : t('Palgal', 'On payroll')}
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
