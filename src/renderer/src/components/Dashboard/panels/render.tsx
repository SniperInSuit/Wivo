/**
 * How each panel draws itself. One entry per catalogue id — the `Record` type
 * makes a missing one a compile error.
 *
 * Every function here is a PURE RENDERER over `PanelCtx`. Filter, sort a copy,
 * format, pick a colour. Do not compute a named number: `periodMetrics` and
 * `calculateFinance` are the only places allowed to decide what a figure means,
 * and a dashboard whose cards each do their own arithmetic is the 19-vs-15 bug
 * with forty places to hide.
 */
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts'
import {
  Euro, Wallet, Clock, FileWarning, Users, TrendingUp, Timer,
  Repeat, Layers, AlertCircle, Cpu, CheckCircle, Stethoscope, UserPlus, Zap, Percent,
  Package, CalendarDays, Truck, Smile, Award, HandCoins,
} from 'lucide-react'
import { StatTile } from '../../ui/StatTile'
import { CHART_COLORS, TOOLTIP_STYLE, NAME_AXIS_WIDTH, truncateName } from '../chartTheme'
import { unitSplitLabel, teethSplitLabel, MONEY_HINT } from '../../../lib/periodMetrics'
import { debtBuckets } from '../../../lib/debtors'
import { Gauge } from './Gauge'
import { metricOfPanel } from './metrics'
import type { PanelCtx } from '../useStatsContext'
import type { PanelId } from './catalogue'
import { t } from '@/lib/i18n'
import { revisionReasonText } from '@/types/job'

export type PanelRender = (ctx: PanelCtx) => React.ReactNode

const eur = (n: number): string => `${n.toFixed(2)} €`
const pct = (n: number): string => `${n.toFixed(1)}%`

