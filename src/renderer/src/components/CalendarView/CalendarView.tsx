import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Plus, Zap, User, Clock, Cpu, CalendarDays,
  CheckCircle2, AlertTriangle, X, UserCheck, UserX, ArrowUpRight, Filter, XCircle
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, parseISO, isValid, addMonths, subMonths,
  addWeeks, differenceInWeeks, differenceInMonths, isBefore, startOfDay
} from 'date-fns'
import { et } from 'date-fns/locale'
import type { LucideIcon } from 'lucide-react'
import type { Job } from '../../types/job'
import type { Visit, VisitStatus } from '../../types/visit'
import {
  VISIT_STATUS_LABEL, VISIT_STATUS_HEX, VISIT_STATUS_CLOSED,
  VISIT_ACTIONS, VISIT_ACTION_LABEL
} from '../../types/visit'
import { usePipeline } from '../../context/PipelineContext'
import { useVisits, useUpdateVisit } from '../../hooks/useVisits'
import { stageChipStyle } from '../../config/pipeline'
import { describeError } from '../Patients/errors'
import { workTypeHex, workTypeLabel, workTypesPresent } from '../../config/workTypes'
import { VisitTimeline } from './VisitTimeline'
import { VisitWeekGrid } from './VisitWeekGrid'
import { VisitForm } from './VisitForm'

const WEEKDAYS = ['Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev', 'Pühapäev']

type Mode = 'tood' | 'visiidid' | 'kombineeritud'

interface CalendarViewProps {
  jobs: Job[]
  onJobClick: (job: Job) => void
  onRevisionClick: (job: Job, revisionId: string) => void
  onNewJobOnDate: (isoDatetime: string) => void
  onOpenPatient?: (patientId: string) => void
}

