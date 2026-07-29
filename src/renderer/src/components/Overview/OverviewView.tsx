import { useMemo } from 'react'
import { format, isBefore, isToday, parseISO } from 'date-fns'
import { et } from 'date-fns/locale'
import {
  Plus, Layers, AlertTriangle, TrendingUp, Euro, CalendarClock,
  Kanban, Users, Table2, BarChart2, CheckCircle2, ArrowRight
} from 'lucide-react'
import type { Job } from '../../types/job'
import type { ViewMode } from '../../types/view'
import { useDashboardStats } from '../Dashboard/useDashboardStats'
import { usePipeline } from '../../context/PipelineContext'
import { DeadlineChip } from '../ui/DeadlineChip'

// Same tile shape as Dashboard.tsx's StatCard, minus the breakdown slot which
// only Statistika needs. Not imported — that one is local to Dashboard.tsx.
function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  accent?: string
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
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  sub,
  onClick
}: {
  icon: React.ElementType
  label: string
  sub: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="card p-4 flex items-center gap-3 text-left hover:shadow-card-hover transition-shadow"
    >
      <div className="w-8 h-8 rounded-lg bg-accent-light flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-accent-dark" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink truncate">{label}</p>
        <p className="text-[11px] text-ink-muted truncate">{sub}</p>
      </div>
      <ArrowRight size={14} className="text-ink-faint ml-auto flex-shrink-0" />
    </button>
  )
}

// Estonian greetings are time-of-day specific; a single "Tere" reads flat.
function greeting(h: number): string {
  if (h < 11) return 'Tere hommikust'
  if (h < 18) return 'Tere päevast'
  return 'Tere õhtust'
}

const MAX_DEADLINES = 8

interface OverviewViewProps {
  jobs: Job[]
  loading: boolean
  onJobClick: (job: Job) => void
  onNewJob: () => void
  onNavigate: (v: ViewMode) => void
}

export function OverviewView({ jobs, loading, onJobClick, onNewJob, onNavigate }: OverviewViewProps) {
  const { stageMap, doneStageKey } = usePipeline()
  const stats = useDashboardStats(jobs, 'month')

  // Deadlines are computed over ALL jobs, not stats.overdue — that one is
  // period-filtered to this month, so a job that ran over its deadline in June
  // would silently disappear from the list that exists to surface exactly it.
  const { overdue, dueToday } = useMemo(() => {
    const now = new Date()
    const open = jobs.filter(j => j.valmis_aeg && j.status !== doneStageKey)
    const byDeadline = (a: Job, b: Job) => a.valmis_aeg!.localeCompare(b.valmis_aeg!)
    return {
      overdue: open.filter(j => isBefore(parseISO(j.valmis_aeg!), now)).sort(byDeadline),
      dueToday: open.filter(j => !isBefore(parseISO(j.valmis_aeg!), now) && isToday(parseISO(j.valmis_aeg!))).sort(byDeadline)
    }
  }, [jobs, doneStageKey])

  // Overdue first — they are the ones that need a decision today.
  const deadlines = [...overdue, ...dueToday]

  const now = new Date()
  const rawDate = format(now, 'EEEE, d. MMMM yyyy', { locale: et })
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      {/* ─── Greeting ─── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-ink">{greeting(now.getHours())}</h2>
          <p className="text-sm text-ink-muted">{dateLabel}</p>
        </div>
        <button onClick={onNewJob} className="btn-primary">
          <Plus size={14} />
          Uus töö
        </button>
      </div>

      {/* ─── Stat strip ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Sel kuul
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={Layers}
            label="Tootmises"
            value={stats.inProduction.length}
            sub={`${stats.filtered.length} tööd sel kuul`}
          />
          <StatTile
            icon={AlertTriangle}
            label="Tähtajast üle"
            value={overdue.length}
            sub={`${dueToday.length} tähtaeg täna`}
            accent="#F59E0B"
          />
          <StatTile
            icon={TrendingUp}
            label="Hambaid toodetud"
            value={stats.totalTeeth}
            sub={`Ø ${stats.avgTeethPerJob.toFixed(1)} / töö`}
            accent="#10B981"
          />
          <StatTile
            icon={Euro}
            label="Maksmata"
            value={`${stats.unpaidRevenue.toFixed(2)} €`}
            sub={`${stats.totalRevenue.toFixed(2)} € käive`}
            accent="#EF4444"
          />
        </div>
      </section>

      {/* ─── Deadlines ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3 flex items-center gap-2">
          <CalendarClock size={13} /> Tähtajad
        </h3>
        <div className="card p-4">
          {loading ? (
            <p className="text-sm text-ink-muted">Laen…</p>
          ) : deadlines.length === 0 ? (
            <div className="flex items-center gap-2 py-2">
              <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
              <p className="text-sm text-ink-muted">Ühelgi pooleliolval tööl pole tähtaeg käes.</p>
            </div>
          ) : (
            <>
              {/* own wrapper so `last:border-b-0` lands on the last row and not
                  on the "veel N tööd" button below it */}
              <div>
                {deadlines.slice(0, MAX_DEADLINES).map(j => (
                  <button
                    key={j.id}
                    onClick={() => onJobClick(j)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left border-b border-ink-faint/10 last:border-b-0 hover:bg-bg-sidebar transition-colors duration-150"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink truncate">{j.patsient}</p>
                      <p className="text-[11px] text-ink-muted truncate">
                        {j.too ?? 'Määramata töö'}
                        {j.hambad && ` · ${j.hambad}`}
                      </p>
                    </div>
                    {/* stageMap lookup, not StatusPill — that returns null for a
                        stage the user has since removed from the pipeline. */}
                    <span className="text-[11px] font-medium text-ink-muted flex-shrink-0 hidden md:inline">
                      {stageMap[j.status]?.label ?? j.status}
                    </span>
                    <DeadlineChip deadline={j.valmis_aeg} compact />
                  </button>
                ))}
              </div>
              {deadlines.length > MAX_DEADLINES && (
                <button
                  onClick={() => onNavigate('table')}
                  className="btn-ghost w-full justify-center mt-2 text-xs"
                >
                  Veel {deadlines.length - MAX_DEADLINES} tööd — vaata tabelis
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* ─── Quick actions ─── */}
      <section>
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Kiirvalikud
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction
            icon={Kanban}
            label="Tööd"
            sub={`${stats.inProduction.length} tootmises`}
            onClick={() => onNavigate('board')}
          />
          <QuickAction
            icon={Users}
            label="Patsiendid"
            sub="Kaardid ja ajalugu"
            onClick={() => onNavigate('patients')}
          />
          <QuickAction
            icon={Table2}
            label="Tabel"
            sub="Kõik tööd nimekirjana"
            onClick={() => onNavigate('table')}
          />
          <QuickAction
            icon={BarChart2}
            label="Statistika"
            sub="Käive ja tootmine"
            onClick={() => onNavigate('stats')}
          />
        </div>
      </section>

      <div className="h-4" /> {/* bottom spacer */}
    </div>
  )
}