/** A card with a heading, for panels that are not a single tile. */
function Block({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 h-full flex flex-col">
      <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{title}</h3>
      {sub && <p className="text-[11px] text-ink-faint mt-0.5 leading-relaxed">{sub}</p>}
      {/* min-h-0 lets a chart's ResponsiveContainer measure a real height, and
          overflow-auto keeps a long list inside a short panel instead of
          spilling over the card below it. */}
      <div className="mt-3 flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-faint py-6 text-center">{children}</p>
}

/** Label/value rows, for panels that are several small facts rather than one. */
function Facts({ rows }: { rows: { label: string; value: React.ReactNode; muted?: boolean }[] }) {
  return (
    <div className="divide-y divide-ink-faint/10">
      {rows.map(r => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-[11px] text-ink-faint">{r.label}</span>
          <span className={`text-sm tabular-nums ${r.muted ? 'text-ink-muted' : 'text-ink font-semibold'}`}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Horizontal share bars — the pattern the old page hand-rolled three times. */
function ShareBars({ rows }: { rows: { label: string; value: string; share: number; color?: string }[] }) {
  if (rows.length === 0) return <Empty>{t('dashboard.noData4')}</Empty>
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="flex justify-between text-[11px] mb-0.5">
            <span className="text-ink-muted truncate">{r.label}</span>
            <span className="tabular-nums text-ink font-medium flex-shrink-0 ml-2">{r.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-sidebar overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, Math.min(100, r.share))}%`,
                backgroundColor: r.color ?? CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export const PANEL_RENDER: Record<PanelId, PanelRender> = {
  // ── Raha ja kasum ──────────────────────────────────────────────────────────
  'raha.kasum': ctx => (
    <StatTile
      icon={TrendingUp} label={t('dashboard.profitIncomeCost')} value={eur(ctx.profit.profit)}
      accent={ctx.profit.profit >= 0 ? '#22C55E' : '#EF4444'}
      sub={t('dashboard.margin3', { profitPct: pct(ctx.profit.profitPct) })}
      // Both coverages, because this number subtracts both. The overhead caveat
      // is separate: subtracting an unentered zero and calling it profit is the
      // same lie as a margin that ignores labour.
      coverage={ctx.fin.labourCoverage} coverageLabel={t('dashboard.jobsHaveAnAssignee')}
    />
  ),

  'raha.kulud': ctx => (
    <Block title={t('dashboard.totalCost')} sub={eur(ctx.profit.costs)}>
      <ShareBars rows={[
        { label: t('dashboard.labourTaxes'), value: eur(ctx.profit.labour), share: share(ctx.profit.labour, ctx.profit.costs) },
        { label: t('dashboard.materialsAndSupplies'), value: eur(ctx.profit.material), share: share(ctx.profit.material, ctx.profit.costs) },
        { label: t('dashboard.fixed2'), value: eur(ctx.profit.fixed), share: share(ctx.profit.fixed, ctx.profit.costs) },
        { label: t('dashboard.overheads2'), value: eur(ctx.profit.overheads), share: share(ctx.profit.overheads, ctx.profit.costs) },
      ].filter(r => r.value !== '0.00 €')} />
      {ctx.profit.overheads === 0 && (
        <p className="text-[11px] text-orange-500 mt-2 leading-relaxed">
          {t('dashboard.noOverheadsEnteredThisIsMargin')}
        </p>
      )}
    </Block>
  ),

  'raha.kate': ctx => (
    <StatTile
      icon={Percent} label={t('dashboard.grossMargin')} value={eur(ctx.fin.grossMargin)}
      sub={t('dashboard.ofInvoicedNetMargin', { grossMarginPct: pct(ctx.fin.grossMarginPct), netMargin: eur(ctx.fin.netMargin), netMarginPct: pct(ctx.fin.netMarginPct) })}
      accent="#6366F1"
      coverage={ctx.fin.materialCoverage} coverageLabel={t('dashboard.jobsHaveACostPrice')}
    />
  ),

  'raha.kaive': ctx => (
    <StatTile icon={Euro} label={t('dashboard.revenue')} value={eur(ctx.m.money)} sub={MONEY_HINT.kaive} />
  ),

  'raha.arveldatud': ctx => (
    <StatTile icon={Euro} label={t('dashboard.invoiced')} value={eur(ctx.fin.billed)} sub={MONEY_HINT.arveldatud} />
  ),

  'raha.laekunud': ctx => (
    <StatTile icon={Wallet} label={t('dashboard.received')} value={eur(ctx.fin.received)} sub={MONEY_HINT.laekunud} accent="#22C55E" />
  ),

  'raha.tasumata': ctx => (
    <StatTile
      icon={Clock} label={t('dashboard.unpaidByInvoice')} value={eur(ctx.fin.outstanding)} accent="#F59E0B"
      sub={ctx.fin.overdue > 0
        ? t('dashboard.overdue4', { overdue: eur(ctx.fin.overdue) })
        : t('dashboard.issuedInvoicesOnlyWorkWithoutAn')}
    />
  ),

  'raha.arveldamata': ctx => (
    <StatTile
      icon={FileWarning} label={t('dashboard.notInvoiced')} value={eur(ctx.fin.unbilled)} accent="#EF4444"
      sub={t('dashboard.finishedWithoutAnInvoiceJobJobs2', { ctx, unbilledJobs: ctx.fin.unbilledJobs })}
    />
  ),

  'raha.toojoukulu': ctx => (
    <StatTile
      icon={Users} label={t('dashboard.labourTaxesInvoices')} value={eur(ctx.fin.labourAccrued + ctx.profit.employerTax)}
      accent="#8B5CF6"
      sub={[
        t('dashboard.gross2', { labourEmployeeGross: eur(ctx.fin.labourEmployeeGross) }),
        ctx.profit.employerTax > 0 ? t('dashboard.taxes2', { employerTax: eur(ctx.profit.employerTax) }) : null,
        ctx.fin.labourContractor > 0 ? t('dashboard.contractorInvoices2', { labourContractor: eur(ctx.fin.labourContractor) }) : null,
      ].filter(Boolean).join(' · ')}
      coverage={ctx.fin.labourCoverage} coverageLabel={t('dashboard.jobsHaveAnAssignee')}
    />
  ),

  'raha.valjamakstud': ctx => (
    <StatTile
      icon={Wallet} label={t('dashboard.earnedVsPaidOut')} value={eur(ctx.fin.labourAccrued)}
      accent="#8B5CF6"
      sub={t('dashboard.paidOutUnpaid', { labourPaid: eur(ctx.fin.labourPaid), eur: eur(Math.max(0, ctx.fin.labourAccrued - ctx.fin.labourPaid)) })}
    />
  ),

  'raha.kaive_kuude_kaupa': ctx => (
    <Block title={t('dashboard.revenueByMonth2')}>
      {ctx.stats.revenueByMonth.length === 0 ? <Empty>{t('dashboard.noData4')}</Empty> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ctx.stats.revenueByMonth}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => eur(v)} />
            <Bar dataKey="revenue" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Block>
  ),

  'raha.maksmise_viis': ctx => (
    <Block title={t('dashboard.paymentMethod')} sub={t('dashboard.howTheMoneyActuallyComesIn')}>
      <ShareBars rows={ctx.fin.byPaymentMethod.map(p => ({
        label: `${p.label} · ${p.count}×`,
        value: eur(p.amount),
        share: p.share,
      }))} />
    </Block>
  ),

  'raha.muudatuste_kahju': ctx => (
    <Block title={t('dashboard.costOfRevisions')} sub={t('dashboard.totalNetLoss', { revisionLossTotal: eur(ctx.fin.revisionLossTotal) })}>
      <ShareBars rows={ctx.fin.revisionLoss.slice(0, 6).map(r => ({
        label: `${r.reason} · ${r.count}×`,
        value: eur(r.net),
        share: share(r.net, ctx.fin.revisionLossTotal),
        color: '#EC4899',
      }))} />
    </Block>
  ),


  // ── Võlglased ──────────────────────────────────────────────────────────────
  // All-time, and every one of these says so on screen. A debt does not expire
  // because the date filter moved.
  'raha.volglased_kokku': ctx => (
    <StatTile
      icon={HandCoins} label={t('dashboard.totalOwed')} value={eur(ctx.debt.outstanding)}
      accent={ctx.debt.overdue > 0 ? '#EF4444' : '#F59E0B'}
      sub={ctx.debt.count === 0
        ? t('dashboard.nobodyOwesAnythingAllTime')
        : t('dashboard.overdueAllTimeDebtorDebtors', { ctx, eur, count: ctx.debt.count, overdue: eur(ctx.debt.overdue) })}
    />
  ),

  'raha.volglased': ctx => {
    const rows = ctx.debt.rows.slice(0, 10)
    const worst = rows[0]?.outstanding ?? 0
    return (
      <Block
        title={t('dashboard.whoOwes')}
        sub={t('dashboard.allTimeNotInvoicedIsNot', { uninvoiced: eur(ctx.debt.uninvoiced) })}
      >
        {rows.length === 0
          ? <Empty>{t('dashboard.noJobIsUnpaid')}</Empty>
          : <ShareBars rows={rows.map(r => ({
              label: `${r.nimi}${r.daysLate > 0 ? t('dashboard.dOverdue', { daysLate: r.daysLate }) : r.partial ? t('dashboard.partlyPaid') : ''}`,
              value: eur(r.outstanding),
              share: share(r.outstanding, worst),
              // Red is a claim: it means a bill was sent and its date passed.
              color: r.overdue > 0 ? '#EF4444' : r.uninvoiced > 0 ? '#94A3B8' : '#F59E0B',
            }))} />}
      </Block>
    )
  },

  'raha.volg_vanus': ctx => {
    const buckets = debtBuckets(ctx.debt)
    const worst = Math.max(...buckets.map(b => b.amount), 1)
    return (
      <Block title={t('dashboard.debtAge')} sub={t('dashboard.fromTheInvoiceDueDateNot')}>
        {ctx.debt.overdue === 0
          ? <Empty>{t('dashboard.noSentInvoiceIsOverdue')}</Empty>
          : <ShareBars rows={buckets.filter(b => b.amount > 0).map(b => ({
              // The label stays Estonian in lib/debtors (the colour below compares it); only its unit is swapped here.
              label: `${b.label.replace(/ p$/, ` ${t('dashboard.daysShort')}`)} · ${b.count}`,
              value: eur(b.amount),
              share: share(b.amount, worst),
              color: b.label === '90+ p' ? '#B91C1C' : b.label === '61–90 p' ? '#EF4444' : '#F59E0B',
            }))} />}
      </Block>
    )
  },

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  'yhik.hind_hamba_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label={t('dashboard.pricePerTooth')} value={eur(ctx.stats.avgPricePerTooth)}
      sub={t('dashboard.toothTeeth3', { ctx, teethSplitLabel, hambad: ctx.m.hambad, m: teethSplitLabel(ctx.m) })}
    />
  ),

  'yhik.tulu_too_kohta': ctx => (
    <StatTile
      icon={Euro} label={t('dashboard.priceJob')} value={eur(ctx.stats.avgPrice)}
      sub={unitSplitLabel(ctx.m)}
      coverage={ctx.stats.priceCoverage} coverageLabel={t('dashboard.jobsHaveAPrice')}
    />
  ),

  'yhik.kiirtoo_tasuvus': ctx => (
    <StatTile
      icon={Zap} label={t('dashboard.rushJobPayoff')} value={t('dashboard.jobJobs3', { ctx, kiirtooJobsCount: ctx.stats.kiirtooJobs.length })}
      accent="#F97316"
      sub={ctx.m.money > 0
        ? t('dashboard.ofRevenue2', { kiirtooRevenue: eur(ctx.stats.kiirtooRevenue), pct: pct(share(ctx.stats.kiirtooRevenue, ctx.m.money)) })
        : t('dashboard.revenue3', { kiirtooRevenue: eur(ctx.stats.kiirtooRevenue) })}
    />
  ),

  'yhik.kate_tootyybi_jargi': ctx => {
    // A COPY — fin.byWorkType is memoised inside the aggregator.
    const rows = [...ctx.fin.byWorkType].sort((a, b) => b.margin - a.margin)
    return (
      <Block title={t('dashboard.marginByWorkType')} sub={t('dashboard.theUnitIsTheWorkItem')}>
        {rows.length === 0 ? <Empty>{t('dashboard.noFinishedJobs')}</Empty> : (
          <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-2 py-1.5 font-semibold">{t('dashboard.workType')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.workItems')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.teeth')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.income')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.labour2')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.material2')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.margin')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.margin2')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.marginTooth')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(type => (
                  <tr key={type.name} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: ctx.wt.hex(type.name) }} />
                        <span className="text-ink font-medium truncate">{type.name}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{type.jobs}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-faint">{type.teeth || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">{type.income.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{type.labour.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{type.material.toFixed(2)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${type.margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {type.margin.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{type.marginPct.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-faint">
                      {type.teeth > 0 ? (type.margin / type.teeth).toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    )
  },

  'yhik.kahjumlikud': ctx => {
    const losing = [...ctx.fin.byWorkType].filter(type => type.margin < 0).sort((a, b) => a.margin - b.margin)
    return (
      <Block
        title={t('dashboard.lossMakingWorkTypes')}
        sub={t('dashboard.aTypeCanShowALoss')}
      >
        {losing.length === 0
          ? <Empty>{t('dashboard.noWorkTypeHasANegative')}</Empty>
          : <ShareBars rows={losing.slice(0, 6).map(type => ({
              label: type.name,
              value: eur(type.margin),
              share: share(Math.abs(type.margin), Math.abs(losing[0].margin)),
              color: '#EF4444',
            }))} />}
      </Block>
    )
  },

  // ── Tootmine ja tähtajad ───────────────────────────────────────────────────
  'toot.tood_kokku': ctx => (
    <StatTile
      icon={Layers} label={t('dashboard.jobsTotal')} value={ctx.m.yksused} sub={unitSplitLabel(ctx.m)}
      scope={ctx.period === 'all' ? t('dashboard.allTime') : undefined}
    />
  ),

  'toot.hambaid': ctx => (
    <StatTile
      icon={CheckCircle} label={t('dashboard.teethProduced')} value={ctx.m.hambad} sub={teethSplitLabel(ctx.m)}
      accent="#22C55E"
    />
  ),

  'toot.tahtajast_yle': ctx => (
    <StatTile
      icon={AlertCircle} label={t('dashboard.overdue3')} value={ctx.stats.overdue.length} accent="#EF4444"
      sub={t('dashboard.unfinishedPastDueDate')} scope={t('dashboard.rightNow')}
    />
  ),

  'toot.labiaeg': ctx => (
    <StatTile
      icon={Timer} label={t('dashboard.turnaround')}
      value={ctx.stats.avgTurnaround > 0 ? t('dashboard.d', { avgTurnaround: ctx.stats.avgTurnaround.toFixed(1) }) : '—'}
      sub={t('dashboard.fromReceiptToCompletion')} accent="#8B5CF6"
      coverage={ctx.stats.turnaroundCoverage} coverageLabel={t('dashboard.jobsHaveACompletionDate')}
    />
  ),

  'toot.muudatuste_maar': ctx => (
    <StatTile
      icon={Repeat} label={t('dashboard.revisionRate')} value={pct(ctx.stats.revisionRate)}
      accent={ctx.stats.revisionRate > 15 ? '#EF4444' : '#EC4899'}
      // `filtered.length`, not `totalWork`: the rate is jobs-with-a-revision
      // over JOBS, and `totalWork` is units. The old line printed a denominator
      // the percentage above it was never computed from.
      sub={t('dashboard.ofJobJobs', { ctx, withRevisionCount: ctx.stats.withRevision.length, filteredCount: ctx.stats.filtered.length })}
    />
  ),

  'toot.wip': ctx => (
    <Block title={t('dashboard.inProgressByStage')} sub={t('dashboard.currentStateNotAFigureFor')}>
      {ctx.stats.wipByStage.length === 0 ? <Empty>{t('dashboard.noJobsInProgress')}</Empty> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ctx.stats.wipByStage}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} fill={CHART_COLORS[1]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Block>
  ),

  'toot.valmis_kuude_kaupa': ctx => (
    <Block title={t('dashboard.finishedJobsByMonth')}>
      {ctx.stats.throughput.length === 0 ? <Empty>{t('dashboard.noData4')}</Empty> : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={ctx.stats.throughput}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-ink-faint) / 0.15)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="count" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Block>
  ),

  'toot.muudatuste_pohjused': ctx => {
    const total = ctx.stats.revisionReasons.reduce((s, r) => s + r.count, 0)
    return (
      <Block
        title={t('dashboard.revisionReasons')}
        sub={t('dashboard.aRevisionWithTwoReasonsCounts')}
      >
        <ShareBars rows={ctx.stats.revisionReasons.slice(0, 8).map(r => ({
          label: r.name,
          value: `${r.count}×`,
          share: share(r.count, total),
          color: '#EC4899',
        }))} />
      </Block>
    )
  },

  // Ranked by COUNT. `stats.byWorkType` arrives sorted by revenue, which
  // answers a different question — the most valuable type and the most common
  // one are routinely not the same, and a lab asking "what do we make" is not
  // asking "what pays". Sorted on a COPY: the array is memoised inside the
  // aggregator and sorting it in place would reorder it for every other panel.
  'toot.tooliigid': ctx => {
    const rows = [...ctx.stats.byWorkType].filter(type => type.count > 0).sort((a, b) => b.count - a.count)
    const top = rows[0]?.count ?? 0
    return (
      <Block title={t('dashboard.whatWeMakeMost')} sub={t('dashboard.numberOfJobsPerTypeIn')}>
        <ShareBars rows={rows.map(type => ({
          label: type.name,
          // Both numbers, because neither answers it alone: a denture is one
          // job and fourteen teeth, a single crown is one of each.
          value: t('dashboard.jobJobsToothTeeth', { type, count: type.count, teeth: type.teeth }),
          share: share(type.count, top),
          color: ctx.wt.hex(type.name),
        }))} />
      </Block>
    )
  },

  // Reads `ctx.units`, NOT `stats.byWorkType`. The latter buckets by the
  // job-level `too` and counts the job-level `hambad`, so a case holding
  // crowns and a bridge files all of its teeth under the crown — see
  // lib/unitsByType. For "how many crowns have we made" that is the whole
  // question, answered wrong.
  'toot.tooliigid_hambad': ctx => {
    const { rows, unplacedRedone } = ctx.units
    const top = rows[0]?.teeth ?? 0
    return (
      <Block title={t('dashboard.unitsByWorkType')} sub={t('dashboard.teethByWorkItemNotBy')}>
        {rows.length === 0 ? <Empty>{t('dashboard.noData4')}</Empty> : (
          <>
            <ShareBars rows={rows.map(type => ({
              label: type.name,
              // Items as well as teeth: a four-unit bridge is one item and four
              // teeth, and which of those a lab calls "a unit" depends on what
              // it is pricing.
              value: t('dashboard.pcsToothTeeth', { type, teeth: type.teeth, items: type.items }),
              share: share(type.teeth, top),
              color: ctx.wt.hex(type.name),
            }))} />
            {rows.some(type => type.redone > 0) && (
              <p className="mt-2 text-[10px] text-ink-faint">
                {t('dashboard.remadeTeethAreNotIncludedHere')}{' '}
                {rows.filter(type => type.redone > 0).map(type => `${type.name} ${type.redone}`).join(' · ')}
              </p>
            )}
            {unplacedRedone > 0 && (
              // Reported rather than spread across the types — see unitsByType.
              <p className="mt-1 text-[10px] text-ink-faint">
                {t('dashboard.remadeCouldNotBeLinkedTo', { unplacedRedone })}
              </p>
            )}
          </>
        )}
      </Block>
    )
  },

  'toot.materjalid': ctx => (
    <Block title={t('dashboard.jobsByMaterial')}>
      {ctx.stats.materialStats.length === 0 ? <Empty>{t('dashboard.noMaterialsRecorded')}</Empty> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ctx.stats.materialStats} layout="vertical" margin={{ left: 0, right: 12 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis
              type="category" dataKey="name" width={NAME_AXIS_WIDTH} interval={0}
              tick={{ fontSize: 11 }} tickFormatter={truncateName}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="count" fill={CHART_COLORS[2]} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Block>
  ),

  'toot.masinad': ctx => {
    const top = ctx.stats.machineStats[0]
    return (
      <StatTile
        icon={Cpu} label={t('dashboard.machineLoad')}
        value={top ? `${top.count}` : '—'}
        sub={top
          ? `${top.name}${ctx.stats.machineStats[1] ? ` · ${ctx.stats.machineStats[1].name} ${ctx.stats.machineStats[1].count}` : ''}`
          : t('dashboard.noMachinesRecorded')}
        accent="#6366F1"
      />
    )
  },

  // ── Kliendid ja inimesed ───────────────────────────────────────────────────
  'inim.tootajad': ctx => (
    <Block title={t('dashboard.byEmployee')} sub={t('dashboard.earnedIsWhatThisPeriodEarned')}>
      {ctx.fin.byWorker.length === 0 ? <Empty>{t('dashboard.noJobHasAnAssignee')}</Empty> : (
        <div className="overflow-auto h-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                <th className="px-2 py-1.5 font-semibold">{t('dashboard.employee')}</th>
                <th className="px-2 py-1.5 font-semibold">{t('dashboard.employment')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.jobs')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.teeth')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.earned')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.gross3')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('dashboard.paidOut')}</th>
              </tr>
            </thead>
            <tbody>
              {ctx.fin.byWorker.map(w => (
                <tr key={w.profileId} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                  <td className="px-2 py-1.5 text-ink">{w.name}</td>
                  <td className="px-2 py-1.5 text-ink-muted text-xs">
                    {w.engagement === 'ettevote' ? t('dashboard.contractor') : t('dashboard.onPayroll')}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{w.jobs}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{w.teeth}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-ink">{w.earned.toFixed(2)}</td>
                  {/* Differs from "Arvestatud" only for a net agreement — and
                      that difference is the clinic's real wage cost. */}
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{w.grossPay.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{w.paidOut.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  ),

  'inim.tootaja_tootlikkus': ctx => {
    const rows = [...ctx.fin.byWorker].sort((a, b) => b.teeth - a.teeth)
    const top = rows[0]?.teeth ?? 0
    return (
      <Block title={t('dashboard.employeeWorkload')} sub={t('dashboard.jobsAndTeethPerPerson')}>
        <ShareBars rows={rows.map(w => ({
          label: t('dashboard.jobJobs4', { w, name: w.name, jobs: w.jobs }),
          value: t('dashboard.toothTeeth4', { w, teeth: w.teeth }),
          share: share(w.teeth, top),
        }))} />
      </Block>
    )
  },

  'inim.katvus': ctx => (
    <StatTile
      icon={AlertCircle} label={t('dashboard.dataCoverage')}
      value={`${ctx.fin.labourCoverage.covered}/${ctx.fin.labourCoverage.total}`}
      accent="#F59E0B"
      sub={t('dashboard.jobsHaveAnAssigneeCostPrice', { covered: ctx.fin.materialCoverage.covered, total: ctx.fin.materialCoverage.total })}
    />
  ),

  'inim.patsiendid': ctx => (
    <StatTile
      icon={UserPlus} label={t('dashboard.patients')} value={ctx.stats.patientSummary.total}
      sub={t('dashboard.newReturning', { newPatients: ctx.stats.patientSummary.newPatients, repeatPatients: ctx.stats.patientSummary.repeatPatients })}
      accent="#6366F1"
    />
  ),

  'inim.visiidid': ctx => (
    <StatTile
      icon={Stethoscope} label={t('dashboard.visits')} value={ctx.stats.visitStats.total}
      sub={t('dashboard.noShowsMin', { noShowRate: pct(ctx.stats.visitStats.noShowRate), avgKestus: ctx.stats.visitStats.avgKestus.toFixed(0) })}
      accent="#EC4899"
    />
  ),

  'inim.arstid': ctx => (
    <Block title={t('dashboard.topReferringDentists')} sub={t('dashboard.byRevenue')}>
      <ShareBars rows={ctx.stats.byDoctor.slice(0, 8).map(d => ({
        label: d.name,
        value: eur(d.revenue),
        share: share(d.revenue, ctx.stats.byDoctor[0]?.revenue ?? 0),
      }))} />
    </Block>
  ),

  // ── Raha: arvete pool ──────────────────────────────────────────────────────
  'raha.vanus': ctx => (
    <Block
      title={t('dashboard.outstandingByAge')}
      sub={t('dashboard.overdueNotYetDue', { agingTotal: eur(ctx.invoices.agingTotal), notDue: eur(ctx.invoices.notDue) })}
    >
      {ctx.invoices.agingTotal === 0
        ? <Empty>{t('dashboard.noInvoiceIsOverdue')}</Empty>
        : <ShareBars rows={ctx.invoices.aging.filter(b => b.amount > 0).map((b, i) => ({
            label: t('dashboard.invoiceInvoices', { b, label: b.label, count: b.count }),
            value: eur(b.amount),
            share: share(b.amount, ctx.invoices.agingTotal),
            // Older debt reads redder, because it is.
            color: ['#F59E0B', '#F97316', '#EF4444', '#B91C1C'][i] ?? '#EF4444',
          }))} />}
    </Block>
  ),

  'raha.laekumisaeg': ctx => (
    <StatTile
      icon={Clock} label={t('dashboard.averageTimeToPayment')}
      value={ctx.invoices.daysToPay === null ? '—' : t('dashboard.d4', { daysToPay: ctx.invoices.daysToPay })}
      accent="#6366F1"
      sub={ctx.invoices.daysToPay === null
        ? t('dashboard.noInvoiceWasPaidInFull')
        : t('dashboard.basedOnInvoiceToMoneyInvoice', { ctx, daysToPaySample: ctx.invoices.daysToPaySample })}
    />
  ),

  'raha.kaibemaks': ctx => (
    <StatTile
      icon={Percent} label={t('dashboard.vATInThePeriod')} value={eur(ctx.invoices.vat)}
      accent="#64748B" sub={t('dashboard.onIssuedInvoicesOwedToThe')}
    />
  ),

  'raha.keskmine_arve': ctx => (
    <StatTile
      icon={Euro} label={t('dashboard.averageInvoice')} value={eur(ctx.invoices.averageInvoice)}
      sub={t('dashboard.totalInvoiceInvoices', { ctx, eur, issuedCount: ctx.invoices.issuedCount, issued: eur(ctx.invoices.issued) })}
    />
  ),

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  'yhik.kasum_too_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label={t('dashboard.profitPerJob')}
      value={ctx.unit.profitPerJob === null ? '—' : eur(ctx.unit.profitPerJob)}
      accent={(ctx.unit.profitPerJob ?? 0) >= 0 ? '#22C55E' : '#EF4444'}
      sub={t('dashboard.revisionsAreNotSeparateJobsJob', { ctx, tood: ctx.m.tood })}
      coverage={ctx.fin.labourCoverage} coverageLabel={t('dashboard.jobsHaveAnAssignee')}
    />
  ),

  'yhik.kate_hamba_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label={t('dashboard.marginPerTooth')}
      value={ctx.unit.marginPerTooth === null ? '—' : eur(ctx.unit.marginPerTooth)}
      accent="#22C55E"
      sub={ctx.unit.revenuePerTooth !== null && ctx.unit.costPerTooth !== null
        ? t('dashboard.incomeCost', { revenuePerTooth: eur(ctx.unit.revenuePerTooth), costPerTooth: eur(ctx.unit.costPerTooth) })
        : undefined}
      coverage={ctx.fin.materialCoverage} coverageLabel={t('dashboard.jobsHaveACostPrice')}
    />
  ),

  'yhik.kulu_hamba_kohta': ctx => (
    <StatTile
      icon={Package} label={t('dashboard.costPerTooth')}
      value={ctx.unit.costPerTooth === null ? '—' : eur(ctx.unit.costPerTooth)}
      accent="#F97316" sub={t('dashboard.toothTeeth5', { ctx, hambad: ctx.m.hambad })}
      coverage={ctx.fin.materialCoverage} coverageLabel={t('dashboard.jobsHaveACostPrice')}
    />
  ),

  'yhik.osakaalud': ctx => (
    <Block title={t('dashboard.costsAsAShareOfIncome')} sub={t('dashboard.ofJobValueNotOfInvoiced')}>
      <ShareBars rows={[
        { label: t('dashboard.labourTaxes'), value: ctx.unit.labourSharePct === null ? '—' : pct(ctx.unit.labourSharePct), share: ctx.unit.labourSharePct ?? 0, color: '#8B5CF6' },
        { label: t('dashboard.materialsAndSupplies'), value: ctx.unit.materialSharePct === null ? '—' : pct(ctx.unit.materialSharePct), share: ctx.unit.materialSharePct ?? 0, color: '#F97316' },
        { label: t('dashboard.overheads2'), value: ctx.unit.overheadSharePct === null ? '—' : pct(ctx.unit.overheadSharePct), share: ctx.unit.overheadSharePct ?? 0, color: '#64748B' },
      ]} />
      <p className="text-[10px] text-ink-faint mt-2 leading-relaxed">
        {t('dashboard.theRestIsMarginTheMaterial', { covered: ctx.fin.materialCoverage.covered, total: ctx.fin.materialCoverage.total })}
      </p>
    </Block>
  ),

  'yhik.tulu_toopaeva_kohta': ctx => (
    <StatTile
      icon={CalendarDays} label={t('dashboard.incomePerWorkingDay')}
      value={ctx.unit.revenuePerWorkingDay === null ? '—' : eur(ctx.unit.revenuePerWorkingDay)}
      sub={t('dashboard.workingSoFarMonFriDay', { ctx, workingDays: ctx.unit.workingDays })}
    />
  ),

  // ── Tootmine ───────────────────────────────────────────────────────────────
  'toot.tahtajaks': ctx => (
    <StatTile
      icon={CheckCircle} label={t('dashboard.doneOnTime')}
      value={ctx.onTime.ratePct === null ? '—' : pct(ctx.onTime.ratePct)}
      accent={(ctx.onTime.ratePct ?? 100) >= 90 ? '#22C55E' : '#F59E0B'}
      sub={ctx.onTime.ratePct === null
        ? t('dashboard.noFinishedJobHasADue')
        : t('dashboard.onTimeLateD', { ctx })}
      coverage={ctx.onTime.coverage} coverageLabel={t('dashboard.jobsHaveADueDate')}
    />
  ),

  'toot.labiaeg_jaotus': ctx => (
    <Block title={t('dashboard.turnaroundSpread')} sub={t('dashboard.anAverageAloneHidesTheTail')}>
      <Facts rows={[
        { label: t('dashboard.median'), value: ctx.turnaround.median === null ? '—' : t('dashboard.d5', { median: ctx.turnaround.median }) },
        { label: t('dashboard.average'), value: ctx.turnaround.average === null ? '—' : t('dashboard.d6', { average: ctx.turnaround.average }), muted: true },
        { label: t('dashboard.n9JobsIn10FasterThan'), value: ctx.turnaround.p90 === null ? '—' : t('dashboard.d7', { p90: ctx.turnaround.p90 }) },
        { label: t('dashboard.fastest'), value: ctx.turnaround.fastest ? t('dashboard.d8', { days: ctx.turnaround.fastest.days, label: ctx.turnaround.fastest.label }) : '—', muted: true },
        { label: t('dashboard.slowest'), value: ctx.turnaround.slowest ? t('dashboard.d8', { days: ctx.turnaround.slowest.days, label: ctx.turnaround.slowest.label }) : '—', muted: true },
      ]} />
      {ctx.turnaround.coverage.missing > 0 && (
        <p className="text-[11px] text-orange-500 mt-2">
          {t('dashboard.finishedNoCompletionDateJobHas', { ctx, missing: ctx.turnaround.coverage.missing })}
        </p>
      )}
    </Block>
  ),

  'toot.tarne': ctx => (
    <StatTile
      icon={Truck} label={t('dashboard.deliveryStatus')} value={ctx.delivery.waiting}
      accent="#F59E0B"
      sub={ctx.delivery.buckets.map(b => `${b.label} ${b.count}`).join(' · ')}
    />
  ),

  'toot.tarneaeg': ctx => (
    <StatTile
      icon={Truck} label={t('dashboard.deliveryTime')}
      value={ctx.delivery.averageLagDays === null ? '—' : t('dashboard.d9', { averageLagDays: ctx.delivery.averageLagDays })}
      accent="#6366F1" sub={t('dashboard.fromCompletionToHandover')}
    />
  ),

  'toot.nadalapaevad': ctx => (
    <Block title={t('dashboard.loadByWeekday')} sub={t('dashboard.jobsArrivedAndFinished')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={ctx.weekdays}>
          <XAxis dataKey="weekday" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="received" name={t('dashboard.arrived')} fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
          <Bar dataKey="finished" name={t('dashboard.finished')} fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  ),

  // ── Kliendid ───────────────────────────────────────────────────────────────
  'inim.kliendid_kaive': ctx => {
    const rows = ctx.customers.rows.slice(0, 8)
    return (
      <Block title={t('dashboard.topClients')} sub={t('dashboard.byJobValue')}>
        <ShareBars rows={rows.map(r => ({
          label: t('dashboard.jobJobs5', { r, name: r.name, jobs: r.jobs }),
          value: eur(r.revenue),
          share: share(r.revenue, rows[0]?.revenue ?? 0),
        }))} />
      </Block>
    )
  },

  'inim.kliendid_seis': ctx => (
    <StatTile
      icon={Users} label={t('dashboard.clientsInThePeriod')} value={ctx.customers.active}
      accent="#6366F1"
      sub={t('dashboard.newDormant', { added: ctx.customers.added, dormantCount: ctx.customers.dormant.length })}
    />
  ),

  'inim.kliendid_magavad': ctx => (
    <Block title={t('dashboard.dormantClients')} sub={t('dashboard.noOrdersIn90Days')}>
      {ctx.customers.dormant.length === 0
        ? <Empty>{t('dashboard.everyClientHasOrderedInThe')}</Empty>
        : <Facts rows={ctx.customers.dormant.slice(0, 10).map(d => ({
            label: d.name,
            value: d.lastJob ?? t('dashboard.neverOrdered'),
            muted: true,
          }))} />}
    </Block>
  ),

  'inim.maksedistsipliin': ctx => {
    const rows = ctx.customers.rows.filter(r => r.daysToPay !== null)
    const worst = Math.max(...rows.map(r => r.daysToPay ?? 0), 1)
    return (
      <Block title={t('dashboard.clientPaymentDiscipline')} sub={t('dashboard.averageDaysFromInvoiceToPayment2')}>
        {rows.length === 0
          ? <Empty>{t('dashboard.noInvoiceHasBeenPaidIn')}</Empty>
          : <ShareBars rows={rows.slice(0, 8).map(r => ({
              label: r.name,
              value: t('dashboard.d4', { daysToPay: r.daysToPay }),
              share: share(r.daysToPay ?? 0, worst),
              color: (r.daysToPay ?? 0) > 30 ? '#EF4444' : '#22C55E',
            }))} />}
      </Block>
    )
  },

  // ── Lõbus teada ────────────────────────────────────────────────────────────
  'fun.hambad_kokku': ctx => (
    <StatTile
      icon={Smile} label={t('dashboard.teethTotal')} value={ctx.fun.teethAllTime}
      scope={t('dashboard.allTime')} accent="#EC4899"
      sub={t('dashboard.fullTeethPerJobMouthMouths', { ctx, mouthsAllTime: ctx.fun.mouthsAllTime, value: ctx.fun.teethPerJob ?? '—' })}
    />
  ),

  'fun.rekordid': ctx => (
    <Block title={t('dashboard.records')} sub={t('dashboard.allTime2')}>
      <Facts rows={[
        {
          label: t('dashboard.biggestJob'),
          value: ctx.fun.biggestJob
            ? t('dashboard.toothTeeth6', { ctx, value: ctx.fun.biggestJob.value, label: ctx.fun.biggestJob.label })
            : '—',
        },
        {
          label: t('dashboard.busiestDay'),
          value: ctx.fun.busiestDay
            ? t('dashboard.toothTeeth7', { ctx, value: ctx.fun.busiestDay.value, label: ctx.fun.busiestDay.label })
            : '—',
        },
        {
          label: t('dashboard.fastestJobPeriod'),
          value: ctx.turnaround.fastest ? t('dashboard.d10', { days: ctx.turnaround.fastest.days }) : '—',
          muted: true,
        },
        {
          label: t('dashboard.slowestJobPeriod'),
          value: ctx.turnaround.slowest ? t('dashboard.d10', { days: ctx.turnaround.slowest.days }) : '—',
          muted: true,
        },
        { label: t('dashboard.jobsTotal'), value: ctx.fun.jobsAllTime, muted: true },
      ]} />
    </Block>
  ),

  'fun.seeria': ctx => (
    <StatTile
      icon={Award} label={t('dashboard.longestCleanStreak')} value={ctx.fun.cleanStreak}
      scope={t('dashboard.allTime')} accent="#22C55E"
      sub={t('dashboard.finishedJobsInARowWithout')}
    />
  ),

  'fun.lemmikud': ctx => (
    <Block title={t('dashboard.favourites')} sub={t('dashboard.allTime2')}>
      <Facts rows={[
        {
          label: t('dashboard.mostCommonShade'),
          value: ctx.fun.favouriteShade
            ? `${ctx.fun.favouriteShade.label} · ${ctx.fun.favouriteShade.value}×`
            : '—',
        },
        { label: t('dashboard.differentMaterials'), value: ctx.fun.materialsUsed, muted: true },
        { label: t('dashboard.toothChartCoverage'), value: t('dashboard.n32Positions', { toothMapCoverage: ctx.fun.toothMapCoverage }), muted: true },
        {
          label: t('dashboard.mostLoyalPatient'),
          value: ctx.fun.loyalPatient ? t('dashboard.jobJobs6', { ctx, value: ctx.fun.loyalPatient.value }) : '—',
          muted: true,
        },
        {
          label: t('dashboard.mostCommonRevisionReason'),
          value: ctx.fun.topRevisionReason
            ? `${revisionReasonText(ctx.fun.topRevisionReason.label)} · ${ctx.fun.topRevisionReason.value}×`
            : '—',
          muted: true,
        },
      ]} />
    </Block>
  ),

  'fun.tempo': ctx => (
    <StatTile
      icon={Zap} label={t('dashboard.pace')} value={t('dashboard.atWeekends', { weekendJobs: ctx.fun.weekendJobs })}
      scope={t('dashboard.allTime')} accent="#F97316"
      sub={t('dashboard.rushJobsOfAllJobs', { rushPct: pct(ctx.fun.rushPct) })}
    />
  ),

  'fun.algus': ctx => (
    <StatTile
      icon={CalendarDays} label={t('dashboard.howLongWeVeBeenAt')}
      value={ctx.fun.daysInBusiness === null ? '—' : t('dashboard.d11', { daysInBusiness: ctx.fun.daysInBusiness })}
      scope={t('dashboard.allTime')} accent="#6366F1"
      sub={ctx.fun.firstJobDate ? t('dashboard.firstJob', { firstJobDate: ctx.fun.firstJobDate }) : t('dashboard.noJobsYet')}
    />
  ),
}

/** Percentage of a total, guarding the zero denominator this app has shipped before. */
function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}

/**
 * The renderer for a panel id, gauges included.
 *
 * `PANEL_RENDER` stays a `Record<PanelId, …>` so that a hand-written panel
 * without a renderer is still a compile error. Gauges cannot be in it — there
 * is one renderer for all of them and their ids are generated — so they are
 * resolved here instead of widening that type and losing the check for the
 * sixty-one panels that still need it.
 *
 * Null for an id this build does not know, which is a normal state: the prefs
 * store keeps ids from newer versions on purpose. The grid filters those out
 * before it gets here; this is the second lock on the same door.
 */
export function panelRenderer(id: string): PanelRender | null {
  const metric = metricOfPanel(id)
  if (metric) return ctx => <Gauge metric={metric} panelId={id} ctx={ctx} />
  return PANEL_RENDER[id as PanelId] ?? null
}
