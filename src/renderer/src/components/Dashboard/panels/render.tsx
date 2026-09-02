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
import type { PanelCtx } from '../useStatsContext'
import type { PanelId } from './catalogue'

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
  if (rows.length === 0) return <Empty>Andmeid ei ole.</Empty>
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
      icon={TrendingUp} label="Kasum (tulu − kulu)" value={eur(ctx.profit.profit)}
      accent={ctx.profit.profit >= 0 ? '#22C55E' : '#EF4444'}
      sub={`Kate ${pct(ctx.profit.profitPct)}`}
      // Both coverages, because this number subtracts both. The overhead caveat
      // is separate: subtracting an unentered zero and calling it profit is the
      // same lie as a margin that ignores labour.
      coverage={ctx.fin.labourCoverage} coverageLabel="tööl on teostaja"
    />
  ),

  'raha.kulud': ctx => (
    <Block title="Kulu kokku" sub={eur(ctx.profit.costs)}>
      <ShareBars rows={[
        { label: 'Tööjõud + maksud', value: eur(ctx.profit.labour), share: share(ctx.profit.labour, ctx.profit.costs) },
        { label: 'Materjal ja tarvikud', value: eur(ctx.profit.material), share: share(ctx.profit.material, ctx.profit.costs) },
        { label: 'Fikseeritud', value: eur(ctx.profit.fixed), share: share(ctx.profit.fixed, ctx.profit.costs) },
        { label: 'Üldkulud', value: eur(ctx.profit.overheads), share: share(ctx.profit.overheads, ctx.profit.costs) },
      ].filter(r => r.value !== '0.00 €')} />
      {ctx.profit.overheads === 0 && (
        <p className="text-[11px] text-orange-500 mt-2 leading-relaxed">
          Üldkulusid ei ole sisestatud — see on kate, mitte kasum. Seaded → Hinnad → Üldkulud.
        </p>
      )}
    </Block>
  ),

  'raha.kate': ctx => (
    <StatTile
      icon={Percent} label="Brutokate" value={eur(ctx.fin.grossMargin)}
      sub={`${pct(ctx.fin.grossMarginPct)} arveldatust · netokate ${eur(ctx.fin.netMargin)} (${pct(ctx.fin.netMarginPct)})`}
      accent="#6366F1"
      coverage={ctx.fin.materialCoverage} coverageLabel="tööl on omahind"
    />
  ),

  'raha.kaive': ctx => (
    <StatTile icon={Euro} label="Käive" value={eur(ctx.m.money)} sub={MONEY_HINT.kaive} />
  ),

  'raha.arveldatud': ctx => (
    <StatTile icon={Euro} label="Arveldatud" value={eur(ctx.fin.billed)} sub={MONEY_HINT.arveldatud} />
  ),

  'raha.laekunud': ctx => (
    <StatTile icon={Wallet} label="Laekunud" value={eur(ctx.fin.received)} sub={MONEY_HINT.laekunud} accent="#22C55E" />
  ),

  'raha.tasumata': ctx => (
    <StatTile
      icon={Clock} label="Tasumata arvete järgi" value={eur(ctx.fin.outstanding)} accent="#F59E0B"
      sub={ctx.fin.overdue > 0
        ? `${eur(ctx.fin.overdue)} üle tähtaja`
        : 'Ainult väljastatud arved. Arveta töö on „Arveldamata" all.'}
    />
  ),

  'raha.arveldamata': ctx => (
    <StatTile
      icon={FileWarning} label="Arveldamata" value={eur(ctx.fin.unbilled)} accent="#EF4444"
      sub={`${ctx.fin.unbilledJobs} valmis tööd ilma arveta`}
    />
  ),

  'raha.toojoukulu': ctx => (
    <StatTile
      icon={Users} label="Tööjõud + maksud + arve" value={eur(ctx.fin.labourAccrued + ctx.profit.employerTax)}
      accent="#8B5CF6"
      sub={[
        `Bruto ${eur(ctx.fin.labourEmployeeGross)}`,
        ctx.profit.employerTax > 0 ? `Maksud ${eur(ctx.profit.employerTax)}` : null,
        ctx.fin.labourContractor > 0 ? `Arve alusel ${eur(ctx.fin.labourContractor)}` : null,
      ].filter(Boolean).join(' · ')}
      coverage={ctx.fin.labourCoverage} coverageLabel="tööl on teostaja"
    />
  ),

  'raha.valjamakstud': ctx => (
    <StatTile
      icon={Wallet} label="Arvestatud vs välja makstud" value={eur(ctx.fin.labourAccrued)}
      accent="#8B5CF6"
      sub={`Välja makstud ${eur(ctx.fin.labourPaid)} · maksmata ${eur(Math.max(0, ctx.fin.labourAccrued - ctx.fin.labourPaid))}`}
    />
  ),

  'raha.kaive_kuude_kaupa': ctx => (
    <Block title="Käive kuude kaupa">
      {ctx.stats.revenueByMonth.length === 0 ? <Empty>Andmeid ei ole.</Empty> : (
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
    <Block title="Maksmise viis" sub="Kuidas raha päriselt saabub">
      <ShareBars rows={ctx.fin.byPaymentMethod.map(p => ({
        label: `${p.label} · ${p.count}×`,
        value: eur(p.amount),
        share: p.share,
      }))} />
    </Block>
  ),

  'raha.muudatuste_kahju': ctx => (
    <Block title="Muudatuste kahju" sub={`Netokahju kokku ${eur(ctx.fin.revisionLossTotal)}`}>
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
      icon={HandCoins} label="Võlgu kokku" value={eur(ctx.debt.outstanding)}
      accent={ctx.debt.overdue > 0 ? '#EF4444' : '#F59E0B'}
      sub={ctx.debt.count === 0
        ? 'Keegi ei võlgne · kogu aeg'
        : `${ctx.debt.count} võlglast · üle tähtaja ${eur(ctx.debt.overdue)} · kogu aeg`}
    />
  ),

  'raha.volglased': ctx => {
    const rows = ctx.debt.rows.slice(0, 10)
    const worst = rows[0]?.outstanding ?? 0
    return (
      <Block
        title="Kes on võlgu"
        sub={`Kogu aeg · arveldamata ${eur(ctx.debt.uninvoiced)} ei ole üle tähtaja — arvet ei ole saadetud`}
      >
        {rows.length === 0
          ? <Empty>Ükski töö ei ole tasumata.</Empty>
          : <ShareBars rows={rows.map(r => ({
              label: `${r.nimi}${r.daysLate > 0 ? ` · ${r.daysLate} p üle` : r.partial ? ' · osaliselt makstud' : ''}`,
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
      <Block title="Võla vanus" sub="Arve maksetähtajast, mitte töö kuupäevast">
        {ctx.debt.overdue === 0
          ? <Empty>Ükski saadetud arve ei ole üle tähtaja.</Empty>
          : <ShareBars rows={buckets.filter(b => b.amount > 0).map(b => ({
              label: `${b.label} · ${b.count}`,
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
      icon={TrendingUp} label="Hind hamba kohta" value={eur(ctx.stats.avgPricePerTooth)}
      sub={`${ctx.m.hambad} hammast · ${teethSplitLabel(ctx.m)}`}
    />
  ),

  'yhik.tulu_too_kohta': ctx => (
    <StatTile
      icon={Euro} label="Ø hind / töö" value={eur(ctx.stats.avgPrice)}
      sub={unitSplitLabel(ctx.m)}
      coverage={ctx.stats.priceCoverage} coverageLabel="tööl on hind"
    />
  ),

  'yhik.kiirtoo_tasuvus': ctx => (
    <StatTile
      icon={Zap} label="Kiirtöö tasuvus" value={`${ctx.stats.kiirtooJobs.length} tööd`}
      accent="#F97316"
      sub={ctx.m.money > 0
        ? `${eur(ctx.stats.kiirtooRevenue)} · ${pct(share(ctx.stats.kiirtooRevenue, ctx.m.money))} käibest`
        : `${eur(ctx.stats.kiirtooRevenue)} käive`}
    />
  ),

  'yhik.kate_tootyybi_jargi': ctx => {
    // A COPY — fin.byWorkType is memoised inside the aggregator.
    const rows = [...ctx.fin.byWorkType].sort((a, b) => b.margin - a.margin)
    return (
      <Block title="Kate töö tüübi järgi" sub="Ühik on tööosa, mitte töö: mitme tüübiga juhtum loeb igas tüübis">
        {rows.length === 0 ? <Empty>Valmis töid ei ole.</Empty> : (
          <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                  <th className="px-2 py-1.5 font-semibold">Töö tüüp</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Tööosi</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Hambaid</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Tulu</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Tööjõud</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Materjal</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Kate</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Kate %</th>
                  <th className="px-2 py-1.5 font-semibold text-right">€/hammas kate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.name} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: ctx.wt.hex(t.name) }} />
                        <span className="text-ink font-medium truncate">{t.name}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{t.jobs}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-faint">{t.teeth || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">{t.income.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{t.labour.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{t.material.toFixed(2)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${t.margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {t.margin.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{t.marginPct.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-faint">
                      {t.teeth > 0 ? (t.margin / t.teeth).toFixed(2) : '—'}
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
    const losing = [...ctx.fin.byWorkType].filter(t => t.margin < 0).sort((a, b) => a.margin - b.margin)
    return (
      <Block
        title="Kahjumlikud töö tüübid"
        sub="Tüüp võib olla kahjumis ka lihtsalt sellepärast, et selle töö on arveldamata"
      >
        {losing.length === 0
          ? <Empty>Ühegi töötüübi kate ei ole negatiivne.</Empty>
          : <ShareBars rows={losing.slice(0, 6).map(t => ({
              label: t.name,
              value: eur(t.margin),
              share: share(Math.abs(t.margin), Math.abs(losing[0].margin)),
              color: '#EF4444',
            }))} />}
      </Block>
    )
  },

  // ── Tootmine ja tähtajad ───────────────────────────────────────────────────
  'toot.tood_kokku': ctx => (
    <StatTile
      icon={Layers} label="Töid kokku" value={ctx.m.yksused} sub={unitSplitLabel(ctx.m)}
      scope={ctx.period === 'all' ? 'kogu aeg' : undefined}
    />
  ),

  'toot.hambaid': ctx => (
    <StatTile
      icon={CheckCircle} label="Hambaid toodetud" value={ctx.m.hambad} sub={teethSplitLabel(ctx.m)}
      accent="#22C55E"
    />
  ),

  'toot.tahtajast_yle': ctx => (
    <StatTile
      icon={AlertCircle} label="Tähtajast üle" value={ctx.stats.overdue.length} accent="#EF4444"
      sub="lõpetamata, tähtaeg möödas" scope="hetkeseis"
    />
  ),

  'toot.labiaeg': ctx => (
    <StatTile
      icon={Timer} label="Ø läbiaeg"
      value={ctx.stats.avgTurnaround > 0 ? `${ctx.stats.avgTurnaround.toFixed(1)} p` : '—'}
      sub="vastuvõtust valmimiseni" accent="#8B5CF6"
      coverage={ctx.stats.turnaroundCoverage} coverageLabel="tööl on valmimiskuupäev"
    />
  ),

  'toot.muudatuste_maar': ctx => (
    <StatTile
      icon={Repeat} label="Revisjonimäär" value={pct(ctx.stats.revisionRate)}
      accent={ctx.stats.revisionRate > 15 ? '#EF4444' : '#EC4899'}
      // `filtered.length`, not `totalWork`: the rate is jobs-with-a-revision
      // over JOBS, and `totalWork` is units. The old line printed a denominator
      // the percentage above it was never computed from.
      sub={`${ctx.stats.withRevision.length} tööd ${ctx.stats.filtered.length}-st`}
    />
  ),

  'toot.wip': ctx => (
    <Block title="Töös etappide kaupa" sub="Hetkeseis, mitte perioodi number">
      {ctx.stats.wipByStage.length === 0 ? <Empty>Töös töid ei ole.</Empty> : (
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
    <Block title="Valmis tööd kuude kaupa">
      {ctx.stats.throughput.length === 0 ? <Empty>Andmeid ei ole.</Empty> : (
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
        title="Muudatuste põhjused"
        sub="Kahe põhjusega muudatus loeb mõlemas — ribade summa ületab muudatuste arvu"
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

  'toot.materjalid': ctx => (
    <Block title="Tööd materjali järgi">
      {ctx.stats.materialStats.length === 0 ? <Empty>Materjale ei ole märgitud.</Empty> : (
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
        icon={Cpu} label="Masinate koormus"
        value={top ? `${top.count}` : '—'}
        sub={top
          ? `${top.name}${ctx.stats.machineStats[1] ? ` · ${ctx.stats.machineStats[1].name} ${ctx.stats.machineStats[1].count}` : ''}`
          : 'Masinaid ei ole märgitud'}
        accent="#6366F1"
      />
    )
  },

  // ── Kliendid ja inimesed ───────────────────────────────────────────────────
  'inim.tootajad': ctx => (
    <Block title="Töötajate kaupa" sub="Arvestatud on selle perioodi teenistus, olenemata sellest, kas see on juba välja makstud">
      {ctx.fin.byWorker.length === 0 ? <Empty>Ühelegi tööle ei ole teostajat määratud.</Empty> : (
        <div className="overflow-auto h-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-ink-faint/15">
                <th className="px-2 py-1.5 font-semibold">Töötaja</th>
                <th className="px-2 py-1.5 font-semibold">Töösuhe</th>
                <th className="px-2 py-1.5 font-semibold text-right">Töid</th>
                <th className="px-2 py-1.5 font-semibold text-right">Hambaid</th>
                <th className="px-2 py-1.5 font-semibold text-right">Arvestatud</th>
                <th className="px-2 py-1.5 font-semibold text-right">Bruto</th>
                <th className="px-2 py-1.5 font-semibold text-right">Välja makstud</th>
              </tr>
            </thead>
            <tbody>
              {ctx.fin.byWorker.map(w => (
                <tr key={w.profileId} className="border-b border-ink-faint/10 last:border-0 even:bg-bg-sidebar/40">
                  <td className="px-2 py-1.5 text-ink">{w.name}</td>
                  <td className="px-2 py-1.5 text-ink-muted text-xs">
                    {w.engagement === 'ettevote' ? 'Esitab arve' : 'Palgal'}
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
      <Block title="Töötajate koormus" sub="Tööd ja hambad inimese kohta">
        <ShareBars rows={rows.map(w => ({
          label: `${w.name} · ${w.jobs} tööd`,
          value: `${w.teeth} hammast`,
          share: share(w.teeth, top),
        }))} />
      </Block>
    )
  },

  'inim.katvus': ctx => (
    <StatTile
      icon={AlertCircle} label="Andmete katvus"
      value={`${ctx.fin.labourCoverage.covered}/${ctx.fin.labourCoverage.total}`}
      accent="#F59E0B"
      sub={`tööl on teostaja · omahind ${ctx.fin.materialCoverage.covered}/${ctx.fin.materialCoverage.total}`}
    />
  ),

  'inim.patsiendid': ctx => (
    <StatTile
      icon={UserPlus} label="Patsiendid" value={ctx.stats.patientSummary.total}
      sub={`${ctx.stats.patientSummary.newPatients} uut · ${ctx.stats.patientSummary.repeatPatients} korduvat`}
      accent="#6366F1"
    />
  ),

  'inim.visiidid': ctx => (
    <StatTile
      icon={Stethoscope} label="Visiidid" value={ctx.stats.visitStats.total}
      sub={`Ei tulnud ${pct(ctx.stats.visitStats.noShowRate)} · Ø ${ctx.stats.visitStats.avgKestus.toFixed(0)} min`}
      accent="#EC4899"
    />
  ),

  'inim.arstid': ctx => (
    <Block title="Top suunavad arstid" sub="Käibe järgi">
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
      title="Võlgnevuse vanus"
      sub={`Üle tähtaja ${eur(ctx.invoices.agingTotal)} · tähtaeg ees ${eur(ctx.invoices.notDue)}`}
    >
      {ctx.invoices.agingTotal === 0
        ? <Empty>Ükski arve ei ole üle tähtaja.</Empty>
        : <ShareBars rows={ctx.invoices.aging.filter(b => b.amount > 0).map((b, i) => ({
            label: `${b.label} · ${b.count} arvet`,
            value: eur(b.amount),
            share: share(b.amount, ctx.invoices.agingTotal),
            // Older debt reads redder, because it is.
            color: ['#F59E0B', '#F97316', '#EF4444', '#B91C1C'][i] ?? '#EF4444',
          }))} />}
    </Block>
  ),

  'raha.laekumisaeg': ctx => (
    <StatTile
      icon={Clock} label="Keskmine laekumisaeg"
      value={ctx.invoices.daysToPay === null ? '—' : `${ctx.invoices.daysToPay} p`}
      accent="#6366F1"
      sub={ctx.invoices.daysToPay === null
        ? 'Perioodil ei ole ükski arve lõplikult tasutud'
        : `${ctx.invoices.daysToPaySample} arve alusel · arvest rahani`}
    />
  ),

  'raha.kaibemaks': ctx => (
    <StatTile
      icon={Percent} label="Käibemaks perioodis" value={eur(ctx.invoices.vat)}
      accent="#64748B" sub="väljastatud arvetel — riigile, mitte tulu"
    />
  ),

  'raha.keskmine_arve': ctx => (
    <StatTile
      icon={Euro} label="Keskmine arve" value={eur(ctx.invoices.averageInvoice)}
      sub={`${ctx.invoices.issuedCount} arvet · kokku ${eur(ctx.invoices.issued)}`}
    />
  ),

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  'yhik.kasum_too_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label="Kasum töö kohta"
      value={ctx.unit.profitPerJob === null ? '—' : eur(ctx.unit.profitPerJob)}
      accent={(ctx.unit.profitPerJob ?? 0) >= 0 ? '#22C55E' : '#EF4444'}
      sub={`${ctx.m.tood} tööd · muudatused ei ole eraldi tööd`}
      coverage={ctx.fin.labourCoverage} coverageLabel="tööl on teostaja"
    />
  ),

  'yhik.kate_hamba_kohta': ctx => (
    <StatTile
      icon={TrendingUp} label="Kate hamba kohta"
      value={ctx.unit.marginPerTooth === null ? '—' : eur(ctx.unit.marginPerTooth)}
      accent="#22C55E"
      sub={ctx.unit.revenuePerTooth !== null && ctx.unit.costPerTooth !== null
        ? `Tulu ${eur(ctx.unit.revenuePerTooth)} − kulu ${eur(ctx.unit.costPerTooth)}`
        : undefined}
      coverage={ctx.fin.materialCoverage} coverageLabel="tööl on omahind"
    />
  ),

  'yhik.kulu_hamba_kohta': ctx => (
    <StatTile
      icon={Package} label="Kulu hamba kohta"
      value={ctx.unit.costPerTooth === null ? '—' : eur(ctx.unit.costPerTooth)}
      accent="#F97316" sub={`${ctx.m.hambad} hammast`}
      coverage={ctx.fin.materialCoverage} coverageLabel="tööl on omahind"
    />
  ),

  'yhik.osakaalud': ctx => (
    <Block title="Kulude osakaal tulust" sub="Tööde väärtusest, mitte arveldatust">
      <ShareBars rows={[
        { label: 'Tööjõud + maksud', value: ctx.unit.labourSharePct === null ? '—' : pct(ctx.unit.labourSharePct), share: ctx.unit.labourSharePct ?? 0, color: '#8B5CF6' },
        { label: 'Materjal ja tarvikud', value: ctx.unit.materialSharePct === null ? '—' : pct(ctx.unit.materialSharePct), share: ctx.unit.materialSharePct ?? 0, color: '#F97316' },
        { label: 'Üldkulud', value: ctx.unit.overheadSharePct === null ? '—' : pct(ctx.unit.overheadSharePct), share: ctx.unit.overheadSharePct ?? 0, color: '#64748B' },
      ]} />
      <p className="text-[10px] text-ink-faint mt-2 leading-relaxed">
        Ülejäänu on kate. Materjali osakaal eeldab, et omahinnad on sisestatud —
        {' '}{ctx.fin.materialCoverage.covered}/{ctx.fin.materialCoverage.total} tööl on.
      </p>
    </Block>
  ),

  'yhik.tulu_toopaeva_kohta': ctx => (
    <StatTile
      icon={CalendarDays} label="Tulu tööpäeva kohta"
      value={ctx.unit.revenuePerWorkingDay === null ? '—' : eur(ctx.unit.revenuePerWorkingDay)}
      sub={`${ctx.unit.workingDays} tööpäeva möödas (E–R)`}
    />
  ),

  // ── Tootmine ───────────────────────────────────────────────────────────────
  'toot.tahtajaks': ctx => (
    <StatTile
      icon={CheckCircle} label="Tähtajaks valmis"
      value={ctx.onTime.ratePct === null ? '—' : pct(ctx.onTime.ratePct)}
      accent={(ctx.onTime.ratePct ?? 100) >= 90 ? '#22C55E' : '#F59E0B'}
      sub={ctx.onTime.ratePct === null
        ? 'Ühelgi valmis tööl ei ole tähtaega'
        : `${ctx.onTime.onTime} õigeks · ${ctx.onTime.late} hiljaks${
            ctx.onTime.averageDaysLate ? ` (Ø ${ctx.onTime.averageDaysLate} p)` : ''
          }`}
      coverage={ctx.onTime.coverage} coverageLabel="tööl on tähtaeg"
    />
  ),

  'toot.labiaeg_jaotus': ctx => (
    <Block title="Läbiaja jaotus" sub="Keskmine üksi varjab saba — mediaan ja 90. protsentiil ei">
      <Facts rows={[
        { label: 'Mediaan', value: ctx.turnaround.median === null ? '—' : `${ctx.turnaround.median} p` },
        { label: 'Keskmine', value: ctx.turnaround.average === null ? '—' : `${ctx.turnaround.average} p`, muted: true },
        { label: '9 tööd 10-st kiiremad kui', value: ctx.turnaround.p90 === null ? '—' : `${ctx.turnaround.p90} p` },
        { label: 'Kiireim', value: ctx.turnaround.fastest ? `${ctx.turnaround.fastest.days} p · ${ctx.turnaround.fastest.label}` : '—', muted: true },
        { label: 'Aeglaseim', value: ctx.turnaround.slowest ? `${ctx.turnaround.slowest.days} p · ${ctx.turnaround.slowest.label}` : '—', muted: true },
      ]} />
      {ctx.turnaround.coverage.missing > 0 && (
        <p className="text-[11px] text-orange-500 mt-2">
          {ctx.turnaround.coverage.missing} valmis tööl puudub valmimiskuupäev.
        </p>
      )}
    </Block>
  ),

  'toot.tarne': ctx => (
    <StatTile
      icon={Truck} label="Tarne seis" value={ctx.delivery.waiting}
      accent="#F59E0B"
      sub={ctx.delivery.buckets.map(b => `${b.label} ${b.count}`).join(' · ')}
    />
  ),

  'toot.tarneaeg': ctx => (
    <StatTile
      icon={Truck} label="Tarneaeg"
      value={ctx.delivery.averageLagDays === null ? '—' : `${ctx.delivery.averageLagDays} p`}
      accent="#6366F1" sub="valmimisest üleandmiseni"
    />
  ),

  'toot.nadalapaevad': ctx => (
    <Block title="Koormus nädalapäeva järgi" sub="Saabunud ja valminud tööd">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={ctx.weekdays}>
          <XAxis dataKey="weekday" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="received" name="Saabunud" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
          <Bar dataKey="finished" name="Valmis" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  ),

  // ── Kliendid ───────────────────────────────────────────────────────────────
  'inim.kliendid_kaive': ctx => {
    const rows = ctx.customers.rows.slice(0, 8)
    return (
      <Block title="Top kliendid" sub="Tööde väärtuse järgi">
        <ShareBars rows={rows.map(r => ({
          label: `${r.name} · ${r.jobs} tööd`,
          value: eur(r.revenue),
          share: share(r.revenue, rows[0]?.revenue ?? 0),
        }))} />
      </Block>
    )
  },

  'inim.kliendid_seis': ctx => (
    <StatTile
      icon={Users} label="Kliendid perioodis" value={ctx.customers.active}
      accent="#6366F1"
      sub={`${ctx.customers.added} uut · ${ctx.customers.dormant.length} magavat`}
    />
  ),

  'inim.kliendid_magavad': ctx => (
    <Block title="Magavad kliendid" sub="Ei ole 90 päeva tellinud">
      {ctx.customers.dormant.length === 0
        ? <Empty>Kõik kliendid on tellinud viimase 90 päeva jooksul.</Empty>
        : <Facts rows={ctx.customers.dormant.slice(0, 10).map(d => ({
            label: d.name,
            value: d.lastJob ?? 'ei ole kunagi tellinud',
            muted: true,
          }))} />}
    </Block>
  ),

  'inim.maksedistsipliin': ctx => {
    const rows = ctx.customers.rows.filter(r => r.daysToPay !== null)
    const worst = Math.max(...rows.map(r => r.daysToPay ?? 0), 1)
    return (
      <Block title="Klientide maksedistsipliin" sub="Keskmine päevade arv arvest makseni">
        {rows.length === 0
          ? <Empty>Ükski arve ei ole veel lõplikult tasutud.</Empty>
          : <ShareBars rows={rows.slice(0, 8).map(r => ({
              label: r.name,
              value: `${r.daysToPay} p`,
              share: share(r.daysToPay ?? 0, worst),
              color: (r.daysToPay ?? 0) > 30 ? '#EF4444' : '#22C55E',
            }))} />}
      </Block>
    )
  },

  // ── Lõbus teada ────────────────────────────────────────────────────────────
  'fun.hambad_kokku': ctx => (
    <StatTile
      icon={Smile} label="Hambaid kokku" value={ctx.fun.teethAllTime}
      scope="kogu aeg" accent="#EC4899"
      sub={`≈ ${ctx.fun.mouthsAllTime} täissuud · Ø ${ctx.fun.teethPerJob ?? '—'} hammast töö kohta`}
    />
  ),

  'fun.rekordid': ctx => (
    <Block title="Rekordid" sub="Kogu aeg">
      <Facts rows={[
        {
          label: 'Suurim töö',
          value: ctx.fun.biggestJob
            ? `${ctx.fun.biggestJob.value} hammast · ${ctx.fun.biggestJob.label}`
            : '—',
        },
        {
          label: 'Tihedaim päev',
          value: ctx.fun.busiestDay
            ? `${ctx.fun.busiestDay.value} hammast · ${ctx.fun.busiestDay.label}`
            : '—',
        },
        {
          label: 'Kiireim töö (periood)',
          value: ctx.turnaround.fastest ? `${ctx.turnaround.fastest.days} p` : '—',
          muted: true,
        },
        {
          label: 'Aeglaseim töö (periood)',
          value: ctx.turnaround.slowest ? `${ctx.turnaround.slowest.days} p` : '—',
          muted: true,
        },
        { label: 'Töid kokku', value: ctx.fun.jobsAllTime, muted: true },
      ]} />
    </Block>
  ),

  'fun.seeria': ctx => (
    <StatTile
      icon={Award} label="Pikim veatu seeria" value={ctx.fun.cleanStreak}
      scope="kogu aeg" accent="#22C55E"
      sub="valmis tööd järjest ilma ühegi muudatuseta"
    />
  ),

  'fun.lemmikud': ctx => (
    <Block title="Lemmikud" sub="Kogu aeg">
      <Facts rows={[
        {
          label: 'Sagedaseim värv',
          value: ctx.fun.favouriteShade
            ? `${ctx.fun.favouriteShade.label} · ${ctx.fun.favouriteShade.value}×`
            : '—',
        },
        { label: 'Erinevaid materjale', value: ctx.fun.materialsUsed, muted: true },
        { label: 'Hambakaardi katvus', value: `${ctx.fun.toothMapCoverage}/32 positsiooni`, muted: true },
        {
          label: 'Lojaalseim patsient',
          value: ctx.fun.loyalPatient ? `${ctx.fun.loyalPatient.value} tööd` : '—',
          muted: true,
        },
        {
          label: 'Sagedaseim muudatuse põhjus',
          value: ctx.fun.topRevisionReason
            ? `${ctx.fun.topRevisionReason.label} · ${ctx.fun.topRevisionReason.value}×`
            : '—',
          muted: true,
        },
      ]} />
    </Block>
  ),

  'fun.tempo': ctx => (
    <StatTile
      icon={Zap} label="Tempo" value={`${ctx.fun.weekendJobs} nädalavahetusel`}
      scope="kogu aeg" accent="#F97316"
      sub={`Kiirtöid ${pct(ctx.fun.rushPct)} kõigist töödest`}
    />
  ),

  'fun.algus': ctx => (
    <StatTile
      icon={CalendarDays} label="Kaua me juba teeme"
      value={ctx.fun.daysInBusiness === null ? '—' : `${ctx.fun.daysInBusiness} p`}
      scope="kogu aeg" accent="#6366F1"
      sub={ctx.fun.firstJobDate ? `Esimene töö ${ctx.fun.firstJobDate}` : 'Ühtegi tööd ei ole veel'}
    />
  ),
}

/** Percentage of a total, guarding the zero denominator this app has shipped before. */
function share(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}
