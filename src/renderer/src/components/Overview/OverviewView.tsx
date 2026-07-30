import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, ArrowUp, ArrowDown, Cpu, Euro, FileText, Activity, Clock,
  Package, Smile, CalendarCheck
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  format, parseISO, isValid, isSameDay, isBefore, subDays, isAfter, startOfDay
} from 'date-fns'
import { et } from 'date-fns/locale'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import type { Job } from '../../types/job'
import type { ViewMode } from '../../types/view'
import { usePipeline } from '../../context/PipelineContext'
import { usePatients } from '../../hooks/usePatients'
import { useSettings } from '../../stores/useSettings'
import { useAuth } from '../../context/AuthContext'
import { stageChipStyle } from '../../config/pipeline'
import { DayTimeline } from './DayTimeline'

interface OverviewViewProps {
  jobs: Job[]
  loading: boolean
  onJobClick: (job: Job) => void
  onNewJob: () => void
  onNavigate: (v: ViewMode) => void
}

const toothCount = (s: string | null | undefined) =>
  s ? s.split(',').filter(t => t.trim()).length : 0

const jobTotal = (j: Job) =>
  (j.hind ?? 0) + (j.revisions ?? []).reduce((s, r) => s + (r.price ?? 0), 0)

// Revision teeth, including the legacy rev_hambad field on imported rows
const revTeeth = (j: Job) => {
  const revs = j.revisions ?? []
  return revs.length === 0
    ? toothCount(j.rev_hambad)
    : revs.reduce((n, r) => n + toothCount(r.hambad), 0)
}

function greeting(h: number): string {
  if (h < 5) return 'Tere ööd'
  if (h < 11) return 'Tere hommikust'
  if (h < 17) return 'Tere päevast'
  return 'Tere õhtust'
}

