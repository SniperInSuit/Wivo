import { useState } from 'react'
import { format, parseISO, isValid, addMonths, startOfMonth, endOfMonth } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts'
import { TrendingUp, Users, Clock, AlertCircle, Euro, CheckCircle, Package, Layers, Zap, Cpu, Timer, CalendarClock, UserX, UserPlus, Stethoscope, Repeat } from 'lucide-react'
import type { Job } from '../../types/job'
import {
  type Period, type DateRange, useDashboardStats, customIsUsable,
} from './useDashboardStats'
import { useVisits } from '../../hooks/useVisits'
import { usePatients } from '../../hooks/usePatients'
import { VISIT_STATUS_HEX, VISIT_STATUS_LABEL } from '../../types/visit'
import { FinanceView } from './FinanceView'
import { useWorkTypes } from '../../stores/useSettings'
import { usePayments } from '../../hooks/useInvoices'
import { unitSplitLabel, teethSplitLabel, MONEY_HINT } from '../../lib/periodMetrics'
import { StatTile } from '../ui/StatTile'
import {
  CHART_COLORS, TOOLTIP_STYLE, rowChartHeight, NAME_AXIS_WIDTH, truncateName,
} from './chartTheme'
import { MyView } from './MyView'
import { useAuth } from '../../context/AuthContext'

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: 'week', label: 'See nädal' },
  // 'kuu', not 'month': a named month, defaulting to this one. The fixed "See
  // kuu" it replaces answered a strictly smaller question — every month other
  // than the current one meant typing two dates into the range picker.
  { key: 'kuu', label: 'Kuu' },
  { key: 'quarter', label: 'See kvartal' },
  { key: 'year', label: 'See aasta' },
  { key: 'all', label: 'Kõik' },
  { key: 'custom', label: 'Vahemik' },
]

/** 'yyyy-MM' → the whole calendar month, both ends inclusive. */
function monthRange(month: string): DateRange {
  const base = parseISO(`${month}-01`)
  if (!isValid(base)) return { start: '', end: '' }
  return {
    start: format(startOfMonth(base), 'yyyy-MM-dd'),
    end: format(endOfMonth(base), 'yyyy-MM-dd'),
  }
}

const shiftMonth = (month: string, by: number): string =>
  format(addMonths(parseISO(`${month}-01`), by), 'yyyy-MM')

interface DashboardProps {
  jobs: Job[]
}

