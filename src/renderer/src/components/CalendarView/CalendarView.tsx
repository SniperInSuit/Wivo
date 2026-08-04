import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Plus, Zap, User, Clock, Cpu, CalendarDays,
  CheckCircle2, AlertTriangle, X, UserCheck, UserX, ArrowUpRight, Filter, XCircle,
  CornerDownLeft
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameDay, isToday, parseISO, isValid, addMonths, isBefore, startOfDay
} from 'date-fns'
import { et } from 'date-fns/locale'
import type { LucideIcon } from 'lucide-react'
import type { Job, Revision } from '../../types/job'
import { revisionReasonLabel } from '../../types/job'
import type { Visit, VisitStatus } from '../../types/visit'
import {
  VISIT_STATUS_LABEL, VISIT_STATUS_HEX, VISIT_STATUS_CLOSED,
  VISIT_ACTIONS, VISIT_ACTION_LABEL
} from '../../types/visit'
import { usePipeline } from '../../context/PipelineContext'
import { useWorkTypes } from '../../stores/useSettings'
import { UNKNOWN_WORK_TYPE } from '../../config/workTypes'
import { useVisits, useUpdateVisit } from '../../hooks/useVisits'
import { stageChipStyle } from '../../config/pipeline'
import { describeError } from '../Patients/errors'
import { MultiFilterMenu } from '../ui/FilterMenu'
import { VisitTimeline } from './VisitTimeline'
import { VisitWeekGrid } from './VisitWeekGrid'
import { VisitForm } from './VisitForm'

const WEEKDAYS = ['Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev', 'Pühapäev']

export type CalendarMode = 'tood' | 'visiidid' | 'kombineeritud'
export type CalendarScale = 'kuu' | 'nadal'

// A calendar cell holds two kinds of work: the original job and each of its
// revisions. A revision carries its own deadline and its own pipeline stage, so
// it is a separate dated item — not a detail of the row it hangs off.
type CalEntry =
  | { type: 'job'; job: Job }
  | { type: 'rev'; job: Job; rev: Revision; revNum: number }

const entryKey = (e: CalEntry) =>
  e.type === 'rev' ? `rev-${e.job.id}-${e.rev.id}` : `job-${e.job.id}`

interface CalendarViewProps {
  jobs: Job[]
  onJobClick: (job: Job) => void
  onRevisionClick: (job: Job, revisionId: string) => void
  onNewJobOnDate: (isoDatetime: string) => void
  onOpenPatient?: (patientId: string) => void
  // Mode, scale and "jump to today" are driven from the TopBar (see
  // CalendarTopControls), so they are lifted rather than owned here.
  mode: CalendarMode
  scale: CalendarScale
  /** Increments when Täna is pressed; the value itself carries no meaning. */
  todaySignal: number
  /** Increments when "Uus visiit" is pressed in TopBar */
  newVisitSignal?: number
}

