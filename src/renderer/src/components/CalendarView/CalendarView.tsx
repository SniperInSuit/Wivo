import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Zap } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, parseISO, addMonths, subMonths, isPast
} from 'date-fns'
import { et } from 'date-fns/locale'
import type { Job } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'

const WEEKDAY_LABELS = ['E', 'T', 'K', 'N', 'R', 'L', 'P']

// Soft work-type colors — muted enough not to clash, distinct enough to separate at a glance
function getJobColor(too: string | null | undefined): string {
  if (!too) return 'bg-slate-100 text-slate-600'
  const t = too.toLowerCase()
  if (t.includes('kroon') || t.includes('crown'))   return 'bg-blue-100 text-blue-700'
  if (t.includes('sild')  || t.includes('bridge'))  return 'bg-violet-100 text-violet-700'
  if (t.includes('viniir')|| t.includes('veneer'))  return 'bg-emerald-100 text-emerald-700'
  if (t.includes('inlay'))                           return 'bg-amber-100 text-amber-700'
  if (t.includes('onlay'))                           return 'bg-orange-100 text-orange-700'
  if (t.includes('proteez')|| t.includes('denture'))return 'bg-rose-100 text-rose-700'
  if (t.includes('splint') || t.includes('splaad')) return 'bg-cyan-100 text-cyan-700'
  if (t.includes('ibt'))                             return 'bg-indigo-100 text-indigo-700'
  if (t.includes('kirur')  || t.includes('surgic')) return 'bg-teal-100 text-teal-700'
  if (t.includes('allon')  || t.includes('all-on')) return 'bg-pink-100 text-pink-700'
  if (t.includes('laminaat'))                        return 'bg-lime-100 text-lime-700'
  if (t.includes('täidis') || t.includes('taidis')) return 'bg-yellow-100 text-yellow-700'
  return 'bg-slate-100 text-slate-600'
}

interface CalendarViewProps {
  jobs: Job[]
  onJobClick: (job: Job) => void
  onRevisionClick: (job: Job, revisionId: string) => void
  onNewJobOnDate: (isoDatetime: string) => void
}