export function CalendarView({ jobs, onJobClick, onNewJobOnDate, onOpenPatient }: CalendarViewProps) {
  const { stages, stageMap, doneStageKey } = usePipeline()
  const { data: visits = [], isError, error } = useVisits()
  const updateVisit = useUpdateVisit()

  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [mode, setMode] = useState<Mode>('kombineeritud')
  const [selected, setSelected] = useState<Date | null>(() => startOfDay(new Date()))
  const [timelineDay, setTimelineDay] = useState(() => startOfDay(new Date()))
  const [visitForm, setVisitForm] = useState<{ visit: Visit | null; date?: Date; durationMin?: number } | null>(null)
  // Month vs week. Only offered in Visiidid — the week grid is a visit schedule,
  // and the Kombineeritud view already answers "who is coming today" with the
  // horizontal rail.
  const [scale, setScale] = useState<'kuu' | 'nadal'>('kuu')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))

  // Ticks once a minute so the timeline's current-time indicator moves
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const showJobs = mode !== 'visiidid'
  const showVisits = mode !== 'tood'

  // ── Calendar filters ──────────────────────────────────────────────
  const [filterPatients, setFilterPatients] = useState<Set<string>>(new Set())
  const [filterWorkTypes, setFilterWorkTypes] = useState<Set<string>>(new Set())
  const [filterDoctors, setFilterDoctors] = useState<Set<string>>(new Set())
  const hasFilters = filterPatients.size > 0 || filterWorkTypes.size > 0 || filterDoctors.size > 0

  // Unique values for filter options
  const uniquePatients = useMemo(() =>
    [...new Set(jobs.map(j => j.patsient).filter(Boolean))].sort()
  , [jobs])
  const uniqueWorkTypes = useMemo(() =>
    [...new Set(jobs.map(j => j.too).filter(Boolean) as string[])].sort()
  , [jobs])
  const uniqueDoctors = useMemo(() =>
    [...new Set(visits.map(v => v.arst).filter(Boolean) as string[])].sort()
  , [visits])

  // Apply filters
  const filteredJobs = useMemo(() => {
    if (!hasFilters) return jobs
    return jobs.filter(j => {
      if (filterPatients.size > 0 && !filterPatients.has(j.patsient)) return false
      if (filterWorkTypes.size > 0 && !filterWorkTypes.has(j.too ?? '')) return false
      return true
    })
  }, [jobs, filterPatients, filterWorkTypes, hasFilters])

  const filteredVisits = useMemo(() => {
    if (!hasFilters) return visits
    return visits.filter(v => {
      if (filterPatients.size > 0 && !filterPatients.has(v.patsient)) return false
      if (filterDoctors.size > 0 && !filterDoctors.has(v.arst ?? '')) return false
      return true
    })
  }, [visits, filterPatients, filterDoctors, hasFilters])

  // Single-month days (used by header arrows to know which month is shown)
  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  }), [month])

  // Continuous strip: ±3 months of weeks for smooth scrolling
  const stripDays = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(addMonths(new Date(), -3)), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(addMonths(new Date(), 3)), { weekStartsOn: 1 })
  }), [])
  const stripWeeks = useMemo(() => {
    const weeks: Date[][] = []
    for (let i = 0; i < stripDays.length; i += 7) {
      weeks.push(stripDays.slice(i, i + 7))
    }
    return weeks
  }, [stripDays])

  // Scroll container ref + slider sync
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sliderValue, setSliderValue] = useState(50)
  const isSliderDragging = useRef(false)

  // Scroll the container to match slider position
  const syncScrollFromSlider = useCallback((pct: number) => {
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    el.scrollTop = (pct / 100) * maxScroll
  }, [])

  // Update slider when user scrolls naturally
  const handleCalendarScroll = useCallback(() => {
    if (isSliderDragging.current) return
    const el = scrollRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return
    setSliderValue((el.scrollTop / maxScroll) * 100)
  }, [])

  // On mount, scroll to "today" row
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const todayIdx = stripWeeks.findIndex(w => w.some(d => isToday(d)))
    if (todayIdx < 0) return
    const ROW_H = 124 // approximate row height
    el.scrollTop = todayIdx * ROW_H - el.clientHeight / 3
    handleCalendarScroll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Jobs are placed on their DEADLINE — that is the date the work matters on.
  const jobsByDay = useMemo(() => {
    const map = new Map<string, Job[]>()
    for (const j of filteredJobs) {
      const raw = j.valmis_aeg ?? j.kuupaev
      if (!raw) continue
      const d = parseISO(raw)
      if (!isValid(d)) continue
      const k = format(d, 'yyyy-MM-dd')
      map.set(k, [...(map.get(k) ?? []), j])
    }
    return map
  }, [filteredJobs])

  const visitsByDay = useMemo(() => {
    const map = new Map<string, Visit[]>()
    for (const v of filteredVisits) {
      const d = parseISO(v.algus)
      if (!isValid(d)) continue
      const k = format(d, 'yyyy-MM-dd')
      map.set(k, [...(map.get(k) ?? []), v])
    }
    for (const list of map.values()) list.sort((a, b) => a.algus.localeCompare(b.algus))
    return map
  }, [filteredVisits])

  // A visit's jobs are that patient's jobs — the two are linked through the
  // patient, not directly, so a cancelled visit never touches production.
  const jobsForVisit = (v: Visit): Job[] => {
    const key = v.patsient.trim().toLowerCase()
    return filteredJobs.filter(j =>
      (v.patient_id && j.patient_id === v.patient_id) ||
      (j.patsient ?? '').trim().toLowerCase() === key)
  }

  const weekMode = mode === 'visiidid' && scale === 'nadal'

  const [visitError, setVisitError] = useState<string | null>(null)

  // Drag-to-reschedule from the week grid. Keeps the duration, moves the start.
  async function moveVisit(v: Visit, newStart: Date) {
    setVisitError(null)
    try {
      await updateVisit.mutateAsync({ id: v.id, algus: newStart.toISOString() })
    } catch (err) {
      setVisitError(describeError(err))
    }
  }

  // One-click state change from the panel. Errors surface — a silently rejected
  // write here would look exactly like a dead button.
  async function setStatus(v: Visit, staatus: VisitStatus) {
    setVisitError(null)
    try {
      await updateVisit.mutateAsync({ id: v.id, staatus })
    } catch (err) {
      setVisitError(describeError(err))
    }
  }

  const isOverdue = (j: Job) => {
    if (!j.valmis_aeg || j.status === doneStageKey) return false
    const d = parseISO(j.valmis_aeg)
    return isValid(d) && isBefore(d, now)
  }

  // Legend lists only the work types visible in this month, not all rules
  const visibleTypes = useMemo(() => {
    if (!showJobs) return []
    const toos = days.flatMap(d => (jobsByDay.get(format(d, 'yyyy-MM-dd')) ?? []).map(j => j.too))
    return workTypesPresent(toos)
  }, [days, jobsByDay, showJobs])

  const selKey = selected ? format(selected, 'yyyy-MM-dd') : null
  const selVisits = selKey ? visitsByDay.get(selKey) ?? [] : []
  const selJobs = selKey ? jobsByDay.get(selKey) ?? [] : []

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ─── Header — full width above the content + sidebar ─────────── */}
      <div className="flex items-center gap-3 px-5 py-3 bg-nav-bg flex-shrink-0 flex-wrap">
          <h1 className="text-base font-bold text-nav">Kalender</h1>

          {/* View switcher */}
          <div className="flex items-center gap-1 bg-nav/10 rounded-xl p-1">
            {([
              { key: 'tood', label: 'Tööd' },
              { key: 'visiidid', label: 'Visiidid' },
              { key: 'kombineeritud', label: 'Kombineeritud' }
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mode === key ? 'bg-accent text-white' : 'text-nav hover:text-nav'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'visiidid' && (
            <div className="flex items-center gap-1 bg-nav/10 rounded-xl p-1">
              {([
                { key: 'kuu', label: 'Kuu' },
                { key: 'nadal', label: 'Nädal' }
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setScale(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    scale === key ? 'bg-bg-card text-ink shadow-card' : 'text-nav hover:text-nav'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => {
                const today = startOfDay(new Date())
                setMonth(startOfMonth(today)); setSelected(today); setTimelineDay(today)
                setWeekStart(startOfWeek(today, { weekStartsOn: 1 }))
              }}
              className="text-nav hover:text-nav font-medium px-3 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm border border-nav/30"
            >
              Täna
            </button>
            <button onClick={() => setMonth(m => subMonths(m, 1))} className="text-nav hover:text-nav p-2 rounded-lg transition-colors">
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-semibold text-nav min-w-[110px] text-center first-letter:uppercase">
              {format(month, 'LLLL yyyy', { locale: et })}
            </span>
            <button onClick={() => setMonth(m => addMonths(m, 1))} className="text-nav hover:text-nav p-2 rounded-lg transition-colors">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

      {/* ─── Content row: scrollable left + right sidebar ──────────── */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden pl-5 pb-4 space-y-4 flex flex-col">
          {isError && (
            <div className="pr-5">
            <div className="card p-4 flex items-start gap-2">
              <AlertTriangle size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-ink">Visiitide tabelit ei leitud</p>
                <p className="text-xs text-ink-muted">
                  Käivita <code className="px-1 rounded bg-bg-sidebar">sql/007_visits.sql</code> ja{' '}
                  <code className="px-1 rounded bg-bg-sidebar">sql/008_visits_realtime.sql</code>{' '}
                  Supabase SQL-redaktoris. Tööde kalender töötab ka ilma selleta.
                </p>
                <p className="text-[10px] text-ink-faint mt-1">{(error as Error)?.message}</p>
              </div>
            </div>
            </div>
          )}

          {/* ─── Visit timeline ─────────────────────────────────────────── */}
          {showVisits && !isError && !weekMode && (
            <VisitTimeline
              visits={filteredVisits}
              jobsFor={jobsForVisit}
              day={timelineDay}
              now={now}
              onDayChange={d => { setTimelineDay(d); setSelected(d); setMonth(startOfMonth(d)) }}
              onVisitOpen={v => setVisitForm({ visit: v })}
              onOpenJobs={v => {
                const first = jobsForVisit(v)[0]
                if (first) onJobClick(first)
              }}
            />
          )}

          {/* ─── Filter bar ──────────────────────────────────────────────── */}
          <div className="pr-5 flex items-center gap-2 flex-wrap flex-shrink-0">
            <Filter size={13} className="text-nav-muted flex-shrink-0" />

            {/* Patient filter */}
            <FilterDropdown
              label="Patsient"
              options={uniquePatients}
              selected={filterPatients}
              onChange={setFilterPatients}
            />

            {/* Work type filter */}
            {showJobs && (
              <FilterDropdown
                label="Töö tüüp"
                options={uniqueWorkTypes}
                selected={filterWorkTypes}
                onChange={setFilterWorkTypes}
              />
            )}

            {/* Doctor filter */}
            {showVisits && uniqueDoctors.length > 0 && (
              <FilterDropdown
                label="Arst"
                options={uniqueDoctors}
                selected={filterDoctors}
                onChange={setFilterDoctors}
              />
            )}

            {hasFilters && (
              <button
                onClick={() => { setFilterPatients(new Set()); setFilterWorkTypes(new Set()); setFilterDoctors(new Set()) }}
                className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 font-medium transition-colors"
              >
                <XCircle size={12} />
                Tühjenda
              </button>
            )}
          </div>

          {/* ─── Week grid (Visiidid only) ──────────────────────────────── */}
          {weekMode && !isError && (
            <div className="pr-5">
            <VisitWeekGrid
              visits={filteredVisits}
              weekStart={weekStart}
              now={now}
              onWeekChange={setWeekStart}
              selected={selected}
              onDaySelect={d => { setSelected(d); setMonth(startOfMonth(d)) }}
              onVisitOpen={v => setVisitForm({ visit: v })}
              onSlotClick={(start, dur) => setVisitForm({ visit: null, date: start, durationMin: dur })}
              onMove={moveVisit}
            />
            </div>
          )}

          {/* ─── Continuous scrollable calendar grid ──────────────────────── */}
          {!weekMode && (
          <div className="pr-5 flex-1 min-h-0 flex flex-col">
          <div className="rounded-xl overflow-hidden bg-ink-faint/10 p-[3px] flex flex-col flex-1 min-h-0">
            {/* Sticky weekday headers */}
            <div className="grid grid-cols-7 gap-[3px] mb-[3px] flex-shrink-0">
              {WEEKDAYS.map(d => (
                <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold text-nav/80">
                  {d}
                </div>
              ))}
            </div>

            {/* Scrollable week rows */}
            <div
              ref={scrollRef}
              onScroll={handleCalendarScroll}
              className="overflow-y-auto flex-1 min-h-0"
            >
              {stripWeeks.map((week, wi) => {
                // Month label on the first week that contains the 1st of a month
                const firstOfMonth = week.find(d => d.getDate() === 1)
                return (
                  <div key={wi}>
                    {firstOfMonth && (
                      <div className="px-2 py-1.5 text-[11px] font-bold text-nav/80 uppercase tracking-wider first-letter:uppercase">
                        {format(firstOfMonth, 'LLLL yyyy', { locale: et })}
                      </div>
                    )}
                    <div className="grid grid-cols-7 gap-[3px] mb-[3px]">
                      {week.map(day => {
                        const key = format(day, 'yyyy-MM-dd')
                        const dayJobs = showJobs ? jobsByDay.get(key) ?? [] : []
                        const dayVisits = showVisits ? visitsByDay.get(key) ?? [] : []
                        const isSel = selected != null && isSameDay(day, selected)

                        return (
                          <div
                            key={key}
                            onClick={() => { setSelected(day); setTimelineDay(day); setMonth(startOfMonth(day)) }}
                            className={`group relative min-h-[118px] rounded-lg p-1.5 cursor-pointer transition-colors bg-bg-card hover:bg-bg-sidebar/80 ${
                              isSel ? 'ring-2 ring-inset ring-accent' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-xs font-semibold tabular-nums ${
                                isToday(day)
                                  ? 'bg-accent text-white rounded-md px-1.5'
                                  : 'text-ink'
                              }`}>
                                {format(day, 'd')}
                                {day.getDate() === 1 && <span className="text-ink-muted font-normal">.{format(day, 'MM')}</span>}
                              </span>
                              <span className="flex items-center gap-1.5 text-[10px] text-ink-faint tabular-nums">
                                {showVisits && <span className="flex items-center gap-0.5"><User size={9} />{dayVisits.length}</span>}
                                {showJobs && <span className="flex items-center gap-0.5"><Zap size={9} />{dayJobs.length}</span>}
                              </span>
                            </div>

                            <div className="space-y-1">
                              {dayVisits.slice(0, 2).map(v => {
                                const d = parseISO(v.algus)
                                const cancelled = v.staatus === 'tuhistatud'
                                return (
                                  <div
                                    key={v.id}
                                    onDoubleClick={e => { e.stopPropagation(); setVisitForm({ visit: v }) }}
                                    title={`${v.patsient}${v.arst ? ` · ${v.arst}` : ''} · ${v.kestus_min} min · ${VISIT_STATUS_LABEL[v.staatus]}`}
                                    className={`rounded-md px-1.5 py-0.5 border-l-2 bg-bg-sidebar ${
                                      cancelled ? 'line-through opacity-70' : ''
                                    }`}
                                    style={{ borderLeftColor: VISIT_STATUS_HEX[v.staatus] }}
                                  >
                                    <p className="text-[10px] font-semibold text-ink truncate tabular-nums">
                                      {isValid(d) ? format(d, 'HH:mm') : '—'} {v.patsient}
                                    </p>
                                  </div>
                                )
                              })}
                              {dayVisits.length > 2 && (
                                <p className="text-[9px] text-ink-faint pl-1">+{dayVisits.length - 2} visiit(i)</p>
                              )}

                              {dayVisits.length > 0 && dayJobs.length > 0 && (
                                <div className="border-t border-dashed border-ink-faint/25 my-1" />
                              )}

                              {dayJobs.slice(0, 3).map(j => {
                                const late = isOverdue(j)
                                const st = stageMap[j.status]
                                return (
                                  <div
                                    key={j.id}
                                    onDoubleClick={e => { e.stopPropagation(); onJobClick(j) }}
                                    title={`${j.too ?? 'Määramata'} (${workTypeLabel(j.too)}) · ${j.patsient} · ${st?.label ?? j.status}`}
                                    className="rounded-md px-1.5 py-0.5 border-l-[3px]"
                                    style={{
                                      backgroundColor: `${workTypeHex(j.too)}1f`,
                                      borderLeftColor: late ? '#EF4444' : st?.hex ?? '#A8B4BE'
                                    }}
                                  >
                                    <p className="text-[10px] font-semibold text-ink truncate">
                                      {j.too ?? 'Määramata'}
                                    </p>
                                    <p className="text-[9px] text-ink-muted truncate">
                                      {j.patsient}{late && ' · üle tähtaja'}
                                    </p>
                                  </div>
                                )
                              })}
                              {dayJobs.length > 3 && (
                                <p className="text-[9px] text-ink-faint pl-1">+{dayJobs.length - 3} tööd</p>
                              )}

                              {dayVisits.length === 0 && dayJobs.length === 0 && (
                                <>
                                  <p className="text-[9px] text-ink-faint/70 group-hover:hidden pl-1">
                                    0 visiiti · 0 tööd
                                  </p>
                                  <div className="hidden group-hover:flex flex-col gap-0.5">
                                    <button
                                      onClick={e => { e.stopPropagation(); setVisitForm({ visit: null, date: day }) }}
                                      className="text-[10px] text-accent-dark font-semibold hover:underline text-left pl-1"
                                    >
                                      + Lisa visiit
                                    </button>
                                    <button
                                      onClick={e => {
                                        e.stopPropagation()
                                        onNewJobOnDate(format(day, "yyyy-MM-dd'T'09:00"))
                                      }}
                                      className="text-[10px] text-accent-dark font-semibold hover:underline text-left pl-1"
                                    >
                                      + Lisa töö
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </div>

          )}

          {/* ─── Legend: one row per channel ────────────────────────────── */}
          <div className="pr-5 space-y-1.5 px-1 flex-shrink-0 pt-2">
            {weekMode ? (
              // Week grid shows visits only, so the stage/type key would explain
              // nothing that is on screen
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-[10px] font-semibold text-nav-muted uppercase tracking-wider w-[86px]">
                  Visiidi seis
                </span>
                {(Object.keys(VISIT_STATUS_LABEL) as VisitStatus[]).map(st => (
                  <span key={st} className="flex items-center gap-1.5 text-[10px] text-nav">
                    <span className="w-0.5 h-3 rounded-sm" style={{ backgroundColor: VISIT_STATUS_HEX[st] }} />
                    {VISIT_STATUS_LABEL[st]}
                  </span>
                ))}
              </div>
            ) : (
            <><div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-[10px] font-semibold text-nav-muted uppercase tracking-wider w-[86px]">
                Serv = etapp
              </span>
              {stages.map(s => (
                <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-nav">
                  <span className="w-0.5 h-3 rounded-sm" style={{ backgroundColor: s.hex }} />
                  {s.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-[10px] text-nav">
                <span className="w-0.5 h-3 rounded-sm bg-red-500" />
                Tähtaeg möödas
              </span>
            </div>
            {visibleTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-[10px] font-semibold text-nav-muted uppercase tracking-wider w-[86px]">
                  Täidis = töö
                </span>
                {visibleTypes.map(t => (
                  <span key={t.label} className="flex items-center gap-1.5 text-[10px] text-nav">
                    <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: `${t.hex}1f`, boxShadow: `inset 0 0 0 1px ${t.hex}66` }} />
                    {t.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[10px] text-nav">
                  <span className="w-2.5 h-2.5 rounded bg-bg-sidebar ring-1 ring-inset ring-white/30" />
                  Visiit
                </span>
              </div>
            )}</>
            )}
          </div>
        </div>

        {/* ─── Right details panel ──────────────────────────────────────────── */}
      <aside className="w-[320px] flex-shrink-0 border-l border-ink-faint/15 bg-bg-card overflow-y-auto">
        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-2">
            <CalendarDays size={30} className="text-ink-faint" />
            <p className="text-sm text-ink-muted">Vali kalendrist päev</p>
            <p className="text-xs text-ink-faint">
              Näed selle päeva visiidid, tööd ja kokkuvõtte.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] text-ink-muted first-letter:uppercase">
                  {format(selected, 'EEEE', { locale: et })}
                </p>
                <h2 className="text-lg font-bold text-ink">
                  {format(selected, 'd. MMMM yyyy', { locale: et })}
                </h2>
              </div>
              <button onClick={() => setSelected(null)} className="btn-ghost p-1.5" title="Sulge">
                <X size={14} />
              </button>
            </div>

            {/* Visits */}
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                <User size={11} /> Visiidid ({selVisits.length})
              </h3>
              {visitError && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                  {visitError}
                </p>
              )}
              {selVisits.length === 0 ? (
                <p className="text-xs text-ink-faint">Visiite ei ole.</p>
              ) : selVisits.map(v => {
                const d = parseISO(v.algus)
                const vJobs = jobsForVisit(v)
                return (
                  <div
                    key={v.id}
                    onDoubleClick={() => setVisitForm({ visit: v })}
                    className={`rounded-xl border p-3 space-y-1 ${
                      v.staatus === 'tuhistatud'
                        ? 'border-red-200 bg-red-50'
                        : v.staatus === 'saabunud'
                          ? 'border-accent'
                          : 'border-ink-faint/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-ink tabular-nums">
                        {isValid(d) ? format(d, 'HH:mm') : '—'}
                      </p>
                      <span
                        className="text-[10px] font-medium rounded-full px-1.5 py-0.5 flex-shrink-0"
                        style={stageChipStyle(VISIT_STATUS_HEX[v.staatus])}
                      >
                        {VISIT_STATUS_LABEL[v.staatus]}
                      </span>
                    </div>
                    {v.arst?.trim() && <p className="text-sm font-semibold text-ink">{v.arst}</p>}
                    <p className="text-xs text-ink-muted">
                      {vJobs.length} {vJobs.length === 1 ? 'töö' : 'tööd'} · {v.kestus_min} min
                    </p>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <User size={10} className="text-ink-faint flex-shrink-0" />
                      <span className="text-xs text-ink-soft truncate">{v.patsient}</span>
                      {v.patient_id && onOpenPatient && (
                        <button
                          onClick={() => onOpenPatient(v.patient_id!)}
                          title="Ava patsiendi profiil"
                          className="text-accent hover:underline flex-shrink-0"
                        >
                          <ArrowUpRight size={11} />
                        </button>
                      )}
                    </div>
                    {v.markus?.trim() && <p className="text-[11px] text-ink-muted">{v.markus}</p>}
                    {/* Contextual one-click state changes — a visit that already
                        happened is not offered "did not come". */}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {VISIT_ACTIONS[v.staatus].map(next => (
                        <button
                          key={next}
                          onClick={() => setStatus(v, next)}
                          disabled={updateVisit.isPending}
                          className="text-[11px] font-medium rounded-lg px-2 py-1 border transition-colors disabled:opacity-40"
                          style={{
                            color: VISIT_STATUS_HEX[next],
                            borderColor: `${VISIT_STATUS_HEX[next]}59`
                          }}
                        >
                          {VISIT_ACTION_LABEL[next]}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { const f = vJobs[0]; if (f) onJobClick(f) }}
                      disabled={vJobs.length === 0}
                      className="w-full mt-1 text-xs font-medium text-accent border border-accent/30 rounded-lg py-1.5 hover:bg-accent/10 transition-colors disabled:opacity-40"
                    >
                      Vaata töödele
                    </button>
                  </div>
                )
              })}
            </section>

            {/* Jobs */}
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                <Zap size={11} /> Tööd ({selJobs.length})
              </h3>
              {selJobs.length === 0 ? (
                <p className="text-xs text-ink-faint">Töid ei ole.</p>
              ) : selJobs.map(j => {
                const st = stageMap[j.status]
                const late = isOverdue(j)
                return (
                  <button
                    key={j.id}
                    onDoubleClick={() => onJobClick(j)}
                    onClick={() => onJobClick(j)}
                    className="w-full text-left rounded-xl border border-ink-faint/20 p-3 space-y-1 hover:border-accent/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-ink truncate">
                        <span
                          className="w-2 h-2 rounded flex-shrink-0"
                          style={{ backgroundColor: workTypeHex(j.too) }}
                          title={workTypeLabel(j.too)}
                        />
                        {j.too ?? 'Määramata töö'}
                      </p>
                      <span
                        className="text-[10px] font-medium rounded-full px-1.5 py-0.5 flex-shrink-0"
                        style={stageChipStyle(late ? '#EF4444' : st?.hex ?? '#A8B4BE')}
                      >
                        {late ? 'Üle tähtaja' : st?.label ?? j.status}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted truncate">{j.patsient}</p>
                    <div className="flex items-center justify-between text-[11px] text-ink-faint">
                      <span className="flex items-center gap-1 truncate">
                        <Cpu size={10} />{j.masina ?? '—'}
                      </span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        <Clock size={10} />
                        {j.valmis_aeg && isValid(parseISO(j.valmis_aeg))
                          ? format(parseISO(j.valmis_aeg), 'dd.MM HH:mm')
                          : '—'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </section>

            {/* Day summary */}
            <section className="space-y-1.5 pt-1 border-t border-ink-faint/15">
              <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider pt-2">
                Päeva kokkuvõte
              </h3>
              <Summary icon={User} label="Visiite" value={selVisits.length} />
              <Summary
                icon={UserCheck} label="Saabunud / üle antud" tone="text-emerald-600"
                value={selVisits.filter(v => v.staatus === 'saabunud' || v.staatus === 'toimunud').length}
              />
              <Summary
                icon={UserX} label="Ei tulnud" tone="text-amber-600"
                value={selVisits.filter(v => v.staatus === 'ei_tulnud').length}
              />
              <Summary icon={Zap} label="Töid" value={selJobs.length} />
              <Summary
                icon={CheckCircle2} label="Valmis" tone="text-emerald-600"
                value={selJobs.filter(j => j.status === doneStageKey).length}
              />
              <Summary
                icon={AlertTriangle} label="Üle tähtaja" tone="text-red-600"
                value={selJobs.filter(isOverdue).length}
              />
            </section>

            {/* Actions */}
            <section className="space-y-2 pt-1">
              <button
                onClick={() => setVisitForm({ visit: null, date: selected })}
                className="w-full btn-ghost justify-center border border-ink-faint/25"
              >
                <Plus size={14} /> Lisa visiit
              </button>
              <button
                onClick={() => onNewJobOnDate(format(selected, "yyyy-MM-dd'T'09:00"))}
                className="w-full btn-ghost justify-center border border-ink-faint/25"
              >
                <Plus size={14} /> Lisa töö
              </button>
            </section>
          </div>
        )}
      </aside>
      </div>

      <AnimatePresence>
        {visitForm && (
          <VisitForm
            key={visitForm.visit?.id ?? 'new'}
            visit={visitForm.visit}
            initialDate={visitForm.date}
            initialDuration={visitForm.durationMin}
            onClose={() => setVisitForm(null)}
            onOpenPatient={onOpenPatient}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Filter dropdown ──────────────────────────────────────────────────────────

function FilterDropdown({ label, options, selected, onChange }: {
  label: string
  options: string[]
  selected: Set<string>
  onChange: (v: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (item: string) => {
    const next = new Set(selected)
    next.has(item) ? next.delete(item) : next.add(item)
    onChange(next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
          selected.size > 0
            ? 'bg-accent/15 text-accent border-accent/30'
            : 'bg-bg-card text-ink-muted border-ink-faint/20 hover:border-ink-faint/40'
        }`}
      >
        {label}
        {selected.size > 0 && (
          <span className="bg-accent text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">
            {selected.size}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-bg-card border border-ink-faint/20 rounded-xl shadow-panel w-56 max-h-64 overflow-y-auto py-1">
          {options.length === 0 ? (
            <p className="text-xs text-ink-faint px-3 py-2">Andmed puuduvad</p>
          ) : options.map(opt => (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                selected.has(opt) ? 'bg-accent/10 text-accent font-medium' : 'text-ink-muted hover:bg-bg-sidebar'
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                selected.has(opt) ? 'bg-accent border-accent' : 'border-ink-faint'
              }`}>
                {selected.has(opt) && <CheckCircle2 size={8} className="text-white" />}
              </span>
              <span className="truncate">{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Summary({ icon: Icon, label, value, tone }: {
  icon: LucideIcon
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon size={11} className={tone ?? 'text-ink-faint'} />
      <span className="text-ink-muted">{label}</span>
      <span className="ml-auto font-semibold text-ink tabular-nums">{value}</span>
    </div>
  )
}