export function CalendarView({
  jobs, onJobClick, onRevisionClick, onNewJobOnDate, onOpenPatient,
  mode, scale, todaySignal, newVisitSignal,
}: CalendarViewProps) {
  const { stages, stageMap, doneStageKey } = usePipeline()
  const wt = useWorkTypes()
  const { data: visits = [], isError, error } = useVisits()
  const updateVisit = useUpdateVisit()

  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const [selected, setSelected] = useState<Date | null>(() => startOfDay(new Date()))
  const [timelineDay, setTimelineDay] = useState(() => startOfDay(new Date()))
  const [visitForm, setVisitForm] = useState<{ visit: Visit | null; date?: Date; durationMin?: number } | null>(null)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))

  // Open new visit form when TopBar "Uus visiit" is clicked
  useEffect(() => {
    if (newVisitSignal) setVisitForm({ visit: null })
  }, [newVisitSignal])

  // Ticks once a minute so the timeline's current-time indicator moves
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Täna, pressed in the TopBar. Skips the first run so opening the calendar
  // does not fight with the mount-time scroll to today.
  const firstToday = useRef(true)
  useEffect(() => {
    if (firstToday.current) { firstToday.current = false; return }
    const today = startOfDay(new Date())
    setMonth(startOfMonth(today)); setSelected(today); setTimelineDay(today)
    setWeekStart(startOfWeek(today, { weekStartsOn: 1 }))
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-day="${format(today, 'yyyy-MM-dd')}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [todaySignal])

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
  // Work-type filter options are the CONFIGURED types (Seaded → Valikud), not
  // the raw `too` strings on the jobs. `too` is free text, so deriving options
  // from it listed one-off spellings — "D14 abutmendile kroon", "all-on5" —
  // as if they were categories, and the same real type appeared several times
  // under different names. Filtering matches on the resolved type instead, so
  // picking "Implantkroon" catches every way someone wrote it.
  const uniqueWorkTypes = useMemo(() => {
    const names = wt.types.map(t => t.nimi)
    // Offered only when something actually falls outside the configured list —
    // otherwise it is a filter that can never match anything.
    const hasUnclassified = jobs.some(j => wt.label(j.too) === UNKNOWN_WORK_TYPE.nimi)
    return hasUnclassified ? [...names, UNKNOWN_WORK_TYPE.nimi] : names
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, wt.types])

  // Colour key for the filter list — same swatch as the calendar fill and the
  // legend, so the three cannot disagree about what a type looks like.
  const workTypeSwatches = useMemo(() => {
    const map: Record<string, string> = { [UNKNOWN_WORK_TYPE.nimi]: UNKNOWN_WORK_TYPE.hex }
    for (const t of wt.types) map[t.nimi] = t.hex
    return map
  }, [wt.types])
  const uniqueDoctors = useMemo(() =>
    [...new Set(visits.map(v => v.arst).filter(Boolean) as string[])].sort()
  , [visits])

  // Apply filters
  const filteredJobs = useMemo(() => {
    if (!hasFilters) return jobs
    return jobs.filter(j => {
      if (filterPatients.size > 0 && !filterPatients.has(j.patsient)) return false
      // Resolved type, not the raw string — see uniqueWorkTypes above
      if (filterWorkTypes.size > 0 && !filterWorkTypes.has(wt.label(j.too))) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filterPatients, filterWorkTypes, hasFilters, wt.types])

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

  // Work is placed on its DEADLINE — that is the date it matters on. A revision
  // gets its own deadline, so it lands on its own day rather than inheriting the
  // original job's; without a deadline it falls back to the day it was logged.
  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalEntry[]>()
    const place = (raw: string | null | undefined, entry: CalEntry) => {
      if (!raw) return
      const d = parseISO(raw)
      if (!isValid(d)) return
      const k = format(d, 'yyyy-MM-dd')
      map.set(k, [...(map.get(k) ?? []), entry])
    }
    for (const j of filteredJobs) {
      place(j.valmis_aeg ?? j.kuupaev, { type: 'job', job: j })
      ;(j.revisions ?? []).forEach((rev, i) =>
        place(rev.deadline ?? rev.ts, { type: 'rev', job: j, rev, revNum: i + 1 }))
    }
    // Originals above their revisions inside a day
    for (const list of map.values()) {
      list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'job' ? -1 : 1))
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

  // A revision runs on its own stage, so "done" and "late" are answered per
  // entry — a finished original does not clear a revision that is still open.
  const entryStage = (e: CalEntry) =>
    e.type === 'job' ? e.job.status : e.rev.status ?? stages[0]?.key ?? ''
  const entryDeadline = (e: CalEntry) =>
    e.type === 'job' ? e.job.valmis_aeg : e.rev.deadline ?? null

  const isOverdue = (e: CalEntry) => {
    const dl = entryDeadline(e)
    if (!dl || entryStage(e) === doneStageKey) return false
    const d = parseISO(dl)
    return isValid(d) && isBefore(d, now)
  }

  const openEntry = (e: CalEntry) =>
    e.type === 'rev' ? onRevisionClick(e.job, e.rev.id) : onJobClick(e.job)

  // Legend lists only the work types visible in this month, not every configured
  // type. wt.types is in the deps because recolouring a type in Seaded has to
  // repaint this legend in the same render that repaints the cards.
  const visibleTypes = useMemo(() => {
    if (!showJobs) return []
    const toos = days.flatMap(d =>
      (entriesByDay.get(format(d, 'yyyy-MM-dd')) ?? []).map(e => e.job.too))
    return wt.present(toos)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, entriesByDay, showJobs, wt.types])

  // ── Filter match navigation ────────────────────────────────────────────────
  // A filtered calendar is mostly empty cells, and the matches are usually not
  // on the screen you are looking at. These are the days that survived the
  // filter, in date order, so the header can step through them.
  const matchDays = useMemo(() => {
    if (!hasFilters) return []
    const keys: string[] = []
    for (const d of stripDays) {
      const k = format(d, 'yyyy-MM-dd')
      const jobHit = showJobs && (entriesByDay.get(k)?.length ?? 0) > 0
      const visitHit = showVisits && (visitsByDay.get(k)?.length ?? 0) > 0
      if (jobHit || visitHit) keys.push(k)
    }
    return keys
  }, [hasFilters, stripDays, entriesByDay, visitsByDay, showJobs, showVisits])

  const matchSet = useMemo(() => new Set(matchDays), [matchDays])
  const [matchIdx, setMatchIdx] = useState(0)

  // Changing the filter invalidates the position, and an index left pointing
  // past the end of a shorter list would make the arrows look broken.
  useEffect(() => { setMatchIdx(0) }, [filterPatients, filterWorkTypes, filterDoctors])

  const jumpToMatch = useCallback((idx: number) => {
    const key = matchDays[idx]
    if (!key) return
    setMatchIdx(idx)
    const d = parseISO(key)
    if (!isValid(d)) return
    setSelected(d)
    setTimelineDay(d)
    setMonth(startOfMonth(d))
    // After the state above has painted — the target cell may not be mounted
    // in its final position until then.
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-day="${key}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [matchDays])

  const selKey = selected ? format(selected, 'yyyy-MM-dd') : null
  const selVisits = selKey ? visitsByDay.get(selKey) ?? [] : []
  const selEntries = selKey ? entriesByDay.get(selKey) ?? [] : []
  const selRevCount = selEntries.filter(e => e.type === 'rev').length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* The header row that used to live here — title, mode toggles, Täna and
          the month stepper — now sits in the TopBar (CalendarTopControls). It
          cost ~52px of grid height, and the scrolling strip already labels each
          month inline, so the stepper had nothing left to say. */}

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
            {/* Sticky weekday headers. The filter lives in the Monday cell as a
                popover rather than in its own row — a permanent filter bar cost
                ~44px of calendar height to show three buttons that are idle most
                of the time. */}
            <div className="grid grid-cols-7 gap-[3px] mb-[3px] flex-shrink-0">
              {WEEKDAYS.map((d, i) => (
                // Monday carries the filter controls, so it lays out as a row
                // rather than centring — an absolutely positioned control would
                // sit on top of the weekday name once the match counter appears.
                <div
                  key={d}
                  className={`px-2 py-2 text-[11px] font-semibold text-nav/80 flex items-center gap-1 ${
                    i === 0 ? 'justify-start' : 'justify-center'
                  }`}
                >
                  {i === 0 && (
                    <FilterPopover
                      hasFilters={hasFilters}
                      activeCount={filterPatients.size + filterWorkTypes.size + filterDoctors.size}
                      patients={uniquePatients}
                      workTypes={uniqueWorkTypes}
                      workTypeSwatches={workTypeSwatches}
                      doctors={uniqueDoctors}
                      showJobs={showJobs}
                      showVisits={showVisits}
                      filterPatients={filterPatients}
                      filterWorkTypes={filterWorkTypes}
                      filterDoctors={filterDoctors}
                      onPatients={setFilterPatients}
                      onWorkTypes={setFilterWorkTypes}
                      onDoctors={setFilterDoctors}
                      onClear={() => {
                        setFilterPatients(new Set()); setFilterWorkTypes(new Set()); setFilterDoctors(new Set())
                      }}
                    />
                  )}
                  {i === 0 && hasFilters && (
                    <MatchNav
                      count={matchDays.length}
                      index={matchIdx}
                      label={matchDays[matchIdx]
                        ? format(parseISO(matchDays[matchIdx]), 'd. MMM', { locale: et })
                        : null}
                      onStep={dir => {
                        if (matchDays.length === 0) return
                        const next = (matchIdx + dir + matchDays.length) % matchDays.length
                        jumpToMatch(next)
                      }}
                      onJump={() => jumpToMatch(matchIdx)}
                    />
                  )}
                  <span className="truncate">{d}</span>
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
                        const dayEntries = showJobs ? entriesByDay.get(key) ?? [] : []
                        const dayJobCount = dayEntries.filter(e => e.type === 'job').length
                        const dayRevCount = dayEntries.length - dayJobCount
                        const dayVisits = showVisits ? visitsByDay.get(key) ?? [] : []
                        const isSel = selected != null && isSameDay(day, selected)

                        const isMatch = matchSet.has(key)
                        const isCurrentMatch = hasFilters && matchDays[matchIdx] === key

                        return (
                          <div
                            key={key}
                            data-day={key}
                            onClick={() => { setSelected(day); setTimelineDay(day); setMonth(startOfMonth(day)) }}
                            className={`group relative min-h-[118px] rounded-lg p-1.5 cursor-pointer transition-colors bg-bg-card hover:bg-bg-sidebar/80 ${
                              isCurrentMatch ? 'ring-2 ring-inset ring-red-500'
                                : isSel ? 'ring-2 ring-inset ring-accent' : ''
                            }`}
                          >
                            {/* Marks a day the active filter matched, so the hits
                                are findable without reading every cell. */}
                            {isMatch && (
                              <span
                                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500"
                                title="Vastab filtrile"
                              />
                            )}
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
                                {showJobs && <span className="flex items-center gap-0.5"><Zap size={9} />{dayJobCount}</span>}
                                {showJobs && dayRevCount > 0 && (
                                  <span className="flex items-center gap-0.5" title={`${dayRevCount} muudatust`}>
                                    <CornerDownLeft size={9} />{dayRevCount}
                                  </span>
                                )}
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

                              {dayVisits.length > 0 && dayEntries.length > 0 && (
                                <div className="border-t border-dashed border-ink-faint/25 my-1" />
                              )}

                              {dayEntries.slice(0, 3).map(e => {
                                const late = isOverdue(e)
                                const st = stageMap[entryStage(e)]
                                const isRev = e.type === 'rev'
                                return (
                                  <div
                                    key={entryKey(e)}
                                    onDoubleClick={ev => { ev.stopPropagation(); openEntry(e) }}
                                    title={
                                      isRev
                                        ? `Muudatus #${e.revNum} · ${e.job.too ?? 'Määramata'} · ${e.job.patsient} · ${st?.label ?? entryStage(e)}${e.rev.note ? ` — ${e.rev.note}` : ''}`
                                        : `${e.job.too ?? 'Määramata'} (${wt.label(e.job.too)}) · ${e.job.patsient} · ${st?.label ?? entryStage(e)}`
                                    }
                                    className={`rounded-md px-1.5 py-0.5 border-l-[3px] ${
                                      isRev ? 'ring-1 ring-inset ring-slate-500/35' : ''
                                    }`}
                                    style={{
                                      backgroundColor: `${wt.hex(e.job.too)}1f`,
                                      borderLeftColor: late ? '#EF4444' : st?.hex ?? '#A8B4BE'
                                    }}
                                  >
                                    <p className="text-[10px] font-semibold text-ink truncate flex items-center gap-0.5">
                                      {isRev && <CornerDownLeft size={8} className="flex-shrink-0" />}
                                      {isRev ? `Muudatus #${e.revNum}` : e.job.too ?? 'Määramata'}
                                    </p>
                                    <p className="text-[9px] text-ink-muted truncate">
                                      {e.job.patsient}{late && ' · üle tähtaja'}
                                    </p>
                                  </div>
                                )
                              })}
                              {dayEntries.length > 3 && (
                                <p className="text-[9px] text-ink-faint pl-1">+{dayEntries.length - 3} veel</p>
                              )}

                              {dayVisits.length === 0 && dayEntries.length === 0 && (
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
                    {/* Solid, not the card's 12%-alpha fill: at that opacity on a
                        navy legend bar every swatch collapsed to the same dark
                        grey and the key stopped keying anything. */}
                    <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: t.hex }} />
                    {t.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[10px] text-nav">
                  <span className="w-2.5 h-2.5 rounded bg-bg-sidebar ring-1 ring-inset ring-white/30" />
                  Visiit
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-nav">
                  <CornerDownLeft size={10} />
                  Muudatus (oma tähtaeg)
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
                <Zap size={11} /> Tööd ({selEntries.length})
                {selRevCount > 0 && (
                  <span className="normal-case tracking-normal font-normal text-ink-faint">
                    · {selRevCount} muudatust
                  </span>
                )}
              </h3>
              {selEntries.length === 0 ? (
                <p className="text-xs text-ink-faint">Töid ei ole.</p>
              ) : selEntries.map(e => {
                const st = stageMap[entryStage(e)]
                const late = isOverdue(e)
                const isRev = e.type === 'rev'
                const deadline = entryDeadline(e)
                return (
                  <button
                    key={entryKey(e)}
                    onDoubleClick={() => openEntry(e)}
                    onClick={() => openEntry(e)}
                    className={`w-full text-left rounded-xl border p-3 space-y-1 hover:border-accent/40 transition-colors ${
                      isRev ? 'border-slate-400/40 border-l-[3px] border-l-slate-600' : 'border-ink-faint/20'
                    }`}
                  >
                    {isRev && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-100">
                        <CornerDownLeft size={9} />
                        Muudatus #{e.revNum}
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-ink truncate">
                        <span
                          className="w-2 h-2 rounded flex-shrink-0"
                          style={{ backgroundColor: wt.hex(e.job.too) }}
                          title={wt.label(e.job.too)}
                        />
                        {e.job.too ?? 'Määramata töö'}
                      </p>
                      <span
                        className="text-[10px] font-medium rounded-full px-1.5 py-0.5 flex-shrink-0"
                        style={stageChipStyle(late ? '#EF4444' : st?.hex ?? '#A8B4BE')}
                      >
                        {late ? 'Üle tähtaja' : st?.label ?? entryStage(e)}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted truncate">{e.job.patsient}</p>
                    {isRev && (revisionReasonLabel(e.rev) || e.rev.note?.trim()) && (
                      <p className="text-[11px] text-ink-muted italic line-clamp-2">
                        {[revisionReasonLabel(e.rev), e.rev.note?.trim()].filter(Boolean).join(' — ')}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-ink-faint">
                      <span className="flex items-center gap-1 truncate">
                        <Cpu size={10} />{e.job.masina ?? '—'}
                      </span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        <Clock size={10} />
                        {deadline && isValid(parseISO(deadline))
                          ? format(parseISO(deadline), 'dd.MM HH:mm')
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
              <Summary icon={Zap} label="Töid" value={selEntries.length - selRevCount} />
              <Summary icon={CornerDownLeft} label="Muudatusi" value={selRevCount} />
              <Summary
                icon={CheckCircle2} label="Valmis" tone="text-emerald-600"
                value={selEntries.filter(e => entryStage(e) === doneStageKey).length}
              />
              <Summary
                icon={AlertTriangle} label="Üle tähtaja" tone="text-red-600"
                value={selEntries.filter(isOverdue).length}
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

// ─── Filter match navigator ───────────────────────────────────────────────────
// Sits beside the filter icon in the Monday header. The calendar strip covers
// ±3 months, so a filter's hits are usually scrolled out of sight; this steps
// through them in date order and scrolls each one into view.
function MatchNav({ count, index, label, onStep, onJump }: {
  count: number
  index: number
  label: string | null
  onStep: (dir: 1 | -1) => void
  onJump: () => void
}) {
  if (count === 0) {
    return (
      <span
        className="text-[10px] font-medium text-nav-muted whitespace-nowrap flex-shrink-0"
        title="Ükski päev ei vasta filtrile"
      >
        0 vastet
      </span>
    )
  }

  return (
    <span className="flex items-center gap-0.5 flex-shrink-0">
      <button
        onClick={() => onStep(-1)}
        title="Eelmine vaste"
        className="p-0.5 rounded text-nav-muted hover:text-nav hover:bg-nav/10 transition-colors"
      >
        <ChevronLeft size={11} />
      </button>
      <button
        onClick={onJump}
        title={label ? `Mine: ${label} (${index + 1}/${count})` : undefined}
        className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-nav/10 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
        <span className="text-[10px] font-semibold text-nav tabular-nums whitespace-nowrap">
          {index + 1}/{count}
        </span>
      </button>
      <button
        onClick={() => onStep(1)}
        title="Järgmine vaste"
        className="p-0.5 rounded text-nav-muted hover:text-nav hover:bg-nav/10 transition-colors"
      >
        <ChevronRight size={11} />
      </button>
    </span>
  )
}

// ─── Filter popover ───────────────────────────────────────────────────────────
// Anchored in the Monday header cell. Everything the old filter bar showed is
// still here, just folded behind one icon so the grid keeps the height.
function FilterPopover({
  hasFilters, activeCount, patients, workTypes, workTypeSwatches, doctors, showJobs, showVisits,
  filterPatients, filterWorkTypes, filterDoctors,
  onPatients, onWorkTypes, onDoctors, onClear,
}: {
  hasFilters: boolean
  activeCount: number
  patients: string[]
  workTypes: string[]
  workTypeSwatches: Record<string, string>
  doctors: string[]
  showJobs: boolean
  showVisits: boolean
  filterPatients: Set<string>
  filterWorkTypes: Set<string>
  filterDoctors: Set<string>
  onPatients: (v: Set<string>) => void
  onWorkTypes: (v: Set<string>) => void
  onDoctors: (v: Set<string>) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0 z-30">
      <button
        onClick={() => setOpen(o => !o)}
        title={hasFilters ? `${activeCount} filtrit aktiivne` : 'Filtreeri'}
        className={`relative flex items-center justify-center w-6 h-6 rounded-md transition-colors ${
          hasFilters
            ? 'bg-accent text-white'
            : 'text-nav-muted hover:text-nav hover:bg-nav/10'
        }`}
      >
        <Filter size={12} />
        {hasFilters && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-3.5 h-3.5
            flex items-center justify-center text-[8px] font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-8 left-0 z-50 card p-3 w-[220px] space-y-2 text-left">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Filtreeri</p>
            <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink" title="Sulge">
              <X size={12} />
            </button>
          </div>

          <MultiFilterMenu
            label="Patsient" options={patients} selected={filterPatients} onChange={onPatients} full
          />
          {showJobs && (
            <MultiFilterMenu
              label="Töö tüüp" options={workTypes} selected={filterWorkTypes} onChange={onWorkTypes}
              swatches={workTypeSwatches} full
            />
          )}
          {showVisits && doctors.length > 0 && (
            <MultiFilterMenu
              label="Arst" options={doctors} selected={filterDoctors} onChange={onDoctors} full
            />
          )}

          {hasFilters && (
            <button
              onClick={onClear}
              className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-400 font-medium transition-colors pt-1"
            >
              <XCircle size={12} />
              Tühjenda kõik
            </button>
          )}
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
