import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts'
import { TrendingUp, Users, Clock, AlertCircle, Euro, CheckCircle, Package, Layers, Zap, Cpu, Timer, CalendarClock, UserX, UserPlus, Stethoscope, Repeat } from 'lucide-react'
import type { Job } from '../../types/job'
import { type Period, useDashboardStats } from './useDashboardStats'
import { useVisits } from '../../hooks/useVisits'
import { usePatients } from '../../hooks/usePatients'
import { VISIT_STATUS_HEX, VISIT_STATUS_LABEL } from '../../types/visit'
import { workTypeHex } from '../../config/workTypes'

const CHART_COLORS = ['#0AB6C4', '#6366F1', '#F59E0B', '#10B981', '#EC4899', '#3B82F6']

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  breakdown
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  accent?: string
  breakdown?: { left: { label: string; value: number; color?: string }; right: { label: string; value: number; color?: string } }
}) {
  return (
    <div className="card p-5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${accent ?? '#0AB6C4'}18` }}
        >
          <Icon size={16} style={{ color: accent ?? '#0AB6C4' }} />
        </div>
        <span className="text-xs font-medium text-ink-muted">{label}</span>
      </div>
      <p className="text-2xl font-bold text-ink leading-none">{value}</p>
      {(sub || breakdown) && (
        <div className="flex items-center justify-between gap-2">
          {sub && <p className="text-xs text-ink-muted">{sub}</p>}
          {breakdown && (
            <div className="flex items-center gap-2.5 ml-auto flex-shrink-0">
              <span className="text-[11px] font-bold" style={{ color: breakdown.left.color ?? '#0AB6C4' }}>
                {breakdown.left.value} <span className="text-ink-faint font-normal">{breakdown.left.label}</span>
              </span>
              <span className="text-ink-faint/30">·</span>
              <span className="text-[11px] font-bold" style={{ color: breakdown.right.color ?? '#EC4899' }}>
                {breakdown.right.value} <span className="text-ink-faint font-normal">{breakdown.right.label}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Shared Recharts tooltip chrome — matches the card surface in every theme
const TOOLTIP_STYLE = {
  background: 'rgb(var(--c-bg-card))',
  border: '1px solid rgb(var(--c-ink-faint) / 0.25)',
  borderRadius: 12,
  fontSize: 12,
  color: 'rgb(var(--c-ink))'
} as const

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: 'month', label: 'See kuu' },
  { key: 'quarter', label: 'See kvartal' },
  { key: 'year', label: 'See aasta' },
  { key: 'all', label: 'Kõik' }
]

interface DashboardProps {
  jobs: Job[]
}

export function Dashboard({ jobs }: DashboardProps) {
  const [period, setPeriod] = useState<Period>('month')
  // Visits and patients may not exist yet (migrations 001/007) — the hook takes
  // empty arrays and simply reports zeroes rather than breaking the page.
  const { data: visits = [] } = useVisits()
  const { data: patients = [] } = usePatients()
  const stats = useDashboardStats(jobs, period, visits, patients)

  const paidPct =
    stats.totalRevenue > 0
      ? Math.round((stats.paidRevenue / stats.totalRevenue) * 100)
      : 0

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
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
      </div>

      {/* ─── Summary cards ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Kokkuvõte
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={Users}
            label="Töid kokku"
            value={stats.totalWork}
            sub={`${stats.filtered.length} tööd · ${stats.totalRevisions} muudatust`}
          />
          <StatCard
            icon={Layers}
            label="Tootmises"
            value={stats.inProduction.length}
            sub={`${stats.overdue.length} tähtajast üle`}
            accent="#F59E0B"
          />
          <StatCard
            icon={TrendingUp}
            label="Hambaid toodetud"
            value={stats.totalTeeth}
            sub={`Ø ${stats.avgTeethPerJob.toFixed(1)} / töö`}
            accent="#10B981"
            breakdown={{
              left: { label: 'originaal', value: stats.originalTeeth, color: '#0AB6C4' },
              right: { label: 'muudatused', value: stats.revisionTeeth, color: '#EC4899' }
            }}
          />
          <StatCard
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
          <StatCard
            icon={Euro}
            label="Käive kokku"
            value={`${stats.totalRevenue.toFixed(2)} €`}
          />
          <StatCard
            icon={CheckCircle}
            label="Makstud"
            value={`${stats.paidRevenue.toFixed(2)} €`}
            sub={`${paidPct}% käibest`}
            accent="#22C55E"
          />
          <StatCard
            icon={Clock}
            label="Maksmata"
            value={`${stats.unpaidRevenue.toFixed(2)} €`}
            accent="#EF4444"
          />
          <StatCard
            icon={TrendingUp}
            label="Ø hind / töö"
            value={`${stats.avgPrice.toFixed(2)} €`}
            sub={`Ø ${stats.avgPricePerTooth.toFixed(2)} € / hammas`}
          />
        </div>

        {/* Paid vs Outstanding donut */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-sm font-semibold text-ink mb-3">Tasutud vs ootel</p>
            {stats.totalRevenue > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Makstud', value: stats.paidRevenue },
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
                    <span className="text-ink-muted">Makstud: </span>
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
          <div className="card p-4">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bar chart: jobs per material */}
          <div className="card p-4">
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
          <div className="card p-4">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* WIP by stage */}
          <div className="card p-4">
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
          <div className="card p-4">
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
          <StatCard
            icon={Zap}
            label="Kiirtööd"
            value={stats.kiirtooJobs.length}
            sub={`${stats.kiirtooRevenue.toFixed(2)} € käive`}
            accent="#F97316"
          />
          <StatCard
            icon={Timer}
            label="Ø läbiaeg"
            value={stats.avgTurnaround > 0 ? `${stats.avgTurnaround.toFixed(1)} p` : '—'}
            sub="kuupäevast valmiseni"
            accent="#8B5CF6"
          />
          {stats.machineStats.slice(0, 2).map((m) => (
            <StatCard
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top patients */}
          <div className="card p-4">
            <p className="text-sm font-semibold text-ink mb-3">Top patsiendid (hambad)</p>
            {stats.topPatients.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={stats.topPatients}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 80, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={78} />
                  <Tooltip formatter={(v: number) => [v, 'Hambad']} />
                  <Bar dataKey="count" fill="#6366F1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>

          {/* Teeth by work type */}
          <div className="card p-4">
            <p className="text-sm font-semibold text-ink mb-0.5">Hambad töötüübi järgi</p>
            <p className="text-xs text-ink-faint mb-3">Kokku toodetud hambad töö liigi kaupa</p>
            {stats.teethByWorkType.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={stats.teethByWorkType}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 70, bottom: 0 }}
                >
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={68} />
                  <Tooltip />
                  <Bar dataKey="teeth" radius={[0, 4, 4, 0]}>
                    {stats.teethByWorkType.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-faint text-center py-6">Andmed puuduvad</p>
            )}
          </div>
        </div>
      </section>

      {/* ─── Tooth analysis ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <TrendingUp size={13} /> Hammaste analüüs
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Weakest teeth */}
          <div className="card p-4">
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
          <div className="card p-4">
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

      <div className="h-4" /> {/* bottom spacer */}

      {/* ─── Visiidid ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Visiidid
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={CalendarClock}
            label="Visiite kokku"
            value={stats.visitStats.total}
            sub={`${stats.visitStats.planeeritud} planeeritud · ${stats.visitStats.toimunud} toimunud`}
          />
          <StatCard
            icon={UserX}
            label="Ei tulnud"
            value={`${stats.visitStats.noShowRate.toFixed(0)}%`}
            sub={`${stats.visitStats.eiTulnud} visiiti · tühistamised välja arvatud`}
          />
          <StatCard
            icon={Timer}
            label="Ø visiidi kestus"
            value={`${stats.visitStats.avgKestus.toFixed(0)} min`}
          />
          <StatCard
            icon={AlertCircle}
            label="Tühistatud"
            value={stats.visitStats.tuhistatud}
            sub="ette teatatud"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
          <div className="card p-4">
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

          <div className="card p-4">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
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

          <div className="card p-4">
            <p className="text-sm font-semibold text-ink">Käive töö liigi järgi</p>
            <p className="text-[11px] text-ink-muted mb-3">Sama liigitus, mida kalender kasutab</p>
            {stats.byWorkType.length === 0 ? (
              <p className="text-sm text-ink-muted">Andmed puuduvad.</p>
            ) : (
              <div className="space-y-1.5">
                {stats.byWorkType.slice(0, 8).map(t => (
                  <div key={t.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: workTypeHex(t.name) }} />
                    <span className="text-ink-muted truncate flex-1">{t.name}</span>
                    <span className="text-ink-faint tabular-nums">{t.count}×</span>
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
          <StatCard icon={Users} label="Patsiente kokku" value={stats.patientSummary.total} />
          <StatCard
            icon={UserPlus} label="Uusi patsiente" value={stats.patientSummary.newPatients}
            sub="valitud perioodil lisatud"
          />
          <StatCard
            icon={Repeat} label="Korduvad patsiendid" value={stats.patientSummary.repeatPatients}
            sub={`${stats.patientSummary.repeatRate.toFixed(0)}% neist, kellel on töid`}
          />
          <StatCard
            icon={Stethoscope} label="Suunavaid arste" value={stats.byDoctor.length}
            sub="käibe järgi top 8"
          />
        </div>
      </section>
    </div>
  )
}