export function CalendarView({ jobs, onJobClick, onRevisionClick, onNewJobOnDate }: CalendarViewProps) {
  const { doneStageKey } = usePipeline()
  const [month, setMonth] = useState(() => new Date())

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(month)
    const monthEnd   = endOfMonth(month)
    const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calEnd     = endOfWeek(monthEnd,     { weekStartsOn: 1 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [month])

  // Index jobs by deadline — includes revision deadlines as separate entries
  const jobsByDate = useMemo(() => {
    const map = new Map<string, { job: Job; revId: string | null }[]>()

    function add(key: string, job: Job, revId: string | null) {
      if (!map.has(key)) map.set(key, [])
      // Avoid duplicate entry for same job+revId on same date
      if (!map.get(key)!.some(e => e.job.id === job.id && e.revId === revId)) {
        map.get(key)!.push({ job, revId })
      }
    }

    for (const job of jobs) {
      if (job.valmis_aeg) {
        add(format(parseISO(job.valmis_aeg), 'yyyy-MM-dd'), job, null)
      }
      for (const rev of job.revisions ?? []) {
        if (rev.deadline) {
          add(format(parseISO(rev.deadline), 'yyyy-MM-dd'), job, rev.id)
        }
      }
    }
    return map
  }, [jobs])

  // Split into week rows
  const weeks: Date[][] = []
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7))
  }

  // Capitalise first letter of Estonian month name
  const raw = format(month, 'MMMM yyyy', { locale: et })
  const monthLabel = raw.charAt(0).toUpperCase() + raw.slice(1)

  // Total scheduled this month
  const monthStart = startOfMonth(month)
  const monthEnd   = endOfMonth(month)
  const scheduledCount = jobs.filter(j => {
    if (!j.valmis_aeg) return false
    const d = parseISO(j.valmis_aeg)
    return d >= monthStart && d <= monthEnd
  }).length
  const unscheduledCount = jobs.filter(j => !j.valmis_aeg).length

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-faint/15 bg-bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => subMonths(m, 1))} className="btn-ghost p-2">
            <ChevronLeft size={15} />
          </button>
          <span className="text-base font-semibold text-ink w-44 text-center select-none">
            {monthLabel}
          </span>
          <button onClick={() => setMonth(m => addMonths(m, 1))} className="btn-ghost p-2">
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {scheduledCount > 0 && (
            <span className="text-xs text-ink-muted">
              <span className="font-semibold text-ink">{scheduledCount}</span> tööd selles kuus
            </span>
          )}
          {unscheduledCount > 0 && (
            <span className="text-xs text-ink-faint">
              {unscheduledCount} ilma tähtajata
            </span>
          )}
          <button
            onClick={() => setMonth(new Date())}
            className="text-xs font-medium text-ink-muted hover:text-ink px-3 py-1.5 rounded-lg bg-bg-sidebar transition-colors"
          >
            Täna
          </button>
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div className="flex-1 flex flex-col overflow-hidden px-4 py-3 min-h-0">

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-2 flex-shrink-0">
          {WEEKDAY_LABELS.map(d => (
            <div key={d} className="text-xs font-semibold text-ink-muted text-center py-1 select-none">
              {d}
            </div>
          ))}
        </div>

        {/* Week rows — fill remaining height equally */}
        <div
          className="flex-1 grid gap-1 min-h-0"
          style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1 min-h-0">
              {week.map(day => {
                const dateKey   = format(day, 'yyyy-MM-dd')
                const dayEntries = jobsByDate.get(dateKey) ?? []
                const inMonth    = isSameMonth(day, month)
                const today      = isToday(day)

                return (
                  <div
                    key={dateKey}
                    className={`group flex flex-col rounded-xl border overflow-hidden min-h-0 ${
                      today
                        ? 'border-accent bg-accent/[0.04]'
                        : inMonth
                          ? 'border-ink-faint/15 bg-bg-card'
                          : 'border-transparent bg-bg/30'
                    }`}
                  >
                    {/* Day number + add button */}
                    <div className="px-1.5 pt-1.5 pb-0.5 flex-shrink-0 flex items-center justify-between">
                      <span className={`text-[11px] font-bold inline-flex w-5 h-5 items-center justify-center rounded-full select-none ${
                        today
                          ? 'bg-accent text-white'
                          : inMonth
                            ? 'text-ink'
                            : 'text-ink-faint/40'
                      }`}>
                        {format(day, 'd')}
                      </span>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onNewJobOnDate(`${dateKey}T12:00`) }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 rounded flex items-center justify-center text-ink-faint hover:text-accent hover:bg-accent/10"
                        title={`Lisa töö ${format(day, 'd.MM.yyyy')}`}
                      >
                        <Plus size={11} />
                      </button>
                    </div>

                    {/* Job chips — scrollable when day has many entries */}
                    <div className="flex-1 px-1 pb-1 space-y-0.5 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-ink-faint/30">
                      {dayEntries.map(({ job, revId }) => {
                        const isRevision = revId !== null
                        const deadlineStr = isRevision
                          ? job.revisions.find(r => r.id === revId)?.deadline ?? null
                          : job.valmis_aeg
                        const overdue = !isRevision
                          ? job.status !== doneStageKey && isPast(parseISO(job.valmis_aeg!))
                          : deadlineStr ? isPast(parseISO(deadlineStr)) : false
                        const chipKey = isRevision ? `${job.id}-rev-${revId}` : job.id
                        return (
                          <button
                            key={chipKey}
                            type="button"
                            onClick={() => isRevision ? onRevisionClick(job, revId!) : onJobClick(job)}
                            title={`${isRevision ? '↩ Muudatus · ' : ''}${job.patsient}${job.too ? ` · ${job.too}` : ''}`}
                            className={`w-full text-left rounded text-[10px] leading-tight transition-opacity hover:opacity-75 overflow-hidden flex ${
                              overdue ? 'bg-red-100 text-red-700' : getJobColor(job.too)
                            }`}
                          >
                            {/* Dark navy left stripe for revision entries */}
                            {isRevision && (
                              <div className="w-1.5 bg-slate-700 flex-shrink-0" />
                            )}
                            <div className="flex-1 px-1.5 py-[3px] min-w-0">
                              <div className="font-semibold truncate flex items-center gap-0.5">
                                {job.kiirtoo && !isRevision && <Zap size={9} className="text-orange-500 flex-shrink-0" />}
                                {job.patsient}
                              </div>
                              <div className="opacity-60 truncate text-[9px]">
                                {isRevision ? '↩ muudatus' : job.too}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
