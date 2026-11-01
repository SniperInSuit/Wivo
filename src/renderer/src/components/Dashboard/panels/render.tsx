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
  if (rows.length === 0) return <Empty>{t('Andmeid ei ole.', 'No data.')}</Empty>
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
      icon={TrendingUp} label={t('Kasum (tulu − kulu)', 'Profit (income − cost)')} value={eur(ctx.profit.profit)}
      accent={ctx.profit.profit >= 0 ? '#22C55E' : '#EF4444'}
      sub={t(`Kate ${pct(ctx.profit.profitPct)}`, `Margin ${pct(ctx.profit.profitPct)}`)}
      // Both coverages, because this number subtracts both. The overhead caveat
      // is separate: subtracting an unentered zero and calling it profit is the
      // same lie as a margin that ignores labour.
      coverage={ctx.fin.labourCoverage} coverageLabel={t('tööl on teostaja', 'jobs have an assignee')}
    />
  ),

  'raha.kulud': ctx => (
    <Block title={t('Kulu kokku', 'Total cost')} sub={eur(ctx.profit.costs)}>
      <ShareBars rows={[
        { label: t('Tööjõud + maksud', 'Labour + taxes'), value: eur(ctx.profit.labour), share: share(ctx.profit.labour, ctx.profit.costs) },
        { label: t('Materjal ja tarvikud', 'Materials and supplies'), value: eur(ctx.profit.material), share: share(ctx.profit.material, ctx.profit.costs) },
        { label: t('Fikseeritud', 'Fixed'), value: eur(ctx.profit.fixed), share: share(ctx.profit.fixed, ctx.profit.costs) },
        { label: t('Üldkulud', 'Overheads'), value: eur(ctx.profit.overheads), share: share(ctx.profit.overheads, ctx.profit.costs) },
      ].filter(r => r.value !== '0.00 €')} />
      {ctx.profit.overheads === 0 && (
        <p className="text-[11px] text-orange-500 mt-2 leading-relaxed">
          {t('Üldkulusid ei ole sisestatud — see on kate, mitte kasum. Seaded → Hinnad → Üldkulud.', 'No overheads entered — this is margin, not profit. Settings → Prices → Overheads.')}
        </p>
      )}
    </Block>
  ),

  'raha.kate': ctx => (
    <StatTile
      icon={Percent} label={t('Brutokate', 'Gross margin')} value={eur(ctx.fin.grossMargin)}
      sub={t(`${pct(ctx.fin.grossMarginPct)} arveldatust · netokate ${eur(ctx.fin.netMargin)} (${pct(ctx.fin.netMarginPct)})`, `${pct(ctx.fin.grossMarginPct)} of invoiced · net margin ${eur(ctx.fin.netMargin)} (${pct(ctx.fin.netMarginPct)})`)}
      accent="#6366F1"
      coverage={ctx.fin.materialCoverage} coverageLabel={t('tööl on omahind', 'jobs have a cost price')}
    />
  ),

  'raha.kaive': ctx => (
    <StatTile icon={Euro} label={t('Käive', 'Revenue')} value={eur(ctx.m.money)} sub={MONEY_HINT.kaive} />
  ),

  'raha.arveldatud': ctx => (
    <StatTile icon={Euro} label={t('Arveldatud', 'Invoiced')} value={eur(ctx.fin.billed)} sub={MONEY_HINT.arveldatud} />
  ),

  'raha.laekunud': ctx => (
    <StatTile icon={Wallet} label={t('Laekunud', 'Received')} value={eur(ctx.fin.received)} sub={MONEY_HINT.laekunud} accent="#22C55E" />
  ),

  'raha.tasumata': ctx => (
    <StatTile
      icon={Clock} label={t('Tasumata arvete järgi', 'Unpaid by invoice')} value={eur(ctx.fin.outstanding)} accent="#F59E0B"
      sub={ctx.fin.overdue > 0
        ? t(`${eur(ctx.fin.overdue)} üle tähtaja`, `${eur(ctx.fin.overdue)} overdue`)
        : t('Ainult väljastatud arved. Arveta töö on „Arveldamata" all.', 'Issued invoices only. Work without an invoice is under “Not invoiced”.')}
    />
  ),

  'raha.arveldamata': ctx => (
    <StatTile
      icon={FileWarning} label={t('Arveldamata', 'Not invoiced')} value={eur(ctx.fin.unbilled)} accent="#EF4444"
      sub={t(`${ctx.fin.unbilledJobs} valmis tööd ilma arveta`, `${ctx.fin.unbilledJobs} finished ${ctx.fin.unbilledJobs === 1 ? 'job' : 'jobs'} without an invoice`)}
    />
  ),

  'raha.toojoukulu': ctx => (
    <StatTile
      icon={Users} label={t('Tööjõud + maksud + arve', 'Labour + taxes + invoices')} value={eur(ctx.fin.labourAccrued + ctx.profit.employerTax)}
      accent="#8B5CF6"
      sub={[
        t(`Bruto ${eur(ctx.fin.labourEmployeeGross)}`, `Gross ${eur(ctx.fin.labourEmployeeGross)}`),
        ctx.profit.employerTax > 0 ? t(`Maksud ${eur(ctx.profit.employerTax)}`, `Taxes ${eur(ctx.profit.employerTax)}`) : null,
        ctx.fin.labourContractor > 0 ? t(`Arve alusel ${eur(ctx.fin.labourContractor)}`, `Contractor invoices ${eur(ctx.fin.labourContractor)}`) : null,
      ].filter(Boolean).join(' · ')}
      coverage={ctx.fin.labourCoverage} coverageLabel={t('tööl on teostaja', 'jobs have an assignee')}
    />
  ),

  'raha.valjamakstud': ctx => (
    <StatTile
      icon={Wallet} label={t('Arvestatud vs välja makstud', 'Earned vs paid out')} value={eur(ctx.fin.labourAccrued)}
      accent="#8B5CF6"
      sub={t(`Välja makstud ${eur(ctx.fin.labourPaid)} · maksmata ${eur(Math.max(0, ctx.fin.labourAccrued - ctx.fin.labourPaid))}`, `Paid out ${eur(ctx.fin.labourPaid)} · unpaid ${eur(Math.max(0, ctx.fin.labourAccrued - ctx.fin.labourPaid))}`)}
    />
  ),

  'raha.kaive_kuude_kaupa': ctx => (
    <Block title={t('Käive kuude kaupa', 'Revenue by month')}>
      {ctx.stats.revenueByMonth.length === 0 ? <Empty>{t('Andmeid ei ole.', 'No data.')}</Empty> : (
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
    <Block title={t('Maksmise viis', 'Payment method')} sub={t('Kuidas raha päriselt saabub', 'How the money actually comes in')}>
      <ShareBars rows={ctx.fin.byPaymentMethod.map(p => ({
        label: `${p.label} · ${p.count}×`,
        value: eur(p.amount),
        share: p.share,
      }))} />
    </Block>
  ),

  'raha.muudatuste_kahju': ctx => (
    <Block title={t('Muudatuste kahju', 'Cost of revisions')} sub={t(`Netokahju kokku ${eur(ctx.fin.revisionLossTotal)}`, `Total net loss ${eur(ctx.fin.revisionLossTotal)}`)}>
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
      icon={HandCoins} label={t('Võlgu kokku', 'Total owed')} value={eur(ctx.debt.outstanding)}
      accent={ctx.debt.overdue > 0 ? '#EF4444' : '#F59E0B'}
      sub={ctx.debt.count === 0
        ? t('Keegi ei võlgne · kogu aeg', 'Nobody owes anything · all time')
        : t(`${ctx.debt.count} võlglast · üle tähtaja ${eur(ctx.debt.overdue)} · kogu aeg`, `${ctx.debt.count} ${ctx.debt.count === 1 ? 'debtor' : 'debtors'} · overdue ${eur(ctx.debt.overdue)} · all time`)}
    />
  ),

  'raha.volglased': ctx => {
    const rows = ctx.debt.rows.slice(0, 10)
    const worst = rows[0]?.outstanding ?? 0
    return (
      <Block
        title={t('Kes on võlgu', 'Who owes')}
        sub={t(`Kogu aeg · arveldamata ${eur(ctx.debt.uninvoiced)} ei ole üle tähtaja — arvet ei ole saadetud`, `All time · ${eur(ctx.debt.uninvoiced)} not invoiced is not overdue — no invoice has been sent`)}
      >
        {rows.length === 0
          ? <Empty>{t('Ükski töö ei ole tasumata.', 'No job is unpaid.')}</Empty>
          : <ShareBars rows={rows.map(r => ({
              label: `${r.nimi}${r.daysLate > 0 ? t(` · ${r.daysLate} p üle`, ` · ${r.daysLate} d overdue`) : r.partial ? t(' · osaliselt makstud', ' · partly paid') : ''}`,
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
      <Block title={t('Võla vanus', 'Debt age')} sub={t('Arve maksetähtajast, mitte töö kuupäevast', 'From the invoice due date, not the job date')}>
        {ctx.debt.overdue === 0
          ? <Empty>{t('Ükski saadetud arve ei ole üle tähtaja.', 'No sent invoice is overdue.')}</Empty>
          : <ShareBars rows={buckets.filter(b => b.amount > 0).map(b => ({
              // The label stays Estonian in lib/debtors (the colour below compares it); only its unit is swapped here.
              label: `${t(b.label, b.label.replace(/ p$/, ' d'))} · ${b.count}`,
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
      icon={TrendingUp} label={t('Hind hamba kohta', 'Price per tooth')} value={eur(ctx.stats.avgPricePerTooth)}
      sub={t(`${ctx.m.hambad} hammast · ${teethSplitLabel(ctx.m)}`, `${ctx.m.hambad} ${ctx.m.hambad === 1 ? 'tooth' : 'teeth'} · ${teethSplitLabel(ctx.m)}`)}
    />
  ),

  'yhik.tulu_too_kohta': ctx => (
    <StatTile
      icon={Euro} label={t('Ø hind / töö', 'Ø price / job')} value={eur(ctx.stats.avgPrice)}
      sub={unitSplitLabel(ctx.m)}
      coverage={ctx.stats.priceCoverage} coverageLabel={t('tööl on hind', 'jobs have a price')}
    />
  ),

  'yhik.kiirtoo_tasuvus': ctx => (
    <StatTile
      icon={Zap} label={t('Kiirtöö tasuvus', 'Rush job payoff')} value={t(`${ctx.stats.kiirtooJobs.length} tööd`, `${ctx.stats.kiirtooJobs.length} ${ctx.stats.kiirtooJobs.length === 1 ? 'job' : 'jobs'}`)}
      accent="#F97316"
      sub={ctx.m.money > 0
        ? t(`${eur(ctx.stats.kiirtooRevenue)} · ${pct(share(ctx.stats.kiirtooRevenue, ctx.m.money))} käibest`, `${eur(ctx.stats.kiirtooRevenue)} · ${pct(share(ctx.stats.kiirtooRevenue, ctx.m.money))} of revenue`)
        : t(`${eur(ctx.stats.kiirtooRevenue)} käive`, `${eur(ctx.stats.kiirtooRevenue)} revenue`)}
    />
  ),

  'yhik.kate_tootyybi_jargi': ctx => {
    // A COPY — fin.byWorkType is memoised inside the aggregator.
    const rows = [...ctx.fin.byWorkType].sort((a, b) => b.margin - a.margin)
    return (
      <Block title={t('Kate töö tüübi järgi', 'Margin by work type')} sub={t('Ühik on tööosa, mitte töö: mitme tüübiga juhtum loeb igas tüübis', 'The unit is the work item, not the job: a case with several types counts in each')}>
        {rows.length === 0 ? <Empty>{t('Valmis töid ei ole.', 'No finished jobs.')}</Empty> : (
          <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-2 py-1.5 font-semibold">{t('Töö tüüp', 'Work type')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Tööosi', 'Work items')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Hambaid', 'Teeth')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Tulu', 'Income')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Tööjõud', 'Labour')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Materjal', 'Material')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Kate', 'Margin')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('Kate %', 'Margin %')}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">{t('€/hammas kate', 'Margin €/tooth')}</th>
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
        title={t('Kahjumlikud töö tüübid', 'Loss-making work types')}
        sub={t('Tüüp võib olla kahjumis ka lihtsalt sellepärast, et selle töö on arveldamata', 'A type can show a loss simply because its work has not been invoiced')}
      >
        {losing.length === 0
          ? <Empty>{t('Ühegi töötüübi kate ei ole negatiivne.', 'No work type has a negative margin.')}</Empty>
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
      icon={Layers} label={t('Töid kokku', 'Jobs total')} value={ctx.m.yksused} sub={unitSplitLabel(ctx.m)}
      scope={ctx.period === 'all' ? t('kogu aeg', 'all time') : undefined}
    />
  ),

  'toot.hambaid': ctx => (
    <StatTile
      icon={CheckCircle} label={t('Hambaid toodetud', 'Teeth produced')} value={ctx.m.hambad} sub={teethSplitLabel(ctx.m)}
      accent="#22C55E"
    />
  ),

  'toot.tahtajast_yle': ctx => (
    <StatTile
      icon={AlertCircle} label={t('Tähtajast üle', 'Overdue')} value={ctx.stats.overdue.length} accent="#EF4444"
      sub={t('lõpetamata, tähtaeg möödas', 'unfinished, past due date')} scope={t('hetkeseis', 'right now')}
    />
  ),

  'toot.labiaeg': ctx => (
    <StatTile
      icon={Timer} label={t('Ø läbiaeg', 'Ø turnaround')}
      value={ctx.stats.avgTurnaround > 0 ? t(`${ctx.stats.avgTurnaround.toFixed(1)} p`, `${ctx.stats.avgTurnaround.toFixed(1)} d`) : '—'}
      sub={t('vastuvõtust valmimiseni', 'from receipt to completion')} accent="#8B5CF6"
      coverage={ctx.stats.turnaroundCoverage} coverageLabel={t('tööl on valmimiskuupäev', 'jobs have a completion date')}
    />
  ),

  'toot.muudatuste_maar': ctx => (
    <StatTile
      icon={Repeat} label={t('Revisjonimäär', 'Revision rate')} value={pct(ctx.stats.revisionRate)}
      accent={ctx.stats.revisionRate > 15 ? '#EF4444' : '#EC4899'}
      // `filtered.length`, not `totalWork`: the rate is jobs-with-a-revision
      // over JOBS, and `totalWork` is units. The old line printed a denominator
      // the percentage above it was never computed from.
      sub={t(`${ctx.stats.withRevision.length} tööd ${ctx.stats.filtered.length}-st`, `${ctx.stats.withRevision.length} of ${ctx.stats.filtered.length} ${ctx.stats.filtered.length === 1 ? 'job' : 'jobs'}`)}
    />
  ),

  'toot.wip': ctx => (
    <Block title={t('Töös etappide kaupa', 'In progress by stage')} sub={t('Hetkeseis, mitte perioodi number', 'Current state, not a figure for the period')}>
      {ctx.stats.wipByStage.length === 0 ? <Empty>{t('Töös töid ei ole.', 'No jobs in progress.')}</Empty> : (
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
    <Block title={t('Valmis tööd kuude kaupa', 'Finished jobs by month')}>
      {ctx.stats.throughput.length === 0 ? <Empty>{t('Andmeid ei ole.', 'No data.')}</Empty> : (
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
        title={t('Muudatuste põhjused', 'Revision reasons')}
        sub={t('Kahe põhjusega muudatus loeb mõlemas — ribade summa ületab muudatuste arvu', 'A revision with two reasons counts in both — the bars add up to more than the number of revisions')}
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
      <Block title={t('Mida kõige rohkem teeme', 'What we make most')} sub={t('Tööde arv liigi kaupa, perioodil', 'Number of jobs per type, in the period')}>
        <ShareBars rows={rows.map(type => ({
          label: type.name,
          // Both numbers, because neither answers it alone: a denture is one
          // job and fourteen teeth, a single crown is one of each.
          value: t(`${type.count} tööd · ${type.teeth} hammast`, `${type.count} ${type.count === 1 ? 'job' : 'jobs'} · ${type.teeth} ${type.teeth === 1 ? 'tooth' : 'teeth'}`),
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
      <Block title={t('Ühikuid töö liigi järgi', 'Units by work type')} sub={t('Hambaid tööosade kaupa, mitte tööde kaupa', 'Teeth by work item, not by job')}>
        {rows.length === 0 ? <Empty>{t('Andmeid ei ole.', 'No data.')}</Empty> : (
          <>
            <ShareBars rows={rows.map(type => ({
              label: type.name,
              // Items as well as teeth: a four-unit bridge is one item and four
              // teeth, and which of those a lab calls "a unit" depends on what
              // it is pricing.
              value: t(`${type.teeth} hammast · ${type.items} tk`, `${type.teeth} ${type.teeth === 1 ? 'tooth' : 'teeth'} · ${type.items} pcs`),
              share: share(type.teeth, top),
              color: ctx.wt.hex(type.name),
            }))} />
            {rows.some(type => type.redone > 0) && (
              <p className="mt-2 text-[10px] text-ink-faint">
                {t('Ümbertehtud hambad ei ole siin sees:', 'Remade teeth are not included here:')}{' '}
                {rows.filter(type => type.redone > 0).map(type => `${type.name} ${type.redone}`).join(' · ')}
              </p>
            )}
            {unplacedRedone > 0 && (
              // Reported rather than spread across the types — see unitsByType.
              <p className="mt-1 text-[10px] text-ink-faint">
                {t(
                  `${unplacedRedone} ümbertehtud hammast ei saanud liigini siduda (muudatus ei nimeta hambaid).`,
                  `${unplacedRedone} remade ${unplacedRedone === 1 ? 'tooth' : 'teeth'} could not be linked to a type (the revision names no teeth).`,
                )}
              </p>
            )}
          </>
        )}
      </Block>
    )
  },

  'toot.materjalid': ctx => (
    <Block title={t('Tööd materjali järgi', 'Jobs by material')}>
      {ctx.stats.materialStats.length === 0 ? <Empty>{t('Materjale ei ole märgitud.', 'No materials recorded.')}</Empty> : (
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
        icon={Cpu} label={t('Masinate koormus', 'Machine load')}
        value={top ? `${top.count}` : '—'}
        sub={top
          ? `${top.name}${ctx.stats.machineStats[1] ? ` · ${ctx.stats.machineStats[1].name} ${ctx.stats.machineStats[1].count}` : ''}`
          : t('Masinaid ei ole märgitud', 'No machines recorded')}
        accent="#6366F1"
      />
    )
  },

  // ── Kliendid ja inimesed ───────────────────────────────────────────────────
  'inim.tootajad': ctx => (
    <Block title={t('Töötajate kaupa', 'By employee')} sub={t('Arvestatud on selle perioodi teenistus, olenemata sellest, kas see on juba välja makstud', 'Earned is what this period earned, whether or not it has been paid out yet')}>
      {ctx.fin.byWorker.length === 0 ? <Empty>{t('Ühelegi tööle ei ole teostajat määratud.', 'No job has an assignee.')}</Empty> : (
        <div className="overflow-auto h-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                <th className="px-2 py-1.5 font-semibold">{t('Töötaja', 'Employee')}</th>
                <th className="px-2 py-1.5 font-semibold">{t('Töösuhe', 'Employment')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('Töid', 'Jobs')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('Hambaid', 'Teeth')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('Arvestatud', 'Earned')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('Bruto', 'Gross')}</th>
                <th className="px-2 py-1.5 font-semibold text-right">{t('Välja makstud', 'Paid out')}</th>
              </tr>
            </thead>
            <tbody>
              {ctx.fin.byWorker.map(w => (
                <tr key={w.profileId} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                  <td className="px-2 py-1.5 text-ink">{w.name}</td>
                  <td className="px-2 py-1.5 text-ink-muted text-xs">
                    {w.engagement === 'ettevote' ? t('Esitab arve', 'Contractor') : t('Palgal', 'On payroll')}
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
      <Block title={t('Töötajate koormus', 'Employee workload')} sub={t('Tööd ja hambad inimese kohta', 'Jobs and teeth per person')}>
        <ShareBars rows={rows.map(w => ({
          label: t(`${w.name} · ${w.jobs} tööd`, `${w.name} · ${w.jobs} ${w.jobs === 1 ? 'job' : 'jobs'}`),
          value: t(`${w.teeth} hammast`, `${w.teeth} ${w.teeth === 1 ? 'tooth' : 'teeth'}`),
          share: share(w.teeth, top),
        }))} />
      </Block>
    )
  },

  'inim.katvus': ctx => (
    <StatTile
      icon={AlertCircle} label={t('Andmete katvus', 'Data coverage')}
      value={`${ctx.fin.labourCoverage.covered}/${ctx.fin.labourCoverage.total}`}
      accent="#F59E0B"
      sub={t(`tööl on teostaja · omahind ${ctx.fin.materialCoverage.covered}/${ctx.fin.materialCoverage.total}`, `jobs have an assignee · cost price ${ctx.fin.materialCoverage.covered}/${ctx.fin.materialCoverage.total}`)}
    />
  ),

  'inim.patsiendid': ctx => (
    <StatTile
      icon={UserPlus} label={t('Patsiendid', 'Patients')} value={ctx.stats.patientSummary.total}
      sub={t(`${ctx.stats.patientSummary.newPatients} uut · ${ctx.stats.patientSummary.repeatPatients} korduvat`, `${ctx.stats.patientSummary.newPatients} new · ${ctx.stats.patientSummary.repeatPatients} returning`)}
      accent="#6366F1"
    />
  ),

  'inim.visiidid': ctx => (
    <StatTile
      icon={Stethoscope} label={t('Visiidid', 'Visits')} value={ctx.stats.visitStats.total}
      sub={t(`Ei tulnud ${pct(ctx.stats.visitStats.noShowRate)} · Ø ${ctx.stats.visitStats.avgKestus.toFixed(0)} min`, `No-shows ${pct(ctx.stats.visitStats.noShowRate)} · Ø ${ctx.stats.visitStats.avgKestus.toFixed(0)} min`)}
      accent="#EC4899"
    />
  ),

  'inim.arstid': ctx => (
    <Block title={t('Top suunavad arstid', 'Top referring dentists')} sub={t('Käibe järgi', 'By revenue')}>
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
      title={t('Võlgnevuse vanus', 'Outstanding by age')}
      sub={t(`Üle tähtaja ${eur(ctx.invoices.agingTotal)} · tähtaeg ees ${eur(ctx.invoices.notDue)}`, `Overdue ${eur(ctx.invoices.agingTotal)} · not yet due ${eur(ctx.invoices.notDue)}`)}
    >
      {ctx.invoices.agingTotal === 0
        ? <Empty>{t('Ükski arve ei ole üle tähtaja.', 'No invoice is overdue.')}</Empty>
        : <ShareBars rows={ctx.invoices.aging.filter(b => b.amount > 0).map((b, i) => ({
            label: t(`${b.label} · ${b.count} arvet`, `${b.label} · ${b.count} ${b.count === 1 ? 'invoice' : 'invoices'}`),
            value: eur(b.amount),
            share: share(b.amount, ctx.invoices.agingTotal),
            // Older debt reads redder, because it is.
            color: ['#F59E0B', '#F97316', '#EF4444', '#B91C1C'][i] ?? '#EF4444',
          }))} />}
    </Block>
  ),

  'raha.laekumisaeg': ctx => (
    <StatTile
      icon={Clock} label={t('Keskmine laekumisaeg', 'Average time to payment')}
      value={ctx.invoices.daysToPay === null ? '—' : t(`${ctx.invoices.daysToPay} p`, `${ctx.invoices.daysToPay} d`)}
      accent="#6366F1"
      sub={ctx.invoices.daysToPay === null
        ? t('Perioodil ei ole ükski arve lõplikult tasutud', 'No invoice was paid in full in the period')
        : t(`${ctx.invoices.daysToPaySample} arve alusel · arvest rahani`, `Based on ${ctx.invoices.daysToPaySample} ${ctx.invoices.daysToPaySample === 1 ? 'invoice' : 'invoices'} · invoice to money`)}
    />
  ),

  'raha.kaibemaks': ctx => (
    <StatTile
      icon={Percent} label={t('Käibemaks perioodis', 'VAT in the period')} value={eur(ctx.invoices.vat)}
      accent="#64748B" sub={t('väljastatud arvetel — riigile, mitte tulu', 'on issued invoices — owed to the state, not income')}
    />
  ),

  'raha.keskmine_arve': ctx => (
    <StatTile
      icon={Euro} label={t('Keskmine arve', 'Average invoice')} value={eur(ctx.invoices.averageInvoice)}
      sub={t(`${ctx.invoices.issuedCount} arvet · kokku ${eur(ctx.invoices.issued)}`, `${ctx.invoices.issuedCount} ${ctx.invoices.issuedCount === 1 ? 'invoice' : 'invoices'} · ${eur(ctx.invoices.issued)} total`)}
    />
  ),

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  'yhik.kasum_too_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label={t('Kasum töö kohta', 'Profit per job')}
      value={ctx.unit.profitPerJob === null ? '—' : eur(ctx.unit.profitPerJob)}
      accent={(ctx.unit.profitPerJob ?? 0) >= 0 ? '#22C55E' : '#EF4444'}
      sub={t(`${ctx.m.tood} tööd · muudatused ei ole eraldi tööd`, `${ctx.m.tood} ${ctx.m.tood === 1 ? 'job' : 'jobs'} · revisions are not separate jobs`)}
      coverage={ctx.fin.labourCoverage} coverageLabel={t('tööl on teostaja', 'jobs have an assignee')}
    />
  ),

  'yhik.kate_hamba_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label={t('Kate hamba kohta', 'Margin per tooth')}
      value={ctx.unit.marginPerTooth === null ? '—' : eur(ctx.unit.marginPerTooth)}
      accent="#22C55E"
      sub={ctx.unit.revenuePerTooth !== null && ctx.unit.costPerTooth !== null
        ? t(`Tulu ${eur(ctx.unit.revenuePerTooth)} − kulu ${eur(ctx.unit.costPerTooth)}`, `Income ${eur(ctx.unit.revenuePerTooth)} − cost ${eur(ctx.unit.costPerTooth)}`)
        : undefined}
      coverage={ctx.fin.materialCoverage} coverageLabel={t('tööl on omahind', 'jobs have a cost price')}
    />
  ),

  'yhik.kulu_hamba_kohta': ctx => (
    <StatTile
      icon={Package} label={t('Kulu hamba kohta', 'Cost per tooth')}
      value={ctx.unit.costPerTooth === null ? '—' : eur(ctx.unit.costPerTooth)}
      accent="#F97316" sub={t(`${ctx.m.hambad} hammast`, `${ctx.m.hambad} ${ctx.m.hambad === 1 ? 'tooth' : 'teeth'}`)}
      coverage={ctx.fin.materialCoverage} coverageLabel={t('tööl on omahind', 'jobs have a cost price')}
    />
  ),

  'yhik.osakaalud': ctx => (
    <Block title={t('Kulude osakaal tulust', 'Costs as a share of income')} sub={t('Tööde väärtusest, mitte arveldatust', 'Of job value, not of invoiced')}>
      <ShareBars rows={[
        { label: t('Tööjõud + maksud', 'Labour + taxes'), value: ctx.unit.labourSharePct === null ? '—' : pct(ctx.unit.labourSharePct), share: ctx.unit.labourSharePct ?? 0, color: '#8B5CF6' },
        { label: t('Materjal ja tarvikud', 'Materials and supplies'), value: ctx.unit.materialSharePct === null ? '—' : pct(ctx.unit.materialSharePct), share: ctx.unit.materialSharePct ?? 0, color: '#F97316' },
        { label: t('Üldkulud', 'Overheads'), value: ctx.unit.overheadSharePct === null ? '—' : pct(ctx.unit.overheadSharePct), share: ctx.unit.overheadSharePct ?? 0, color: '#64748B' },
      ]} />
      <p className="text-[10px] text-ink-faint mt-2 leading-relaxed">
        {t(
          `Ülejäänu on kate. Materjali osakaal eeldab, et omahinnad on sisestatud — ${ctx.fin.materialCoverage.covered}/${ctx.fin.materialCoverage.total} tööl on.`,
          `The rest is margin. The material share assumes cost prices have been entered — ${ctx.fin.materialCoverage.covered}/${ctx.fin.materialCoverage.total} jobs have them.`,
        )}
      </p>
    </Block>
  ),

  'yhik.tulu_toopaeva_kohta': ctx => (
    <StatTile
      icon={CalendarDays} label={t('Tulu tööpäeva kohta', 'Income per working day')}
      value={ctx.unit.revenuePerWorkingDay === null ? '—' : eur(ctx.unit.revenuePerWorkingDay)}
      sub={t(`${ctx.unit.workingDays} tööpäeva möödas (E–R)`, `${ctx.unit.workingDays} working ${ctx.unit.workingDays === 1 ? 'day' : 'days'} so far (Mon–Fri)`)}
    />
  ),

  // ── Tootmine ───────────────────────────────────────────────────────────────
  'toot.tahtajaks': ctx => (
    <StatTile
      icon={CheckCircle} label={t('Tähtajaks valmis', 'Done on time')}
      value={ctx.onTime.ratePct === null ? '—' : pct(ctx.onTime.ratePct)}
      accent={(ctx.onTime.ratePct ?? 100) >= 90 ? '#22C55E' : '#F59E0B'}
      sub={ctx.onTime.ratePct === null
        ? t('Ühelgi valmis tööl ei ole tähtaega', 'No finished job has a due date')
        : t(`${ctx.onTime.onTime} õigeks · ${ctx.onTime.late} hiljaks${
            ctx.onTime.averageDaysLate ? ` (Ø ${ctx.onTime.averageDaysLate} p)` : ''
          }`, `${ctx.onTime.onTime} on time · ${ctx.onTime.late} late${
            ctx.onTime.averageDaysLate ? ` (Ø ${ctx.onTime.averageDaysLate} d)` : ''
          }`)}
      coverage={ctx.onTime.coverage} coverageLabel={t('tööl on tähtaeg', 'jobs have a due date')}
    />
  ),

  'toot.labiaeg_jaotus': ctx => (
    <Block title={t('Läbiaja jaotus', 'Turnaround spread')} sub={t('Keskmine üksi varjab saba — mediaan ja 90. protsentiil ei', 'An average alone hides the tail — the median and 90th percentile do not')}>
      <Facts rows={[
        { label: t('Mediaan', 'Median'), value: ctx.turnaround.median === null ? '—' : t(`${ctx.turnaround.median} p`, `${ctx.turnaround.median} d`) },
        { label: t('Keskmine', 'Average'), value: ctx.turnaround.average === null ? '—' : t(`${ctx.turnaround.average} p`, `${ctx.turnaround.average} d`), muted: true },
        { label: t('9 tööd 10-st kiiremad kui', '9 jobs in 10 faster than'), value: ctx.turnaround.p90 === null ? '—' : t(`${ctx.turnaround.p90} p`, `${ctx.turnaround.p90} d`) },
        { label: t('Kiireim', 'Fastest'), value: ctx.turnaround.fastest ? t(`${ctx.turnaround.fastest.days} p · ${ctx.turnaround.fastest.label}`, `${ctx.turnaround.fastest.days} d · ${ctx.turnaround.fastest.label}`) : '—', muted: true },
        { label: t('Aeglaseim', 'Slowest'), value: ctx.turnaround.slowest ? t(`${ctx.turnaround.slowest.days} p · ${ctx.turnaround.slowest.label}`, `${ctx.turnaround.slowest.days} d · ${ctx.turnaround.slowest.label}`) : '—', muted: true },
      ]} />
      {ctx.turnaround.coverage.missing > 0 && (
        <p className="text-[11px] text-orange-500 mt-2">
          {t(`${ctx.turnaround.coverage.missing} valmis tööl puudub valmimiskuupäev.`, `${ctx.turnaround.coverage.missing} finished ${ctx.turnaround.coverage.missing === 1 ? 'job has' : 'jobs have'} no completion date.`)}
        </p>
      )}
    </Block>
  ),

  'toot.tarne': ctx => (
    <StatTile
      icon={Truck} label={t('Tarne seis', 'Delivery status')} value={ctx.delivery.waiting}
      accent="#F59E0B"
      sub={ctx.delivery.buckets.map(b => `${b.label} ${b.count}`).join(' · ')}
    />
  ),

  'toot.tarneaeg': ctx => (
    <StatTile
      icon={Truck} label={t('Tarneaeg', 'Delivery time')}
      value={ctx.delivery.averageLagDays === null ? '—' : t(`${ctx.delivery.averageLagDays} p`, `${ctx.delivery.averageLagDays} d`)}
      accent="#6366F1" sub={t('valmimisest üleandmiseni', 'from completion to handover')}
    />
  ),

  'toot.nadalapaevad': ctx => (
    <Block title={t('Koormus nädalapäeva järgi', 'Load by weekday')} sub={t('Saabunud ja valminud tööd', 'Jobs arrived and finished')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={ctx.weekdays}>
          <XAxis dataKey="weekday" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="received" name={t('Saabunud', 'Arrived')} fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
          <Bar dataKey="finished" name={t('Valmis', 'Finished')} fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  ),

  // ── Kliendid ───────────────────────────────────────────────────────────────
  'inim.kliendid_kaive': ctx => {
    const rows = ctx.customers.rows.slice(0, 8)
    return (
      <Block title={t('Top kliendid', 'Top clients')} sub={t('Tööde väärtuse järgi', 'By job value')}>
        <ShareBars rows={rows.map(r => ({
          label: t(`${r.name} · ${r.jobs} tööd`, `${r.name} · ${r.jobs} ${r.jobs === 1 ? 'job' : 'jobs'}`),
          value: eur(r.revenue),
          share: share(r.revenue, rows[0]?.revenue ?? 0),
        }))} />
      </Block>
    )
  },

  'inim.kliendid_seis': ctx => (
    <StatTile
      icon={Users} label={t('Kliendid perioodis', 'Clients in the period')} value={ctx.customers.active}
      accent="#6366F1"
      sub={t(`${ctx.customers.added} uut · ${ctx.customers.dormant.length} magavat`, `${ctx.customers.added} new · ${ctx.customers.dormant.length} dormant`)}
    />
  ),

  'inim.kliendid_magavad': ctx => (
    <Block title={t('Magavad kliendid', 'Dormant clients')} sub={t('Ei ole 90 päeva tellinud', 'No orders in 90 days')}>
      {ctx.customers.dormant.length === 0
        ? <Empty>{t('Kõik kliendid on tellinud viimase 90 päeva jooksul.', 'Every client has ordered in the last 90 days.')}</Empty>
        : <Facts rows={ctx.customers.dormant.slice(0, 10).map(d => ({
            label: d.name,
            value: d.lastJob ?? t('ei ole kunagi tellinud', 'never ordered'),
            muted: true,
          }))} />}
    </Block>
  ),

  'inim.maksedistsipliin': ctx => {
    const rows = ctx.customers.rows.filter(r => r.daysToPay !== null)
    const worst = Math.max(...rows.map(r => r.daysToPay ?? 0), 1)
    return (
      <Block title={t('Klientide maksedistsipliin', 'Client payment discipline')} sub={t('Keskmine päevade arv arvest makseni', 'Average days from invoice to payment')}>
        {rows.length === 0
          ? <Empty>{t('Ükski arve ei ole veel lõplikult tasutud.', 'No invoice has been paid in full yet.')}</Empty>
          : <ShareBars rows={rows.slice(0, 8).map(r => ({
              label: r.name,
              value: t(`${r.daysToPay} p`, `${r.daysToPay} d`),
              share: share(r.daysToPay ?? 0, worst),
              color: (r.daysToPay ?? 0) > 30 ? '#EF4444' : '#22C55E',
            }))} />}
      </Block>
    )
  },

  // ── Lõbus teada ────────────────────────────────────────────────────────────
  'fun.hambad_kokku': ctx => (
    <StatTile
      icon={Smile} label={t('Hambaid kokku', 'Teeth total')} value={ctx.fun.teethAllTime}
      scope={t('kogu aeg', 'all time')} accent="#EC4899"
      sub={t(`≈ ${ctx.fun.mouthsAllTime} täissuud · Ø ${ctx.fun.teethPerJob ?? '—'} hammast töö kohta`, `≈ ${ctx.fun.mouthsAllTime} full ${ctx.fun.mouthsAllTime === 1 ? 'mouth' : 'mouths'} · Ø ${ctx.fun.teethPerJob ?? '—'} teeth per job`)}
    />
  ),

  'fun.rekordid': ctx => (
    <Block title={t('Rekordid', 'Records')} sub={t('Kogu aeg', 'All time')}>
      <Facts rows={[
        {
          label: t('Suurim töö', 'Biggest job'),
          value: ctx.fun.biggestJob
            ? t(`${ctx.fun.biggestJob.value} hammast · ${ctx.fun.biggestJob.label}`, `${ctx.fun.biggestJob.value} ${ctx.fun.biggestJob.value === 1 ? 'tooth' : 'teeth'} · ${ctx.fun.biggestJob.label}`)
            : '—',
        },
        {
          label: t('Tihedaim päev', 'Busiest day'),
          value: ctx.fun.busiestDay
            ? t(`${ctx.fun.busiestDay.value} hammast · ${ctx.fun.busiestDay.label}`, `${ctx.fun.busiestDay.value} ${ctx.fun.busiestDay.value === 1 ? 'tooth' : 'teeth'} · ${ctx.fun.busiestDay.label}`)
            : '—',
        },
        {
          label: t('Kiireim töö (periood)', 'Fastest job (period)'),
          value: ctx.turnaround.fastest ? t(`${ctx.turnaround.fastest.days} p`, `${ctx.turnaround.fastest.days} d`) : '—',
          muted: true,
        },
        {
          label: t('Aeglaseim töö (periood)', 'Slowest job (period)'),
          value: ctx.turnaround.slowest ? t(`${ctx.turnaround.slowest.days} p`, `${ctx.turnaround.slowest.days} d`) : '—',
          muted: true,
        },
        { label: t('Töid kokku', 'Jobs total'), value: ctx.fun.jobsAllTime, muted: true },
      ]} />
    </Block>
  ),

  'fun.seeria': ctx => (
    <StatTile
      icon={Award} label={t('Pikim veatu seeria', 'Longest clean streak')} value={ctx.fun.cleanStreak}
      scope={t('kogu aeg', 'all time')} accent="#22C55E"
      sub={t('valmis tööd järjest ilma ühegi muudatuseta', 'finished jobs in a row without a single revision')}
    />
  ),

  'fun.lemmikud': ctx => (
    <Block title={t('Lemmikud', 'Favourites')} sub={t('Kogu aeg', 'All time')}>
      <Facts rows={[
        {
          label: t('Sagedaseim värv', 'Most common shade'),
          value: ctx.fun.favouriteShade
            ? `${ctx.fun.favouriteShade.label} · ${ctx.fun.favouriteShade.value}×`
            : '—',
        },
        { label: t('Erinevaid materjale', 'Different materials'), value: ctx.fun.materialsUsed, muted: true },
        { label: t('Hambakaardi katvus', 'Tooth chart coverage'), value: t(`${ctx.fun.toothMapCoverage}/32 positsiooni`, `${ctx.fun.toothMapCoverage}/32 positions`), muted: true },
        {
          label: t('Lojaalseim patsient', 'Most loyal patient'),
          value: ctx.fun.loyalPatient ? t(`${ctx.fun.loyalPatient.value} tööd`, `${ctx.fun.loyalPatient.value} ${ctx.fun.loyalPatient.value === 1 ? 'job' : 'jobs'}`) : '—',
          muted: true,
        },
        {
          label: t('Sagedaseim muudatuse põhjus', 'Most common revision reason'),
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
      icon={Zap} label={t('Tempo', 'Pace')} value={t(`${ctx.fun.weekendJobs} nädalavahetusel`, `${ctx.fun.weekendJobs} at weekends`)}
      scope={t('kogu aeg', 'all time')} accent="#F97316"
      sub={t(`Kiirtöid ${pct(ctx.fun.rushPct)} kõigist töödest`, `Rush jobs ${pct(ctx.fun.rushPct)} of all jobs`)}
    />
  ),

  'fun.algus': ctx => (
    <StatTile
      icon={CalendarDays} label={t('Kaua me juba teeme', 'How long we’ve been at it')}
      value={ctx.fun.daysInBusiness === null ? '—' : t(`${ctx.fun.daysInBusiness} p`, `${ctx.fun.daysInBusiness} d`)}
      scope={t('kogu aeg', 'all time')} accent="#6366F1"
      sub={ctx.fun.firstJobDate ? t(`Esimene töö ${ctx.fun.firstJobDate}`, `First job ${ctx.fun.firstJobDate}`) : t('Ühtegi tööd ei ole veel', 'No jobs yet')}
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