export function Dashboard({ jobs }: DashboardProps) {
  const [period, setPeriod] = useState<Period>('kuu')
  // The month "Kuu" reports on. Starts at the current one, so the page opens on
  // exactly the window it opened on before this picker existed.
  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  // Both ends empty until the user types them. An incomplete range is not a
  // filter, so the stats fall back to "all" rather than showing nothing.
  const [custom, setCustom] = useState<DateRange>({ start: '', end: '' })
  const [tab, setTab] = useState<'minu' | 'tootmine' | 'rahandus'>('minu')
  const { role } = useAuth()
  // Visits and patients may not exist yet (migrations 001/007) — the hook takes
  // empty arrays and simply reports zeroes rather than breaking the page.
  const { data: visits = [] } = useVisits()
  const { data: patients = [] } = usePatients()
  // Cash received. "Makstud" is a payments question, never the legacy flag.
  const { data: payments = [] } = usePayments()
  // A picked month is a range like any other — resolved here, once, so neither
  // the stats hook nor Rahandus has to know which control produced it.
  const window: DateRange = period === 'kuu' ? monthRange(month) : custom
  const stats = useDashboardStats(jobs, period, visits, patients, window, payments)
  const wt = useWorkTypes()

  const paidPct =
    stats.totalRevenue > 0
      ? Math.round((stats.paidRevenue / stats.totalRevenue) * 100)
      : 0

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      {/* Tabs. Production and money answer different questions and the page was
          already long; splitting them beats one scroll that mixes tooth counts
          with margins. */}
      <div className="flex items-center gap-1 bg-bg-sidebar rounded-xl p-1 w-fit">
        {([
          { key: 'minu', label: 'Minu vaade' },
          { key: 'tootmine', label: 'Tootmine' },
          { key: 'rahandus', label: 'Rahandus' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-muted mr-1">Periood:</span>
        {PERIOD_OPTIONS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-100 ${
              period === p.key
                ? 'bg-accent text-white'
                : 'bg-bg-sidebar text-ink-muted hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}

        {/* Arrows for the neighbouring months, a native month field for a
            distant one. Two clicks to last month, never four. */}
        {period === 'kuu' && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => setMonth(m => shiftMonth(m, -1))}
              aria-label="Eelmine kuu"
              className="px-2 py-1.5 rounded-lg bg-bg-sidebar text-ink-muted hover:text-ink transition-colors"
            >
              ‹
            </button>
            <input
              type="month"
              value={month}
              onChange={e => { if (e.target.value) setMonth(e.target.value) }}
              aria-label="Kuu"
              className="input py-1.5 text-sm w-auto"
            />
            <button
              onClick={() => setMonth(m => shiftMonth(m, 1))}
              aria-label="Järgmine kuu"
              className="px-2 py-1.5 rounded-lg bg-bg-sidebar text-ink-muted hover:text-ink transition-colors"
            >
              ›
            </button>
            {month !== format(new Date(), 'yyyy-MM') && (
              <button
                onClick={() => setMonth(format(new Date(), 'yyyy-MM'))}
                className="text-xs font-medium px-2 py-1.5 rounded-lg text-ink-muted hover:text-ink transition-colors"
              >
                Käesolev kuu
              </button>
            )}
          </div>
        )}

        {/* Shown only once "Vahemik" is chosen — two date fields sitting there
            permanently would read as filters that are already applied. */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={custom.start}
              onChange={e => setCustom(c => ({ ...c, start: e.target.value }))}
              aria-label="Alates"
              className="input py-1.5 text-sm w-auto"
            />
            <span className="text-sm text-ink-faint">–</span>
            <input
              type="date"
              value={custom.end}
              onChange={e => setCustom(c => ({ ...c, end: e.target.value }))}
              aria-label="Kuni"
              className="input py-1.5 text-sm w-auto"
            />
            {!customIsUsable(custom) && (
              <span className="text-xs text-ink-faint">
                Vali mõlemad kuupäevad — seni näidatakse kõiki töid.
              </span>
            )}
          </div>
        )}
      </div>

      {tab === 'minu' && (
        <MyView jobs={jobs} period={period} window={window} role={role} />
      )}

      {tab === 'rahandus' && <FinanceView jobs={jobs} period={period} custom={window} />}

      {tab === 'tootmine' && (<>
      {/* ─── Summary cards ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Kokkuvõte
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={Users}
            label="Töid kokku"
            value={stats.totalWork}
            sub={unitSplitLabel(stats.metrics)}
          />
          <StatTile
            icon={Layers}
            label="Tootmises"
            value={stats.inProduction.length}
            sub={`${stats.overdue.length} tähtajast üle`}
            accent="#F59E0B"
          />
          <StatTile
            icon={TrendingUp}
            label="Hambaid toodetud"
            value={stats.totalTeeth}
            sub={`Ø ${stats.avgTeethPerJob.toFixed(1)} / töö · ${teethSplitLabel(stats.metrics)}`}
            accent="#10B981"
            breakdown={{
              left: { label: 'originaal', value: stats.originalTeeth, color: '#0AB6C4' },
              right: { label: 'muudatused', value: stats.revisionTeeth, color: '#EC4899' }
            }}
          />
          <StatTile
            icon={AlertCircle}
            label="Revisjonimäär"
            value={`${stats.revisionRate.toFixed(1)}%`}
            sub={`${stats.withRevision.length} tööd`}
            accent="#EC4899"
          />
        </div>
      </section>

      {/* ─── Payment stats ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Euro size={13} /> Maksed
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatTile
            icon={Euro}
            label="Käive kokku"
            value={`${stats.totalRevenue.toFixed(2)} €`}
            sub={MONEY_HINT.kaive}
          />
          <StatTile
            icon={CheckCircle}
            label="Laekunud"
            value={`${stats.paidRevenue.toFixed(2)} €`}
            sub={`${paidPct}% käibest · ${MONEY_HINT.laekunud.toLowerCase()}`}
            accent="#22C55E"
          />
          <StatTile
            icon={Clock}
            label="Maksmata"
            value={`${stats.unpaidRevenue.toFixed(2)} €`}
            sub="Käive − laekunud"
            accent="#EF4444"
          />
          <StatTile
            icon={TrendingUp}
            label="Ø hind / töö"
            value={`${stats.avgPrice.toFixed(2)} €`}
            sub={`Ø ${stats.avgPricePerTooth.toFixed(2)} € / hammas`}
            coverage={stats.priceCoverage}
            coverageLabel="tööl on hind"
          />
        </div>

        {/* Paid vs Outstanding donut */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Tasutud vs ootel</p>
            {stats.totalRevenue > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Laekunud', value: stats.paidRevenue },
                        { name: 'Maksmata', value: stats.unpaidRevenue }
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill="#22C55E" />
                      <Cell fill="#FCA5A5" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
                    <span className="text-ink-muted">Laekunud: </span>
                    <span className="font-semibold">{stats.paidRevenue.toFixed(2)} €</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-200 inline-block" />
                    <span className="text-ink-muted">Maksmata: </span>
                    <span className="font-semibold">{stats.unpaidRevenue.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>

          {/* Revenue by month bar chart */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Käive kuude kaupa (€)</p>
            {stats.revenueByMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={stats.revenueByMonth} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v} €`, 'Käive']} />
                  <Bar dataKey="revenue" fill="#0AB6C4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Material stats ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Package size={13} /> Materjalid
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* Bar chart: jobs per material */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Tööd materjali järgi</p>
            {stats.materialStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={stats.materialStats}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 60, bottom: 0 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={58} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {stats.materialStats.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>

          {/* Donut: share per material */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Osakaal (%)</p>
            {stats.materialStats.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={140}>
                  <PieChart>
                    <Pie
                      data={stats.materialStats}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={32}
                      outerRadius={55}
                      strokeWidth={0}
                    >
                      {stats.materialStats.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, name) => [v, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 text-xs flex-1 overflow-hidden">
                  {stats.materialStats.map((m, i) => (
                    <div key={m.name} className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-ink-muted truncate">{m.name}</span>
                      <span className="font-semibold ml-auto">{m.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Production stats ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> Tootmine
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* WIP by stage */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Praegune WIP etappide kaupa</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.wipByStage} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {stats.wipByStage.map((s) => (
                    <Cell key={s.name} fill={s.hex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Throughput */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Valmis tööd kuude kaupa</p>
            {stats.throughput.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={stats.throughput} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#0AB6C4"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#0AB6C4' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Kiirtöö + Turnaround + Machine ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap size={13} /> Kiirtöö & Masinad
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={Zap}
            label="Kiirtööd"
            value={stats.kiirtooJobs.length}
            sub={`${stats.kiirtooRevenue.toFixed(2)} € käive`}
            accent="#F97316"
          />
          <StatTile
            icon={Timer}
            label="Ø läbiaeg"
            value={stats.avgTurnaround > 0 ? `${stats.avgTurnaround.toFixed(1)} p` : '—'}
            sub="vastuvõtust valmimiseni"
            accent="#8B5CF6"
            coverage={stats.turnaroundCoverage}
            coverageLabel="tööl on valmimiskuupäev"
          />
          {stats.machineStats.slice(0, 2).map((m) => (
            <StatTile
              key={m.name}
              icon={Cpu}
              label={m.name}
              value={m.count}
              sub="printimist"
              accent="#0AB6C4"
            />
          ))}
        </div>
      </section>

      {/* ─── Top patients + Teeth by work type ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <Users size={13} /> Patsiendid & Töötüübid
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch items-stretch">
          {/* Top patients */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-0.5">Top patsiendid (hambad)</p>
            <p className="text-xs text-ink-faint mb-3">Originaal + muudatuste hambad patsiendi kaupa</p>
            {stats.topPatients.length > 0 ? (
              <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.topPatients}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category" dataKey="name" tick={{ fontSize: 11 }}
                    width={NAME_AXIS_WIDTH} interval={0} tickFormatter={truncateName}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v} hammast`, name === 'original' ? 'Originaal' : 'Muudatused']} />
                  <Bar dataKey="original" stackId="teeth" fill="#6366F1" radius={[0, 0, 0, 0]} name="original" />
                  <Bar dataKey="revision" stackId="teeth" fill="#EC4899" radius={[0, 4, 4, 0]} name="revision" />
                </BarChart>
              </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6 flex-1">Andmed puuduvad</p>
            )}
          </div>

          {/* Work by work type — jobs, not teeth */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-0.5">Tööd töötüübi järgi</p>
            <p className="text-xs text-ink-faint mb-3">Tööde arv töö liigi kaupa (originaal + muudatused)</p>
            {stats.workByType.length > 0 ? (
              <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.workByType}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category" dataKey="name" tick={{ fontSize: 11 }}
                    width={NAME_AXIS_WIDTH} interval={0} tickFormatter={truncateName}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v} tööd`, name === 'original' ? 'Originaal' : 'Muudatused']} />
                  <Bar dataKey="original" stackId="teeth" fill="#0AB6C4" radius={[0, 0, 0, 0]} name="original" />
                  <Bar dataKey="revision" stackId="teeth" fill="#EC4899" radius={[0, 4, 4, 0]} name="revision" />
                </BarChart>
              </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6 flex-1">Andmed puuduvad</p>
            )}
          </div>

          {/* Revision rate by work type */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-0.5">Muudatuste määr töötüübi järgi</p>
            <p className="text-xs text-ink-faint mb-3">Mitu muudatust 100 töö kohta</p>
            {stats.byWorkType.length > 0 ? (
              <div className="space-y-2">
                {stats.byWorkType.filter(t => t.count > 0).map(t => {
                  const rate = t.count > 0 ? (t.revisions / t.count) * 100 : 0
                  const maxRate = Math.max(100, ...stats.byWorkType.map(x => x.count > 0 ? (x.revisions / x.count) * 100 : 0))
                  return (
                    <div key={t.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: wt.hex(t.name) }} />
                      <span className="text-ink-muted truncate w-24 flex-shrink-0">{t.name}</span>
                      <div className="flex-1 h-4 bg-bg-sidebar rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(rate / maxRate) * 100}%`,
                            backgroundColor: rate > 50 ? '#EF4444' : rate > 25 ? '#F59E0B' : '#10B981'
                          }}
                        />
                      </div>
                      <span className="tabular-nums font-semibold text-ink w-14 text-right">{rate.toFixed(0)}%</span>
                      <span className="tabular-nums text-ink-faint w-16 text-right">{t.revisions}/{t.count}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>

          {/* Revision reasons breakdown */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-0.5">Muudatuste põhjused</p>
            <p className="text-xs text-ink-faint mb-3">Miks muudatusi tehakse</p>
            {stats.revisionReasons.length > 0 ? (
              <div className="space-y-2">
                {stats.revisionReasons.map((r, i) => {
                  const total = stats.revisionReasons.reduce((s, x) => s + x.count, 0)
                  const pct = total > 0 ? (r.count / total) * 100 : 0
                  const REASON_COLORS = ['#EF4444', '#F59E0B', '#6366F1', '#EC4899', '#10B981', '#3B82F6', '#8B5CF6', '#14B8A6', '#F97316']
                  return (
                    <div key={r.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: REASON_COLORS[i % REASON_COLORS.length] }} />
                      <span className="text-ink-muted truncate flex-1">{r.name}</span>
                      <div className="w-24 h-4 bg-bg-sidebar rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: REASON_COLORS[i % REASON_COLORS.length] }}
                        />
                      </div>
                      <span className="tabular-nums font-semibold text-ink w-8 text-right">{r.count}</span>
                      <span className="tabular-nums text-ink-faint w-10 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Muudatusi pole</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Tooth analysis ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> Hammaste analüüs
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* Weakest teeth */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-1">Nõrgemad hambad (FDI)</p>
            <p className="text-xs text-ink-faint mb-3">Kõige sagedamini töödeldud</p>
            {stats.weakestTeeth.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={stats.weakestTeeth}
                  margin={{ top: 0, right: 8, left: -10, bottom: 0 }}
                >
                  <XAxis dataKey="tooth" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v, 'Töötlusi']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {stats.weakestTeeth.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>

          {/* Strongest teeth */}
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-1">Tugevamad hambad (FDI)</p>
            <p className="text-xs text-ink-faint mb-3">Harva töödeldud (kõige vastupidavamad)</p>
            {stats.strongestTeeth.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={stats.strongestTeeth}
                  margin={{ top: 0, right: 8, left: -10, bottom: 0 }}
                >
                  <XAxis dataKey="tooth" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v, 'Töötlusi']} />
                  <Bar dataKey="count" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Vastupidavus / purunemine ─── */}
      {stats.durability.total > 0 && (
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> Vastupidavus
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-1">Kokkuvõte</p>
            <p className="text-xs text-ink-faint mb-3">Purunemised ja keskmine eluiga</p>
            <div className="space-y-2 flex-1">
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Purunemisi kokku</span>
                <span className="font-bold text-ink">{stats.durability.total}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Keskmine eluiga</span>
                <span className="font-bold text-ink">{stats.durability.avgDays} päeva</span>
              </div>
            </div>
          </div>

          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-1">Materjali järgi</p>
            <p className="text-xs text-ink-faint mb-3">Keskmine vastupidavus materjali kaupa</p>
            <div className="space-y-1.5 flex-1">
              {stats.durability.byMaterial.map(m => (
                <div key={m.name} className="flex items-center justify-between text-xs">
                  <span className="text-ink-muted truncate flex-1">{m.name}</span>
                  <span className="tabular-nums text-ink-faint w-8 text-right">{m.count}×</span>
                  <span className="tabular-nums font-semibold text-ink w-16 text-right">{m.avgDays} p</span>
                </div>
              ))}
              {stats.durability.byMaterial.length === 0 && (
                <p className="text-xs text-ink-faint">Andmed puuduvad</p>
              )}
            </div>
          </div>

          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-1">Töötüübi järgi</p>
            <p className="text-xs text-ink-faint mb-3">Keskmine vastupidavus töötüübi kaupa</p>
            <div className="space-y-1.5 flex-1">
              {stats.durability.byWorkType.map(t => (
                <div key={t.name} className="flex items-center justify-between text-xs">
                  <span className="text-ink-muted truncate flex-1">{t.name}</span>
                  <span className="tabular-nums text-ink-faint w-8 text-right">{t.count}×</span>
                  <span className="tabular-nums font-semibold text-ink w-16 text-right">{t.avgDays} p</span>
                </div>
              ))}
              {stats.durability.byWorkType.length === 0 && (
                <p className="text-xs text-ink-faint">Andmed puuduvad</p>
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      <div className="h-4" /> {/* bottom spacer */}

      {/* ─── Visiidid ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Visiidid
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={CalendarClock}
            label="Visiite kokku"
            value={stats.visitStats.total}
            sub={`${stats.visitStats.planeeritud} planeeritud · ${stats.visitStats.toimunud} toimunud`}
          />
          <StatTile
            icon={UserX}
            label="Ei tulnud"
            value={`${stats.visitStats.noShowRate.toFixed(0)}%`}
            sub={`${stats.visitStats.eiTulnud} visiiti · tühistamised välja arvatud`}
          />
          <StatTile
            icon={Timer}
            label="Ø visiidi kestus"
            value={`${stats.visitStats.avgKestus.toFixed(0)} min`}
          />
          <StatTile
            icon={AlertCircle}
            label="Tühistatud"
            value={stats.visitStats.tuhistatud}
            sub="ette teatatud"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch mt-3">
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Visiidid nädalapäeva järgi</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.visitsByWeekday}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8EC" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#637381' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#637381' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Visiite" fill="#0AB6C4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink mb-3">Visiitide seis</p>
            <div className="space-y-2">
              {(['planeeritud', 'saabunud', 'toimunud', 'ei_tulnud', 'tuhistatud'] as const).map(st => {
                const map = {
                  planeeritud: stats.visitStats.planeeritud,
                  saabunud: stats.visitStats.saabunud,
                  toimunud: stats.visitStats.toimunud,
                  ei_tulnud: stats.visitStats.eiTulnud,
                  tuhistatud: stats.visitStats.tuhistatud
                }
                const count = map[st]
                const pctOf = stats.visitStats.total > 0 ? (count / stats.visitStats.total) * 100 : 0
                return (
                  <div key={st}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="flex items-center gap-1.5 text-ink-muted">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: VISIT_STATUS_HEX[st] }} />
                        {VISIT_STATUS_LABEL[st]}
                      </span>
                      <span className="font-semibold text-ink tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg-sidebar overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pctOf}%`, backgroundColor: VISIT_STATUS_HEX[st] }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Kust töö tuleb ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Kust töö tuleb
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink">Top suunavad arstid</p>
            <p className="text-[11px] text-ink-muted mb-3">Käive patsiendi kaardil oleva arsti järgi</p>
            {stats.byDoctor.length === 0 ? (
              <p className="text-sm text-ink-muted">Andmed puuduvad.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, stats.byDoctor.length * 30)}>
                <BarChart data={stats.byDoctor} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8EC" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#637381' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="name" width={110}
                    tick={{ fontSize: 11, fill: '#637381' }} axisLine={false} tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(2)} €`, 'Käive']} />
                  <Bar dataKey="revenue" fill="#0AB6C4" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card p-4 flex flex-col">
            <p className="text-sm font-semibold text-ink">Käive töö liigi järgi</p>
            <p className="text-[11px] text-ink-muted mb-3">Sama liigitus, mida kalender kasutab</p>
            {stats.byWorkType.length === 0 ? (
              <p className="text-sm text-ink-muted">Andmed puuduvad.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.byWorkType.slice(0, 8).map(t => (
                  <div key={t.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: wt.hex(t.name) }} />
                    <span className="text-ink-muted truncate flex-1">{t.name}</span>
                    <span className="text-ink-faint tabular-nums w-20 text-right">
                      {t.count}× <span className="text-ink-faint/60">+ {t.revisions}m</span>
                    </span>
                    <span className="text-ink-faint tabular-nums w-16 text-right">Ø {t.avgPrice.toFixed(0)} €</span>
                    <span className="font-semibold text-ink tabular-nums w-20 text-right">{t.revenue.toFixed(2)} €</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── Patsiendid ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Patsiendid
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile icon={Users} label="Patsiente kokku" value={stats.patientSummary.total} />
          <StatTile
            icon={UserPlus} label="Uusi patsiente" value={stats.patientSummary.newPatients}
            sub="valitud perioodil lisatud"
          />
          <StatTile
            icon={Repeat} label="Korduvad patsiendid" value={stats.patientSummary.repeatPatients}
            sub={`${stats.patientSummary.repeatRate.toFixed(0)}% neist, kellel on töid`}
          />
          <StatTile
            icon={Stethoscope} label="Suunavaid arste" value={stats.byDoctor.length}
            sub="käibe järgi top 8"
          />
        </div>
      </section>
      </>)}
    </div>
  )
}