export function OverviewView({ jobs, loading, onJobClick, onNewJob, onNavigate }: OverviewViewProps) {
  const { stages, stageMap, doneStageKey } = usePipeline()
  const { data: patients = [] } = usePatients()
  const { settings } = useSettings()

  // Ticks once a minute so the current-time indicator actually moves
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const [day, setDay] = useState(() => startOfDay(new Date()))

  const stats = useMemo(() => {
    const weekAgo = subDays(now, 7)
    const twoWeeks = subDays(now, 14)
    const inWindow = (j: Job, from: Date, to: Date) => {
      if (!j.kuupaev) return false
      const d = parseISO(j.kuupaev)
      return isValid(d) && isAfter(d, from) && !isAfter(d, to)
    }

    const thisWeek = jobs.filter(j => inWindow(j, weekAgo, now))
    const lastWeek = jobs.filter(j => inWindow(j, twoWeeks, weekAgo))
    const teethOf = (list: Job[]) =>
      list.reduce((n, j) => n + toothCount(j.hambad) + revTeeth(j), 0)

    const dueToday = jobs.filter(j => {
      if (!j.valmis_aeg || j.status === doneStageKey) return false
      const d = parseISO(j.valmis_aeg)
      return isValid(d) && isSameDay(d, now)
    })
    const overdue = jobs.filter(j => {
      if (!j.valmis_aeg || j.status === doneStageKey) return false
      const d = parseISO(j.valmis_aeg)
      return isValid(d) && isBefore(d, now) && !isSameDay(d, now)
    })
    const unpaid = jobs.filter(j => !j.makstud && jobTotal(j) > 0)

    return {
      total: jobs.length,
      totalDelta: thisWeek.length - lastWeek.length,
      dueToday,
      overdue,
      teeth: teethOf(jobs),
      teethDelta: teethOf(thisWeek) - teethOf(lastWeek),
      unpaidTotal: unpaid.reduce((s, j) => s + jobTotal(j), 0),
      unpaidCount: unpaid.length,
      wip: stages.map(s => ({
        name: s.label,
        hex: s.hex,
        count: jobs.filter(j => j.status === s.key).length
      })),
      inProduction: jobs.filter(j => j.status !== doneStageKey).length
    }
  }, [jobs, stages, doneStageKey, now])

  // Recent activity, derived from the timestamps we actually have. There is no
  // audit-log table, so this is every event that can be shown truthfully.
  const activity = useMemo(() => {
    type Item = { id: string; ts: string; text: string; icon: LucideIcon; job: Job }
    const items: Item[] = []
    for (const j of jobs) {
      for (const r of j.revisions ?? []) {
        items.push({
          id: `${j.id}:r:${r.id}`, ts: r.ts, job: j, icon: Activity,
          text: `Muudatus lisatud — ${j.too ?? j.patsient}`
        })
      }
      for (const n of j.markused ?? []) {
        items.push({
          id: `${j.id}:n:${n.id}`, ts: n.ts, job: j, icon: FileText,
          text: `Märkus lisatud — ${j.too ?? j.patsient}`
        })
      }
      items.push({
        id: `${j.id}:u`, ts: j.updated_at, job: j,
        icon: j.status === doneStageKey ? CalendarCheck : Clock,
        text: j.status === doneStageKey
          ? `${j.too ?? j.patsient} märgiti valmis`
          : `${j.too ?? j.patsient} — ${stageMap[j.status]?.label ?? j.status}`
      })
    }
    return items
      .filter(i => i.ts)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 6)
  }, [jobs, doneStageKey, stageMap])

  // Machine load — real counts of open jobs per printer. Wivo has no printer
  // connection, so there is no online state or resin level to report.
  const machines = useMemo(() => {
    const counts = new Map<string, number>()
    jobs.filter(j => j.status !== doneStageKey).forEach(j => {
      const m = j.masina?.trim()
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [jobs, doneStageKey])

  const { displayName } = useAuth()
  const name = displayName.split(/\s+/)[0]

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {/* ─── Greeting ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">
            {greeting(now.getHours())}{name ? `, ${name}` : ''}!
          </h1>
          <p className="text-sm text-ink-muted first-letter:uppercase">
            {format(now, 'EEEE, d. MMMM yyyy', { locale: et })}
          </p>
        </div>
      </div>

      {/* ─── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi
          label="Tööd kokku" value={String(stats.total)} icon={FileText}
          tint="bg-blue-50 text-blue-500"
          delta={stats.totalDelta} deltaLabel="võrreldes eelmise nädalaga"
        />
        <Kpi
          label="Tähtaeg täna" value={String(stats.dueToday.length)} icon={CalendarCheck}
          tint="bg-amber-50 text-amber-500"
          note={
            stats.overdue.length > 0
              ? `${stats.overdue.length} tööd on tähtaja ületanud`
              : stats.dueToday.length === 0
                ? 'Hea töö! Kõik tähtajad on täidetud.'
                : undefined
          }
          noteDanger={stats.overdue.length > 0}
        />
        <Kpi
          label="Hambaid toodetud" value={String(stats.teeth)} icon={Smile}
          tint="bg-emerald-50 text-emerald-500"
          delta={stats.teethDelta} deltaLabel="võrreldes eelmise nädalaga"
        />
        <Kpi
          label="Arveldamata" value={`${stats.unpaidTotal.toFixed(2)} €`} icon={Euro}
          tint="bg-rose-50 text-rose-500"
          note={`${stats.unpaidCount} tasumata ${stats.unpaidCount === 1 ? 'töö' : 'tööd'}`}
          noteDanger={stats.unpaidCount > 0}
        />
      </div>

      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <DayTimeline
        jobs={jobs}
        patients={patients}
        day={day}
        onDayChange={setDay}
        now={now}
        onJobClick={onJobClick}
        onOpenCalendar={() => onNavigate('calendar')}
      />

      {/* ─── Three cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <Panel title="TÖÖDE SEIS" onMore={() => onNavigate('board')} moreLabel="Vaata kõiki töid">
          {loading ? (
            <p className="text-sm text-ink-muted">Laen…</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-[130px] h-[130px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.wip.filter(w => w.count > 0)}
                      dataKey="count"
                      innerRadius={44}
                      outerRadius={62}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {stats.wip.filter(w => w.count > 0).map(w => (
                        <Cell key={w.name} fill={w.hex} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-ink leading-none">{stats.total}</span>
                  <span className="text-[10px] text-ink-muted">tööd</span>
                </div>
              </div>
              <ul className="flex-1 min-w-0 space-y-1">
                {stats.wip.map(w => (
                  <li key={w.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: w.hex }} />
                    <span className="text-ink-muted truncate">{w.name}</span>
                    <span className="ml-auto font-semibold text-ink tabular-nums">{w.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="TÄNA TÄHTSAD TÖÖD" onMore={() => onNavigate('table')} moreLabel="Vaata kõiki töid">
          {stats.dueToday.length === 0 && stats.overdue.length === 0 ? (
            <p className="text-sm text-ink-muted">Täna tähtajaga töid ei ole.</p>
          ) : (
            <ul className="space-y-2.5">
              {[...stats.overdue, ...stats.dueToday].slice(0, 4).map(j => {
                const d = j.valmis_aeg ? parseISO(j.valmis_aeg) : null
                const late = stats.overdue.includes(j)
                return (
                  <li key={j.id}>
                    <button
                      onClick={() => onJobClick(j)}
                      className="w-full text-left flex items-start gap-2 hover:bg-bg-sidebar rounded-lg -mx-1.5 px-1.5 py-1 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink truncate">{j.too ?? 'Määramata töö'}</p>
                        <p className="text-[11px] text-ink-muted truncate">
                          {j.patsient}{j.materjal && ` · ${j.materjal}`}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right space-y-0.5">
                        <span
                          className="text-[10px] font-medium rounded-full px-1.5 py-0.5 inline-block"
                          style={stageChipStyle(stageMap[j.status]?.hex ?? '#A8B4BE')}
                        >
                          {stageMap[j.status]?.label ?? j.status}
                        </span>
                        <p className={`text-[11px] font-semibold tabular-nums ${late ? 'text-red-600' : 'text-ink'}`}>
                          {d && isValid(d) ? format(d, 'HH:mm') : '—'}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title="VIIMASED TEGEVUSED" onMore={() => onNavigate('table')} moreLabel="Vaata kõiki töid">
          {activity.length === 0 ? (
            <p className="text-sm text-ink-muted">Tegevusi pole.</p>
          ) : (
            <ul className="space-y-2">
              {activity.map(({ id, ts, text, icon: Icon, job }) => {
                const d = ts ? parseISO(ts) : null
                return (
                  <li key={id}>
                    <button
                      onClick={() => onJobClick(job)}
                      className="w-full text-left flex items-center gap-2 hover:bg-bg-sidebar rounded-lg -mx-1.5 px-1.5 py-1 transition-colors"
                    >
                      <span className="w-6 h-6 rounded-full bg-bg-sidebar flex items-center justify-center flex-shrink-0">
                        <Icon size={11} className="text-accent" />
                      </span>
                      <span className="text-xs text-ink-soft truncate flex-1">{text}</span>
                      <span className="text-[10px] text-ink-faint flex-shrink-0 tabular-nums">
                        {d && isValid(d)
                          ? isSameDay(d, now) ? `Täna ${format(d, 'HH:mm')}` : format(d, 'dd.MM HH:mm')
                          : '—'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* ─── Bottom status bar ────────────────────────────────────────────── */}
      <div className="card px-5 py-3.5 grid grid-cols-2 md:grid-cols-4 gap-4 divide-x divide-ink-faint/15">
        <Status
          icon={Cpu} label="Masinad"
          value={machines.length > 0
            ? machines.map(([m, n]) => `${m} (${n})`).join(' · ')
            : 'Masinat pole määratud'}
          sub="pooleliolevad tööd masina kaupa"
        />
        <Status
          icon={Package} label="Materjalid"
          value={`${Object.keys(settings.materialPrices).length} materjali`}
          sub="hinnakirjas — Seaded → Hinnad"
        />
        <Status
          icon={Activity} label="Tootmises"
          value={`${stats.inProduction} tööd pooleli`}
          sub={`${stats.total - stats.inProduction} valmis`}
        />
        <Status
          icon={CalendarCheck} label="Tänased tähtajad"
          value={`${stats.dueToday.length} tööd`}
          sub={`Wivo v${__APP_VERSION__}`}
        />
      </div>
    </div>
  )
}

// ─── Small building blocks ─────────────────────────────────────────────────
function Kpi({ label, value, icon: Icon, tint, delta, deltaLabel, note, noteDanger }: {
  label: string
  value: string
  icon: LucideIcon
  tint: string
  delta?: number
  deltaLabel?: string
  note?: string
  noteDanger?: boolean
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tint}`}>
          <Icon size={15} />
        </span>
      </div>
      <p className="text-2xl font-bold text-ink leading-none mt-1.5">{value}</p>
      {delta !== undefined && deltaLabel && (
        <p className="flex items-center gap-1 text-[11px] mt-1.5">
          {delta === 0 ? (
            <span className="text-ink-faint truncate">Muutus puudub {deltaLabel}</span>
          ) : (
            <>
              {delta > 0
                ? <ArrowUp size={10} className="text-emerald-600 flex-shrink-0" />
                : <ArrowDown size={10} className="text-red-500 flex-shrink-0" />}
              <span className={`font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {Math.abs(delta)}
              </span>
              <span className="text-ink-faint truncate">{deltaLabel}</span>
            </>
          )}
        </p>
      )}
      {note && (
        <p className={`text-[11px] mt-1.5 ${noteDanger ? 'text-orange-600 font-medium' : 'text-ink-faint'}`}>
          {note}
        </p>
      )}
    </div>
  )
}

function Panel({ title, children, onMore, moreLabel }: {
  title: string
  children: React.ReactNode
  onMore?: () => void
  moreLabel?: string
}) {
  return (
    <section className="card p-4 flex flex-col h-full">
      <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">{title}</h3>
      <div className="flex-1">{children}</div>
      {onMore && (
        <button
          onClick={onMore}
          className="mt-3 pt-2.5 border-t border-ink-faint/15 flex items-center justify-end gap-1 text-[11px] font-medium text-accent hover:gap-1.5 transition-all"
        >
          {moreLabel}
          <ArrowRight size={11} />
        </button>
      )}
    </section>
  )
}

function Status({ icon: Icon, label, value, sub }: {
  icon: LucideIcon; label: string; value: string; sub: string
}) {
  return (
    <div className="flex items-start gap-2.5 px-1 first:pl-0 min-w-0">
      <Icon size={16} className="text-ink-faint flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-ink-muted uppercase tracking-wider">{label}</p>
        <p className="text-xs font-semibold text-ink truncate" title={value}>{value}</p>
        <p className="text-[10px] text-ink-faint truncate">{sub}</p>
      </div>
    </div>
  )
}
