import { useState, useMemo, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, Plus, Zap, User, Clock, Cpu, CalendarDays,
  CheckCircle2, AlertTriangle, X, UserCheck, UserX, ArrowUpRight
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, isToday, parseISO, isValid, addMonths, subMonths,
  isBefore, startOfDay
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
  const [visitForm, setVisitForm] = useState<{ visit: Visit | null; date?: Date } | null>(null)
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

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  }), [month])

  // Jobs are placed on their DEADLINE — that is the date the work matters on.
  const jobsByDay = useMemo(() => {
    const map = new Map<string, Job[]>()
    for (const j of jobs) {
      const raw = j.valmis_aeg ?? j.kuupaev
      if (!raw) continue
      const d = parseISO(raw)
      if (!isValid(d)) continue
      const k = format(d, 'yyyy-MM-dd')
      map.set(k, [...(map.get(k) ?? []), j])
    }
    return map
  }, [jobs])

  const visitsByDay = useMemo(() => {
    const map = new Map<string, Visit[]>()
    for (const v of visits) {
      const d = parseISO(v.algus)
      if (!isValid(d)) continue
      const k = format(d, 'yyyy-MM-dd')
      map.set(k, [...(map.get(k) ?? []), v])
    }
    for (const list of map.values()) list.sort((a, b) => a.algus.localeCompare(b.algus))
    return map
  }, [visits])

  // A visit's jobs are that patient's jobs — the two are linked through the
  // patient, not directly, so a cancelled visit never touches production.
  const jobsForVisit = (v: Visit): Job[] => {
    const key = v.patsient.trim().toLowerCase()
    return jobs.filter(j =>
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
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* ─── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-ink-faint/15 bg-bg-card flex-shrink-0 flex-wrap">
          <h1 className="text-base font-bold text-ink">Kalender</h1>

          {/* View switcher */}
          <div className="flex items-center gap-1 bg-bg-sidebar rounded-xl p-1">
            {([
              { key: 'tood', label: 'Tööd' },
              { key: 'visiidid', label: 'Visiidid' },
              { key: 'kombineeritud', label: 'Kombineeritud' }
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  mode === key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'visiidid' && (
            <div className="flex items-center gap-1 bg-bg-sidebar rounded-xl p-1">
              {([
                { key: 'kuu', label: 'Kuu' },
                { key: 'nadal', label: 'Nädal' }
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setScale(key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    scale === key ? 'bg-bg-card text-ink shadow-card' : 'text-ink-muted hover:text-ink'
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
              className="btn-ghost text-sm border border-ink-faint/25"
            >
              Täna
            </button>
            <button onClick={() => setMonth(m => subMonths(m, 1))} className="btn-ghost p-2">
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-semibold text-ink min-w-[110px] text-center first-letter:uppercase">
              {format(month, 'LLLL yyyy', { locale: et })}
            </span>
            <button onClick={() => setMonth(m => addMonths(m, 1))} className="btn-ghost p-2">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isError && (
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
          )}

          {/* ─── Visit timeline ─────────────────────────────────────────── */}
          {showVisits && !isError && !weekMode && (
            <VisitTimeline
              visits={visits}
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
            <VisitWeekGrid
              visits={visits}
              weekStart={weekStart}
              now={now}
              onWeekChange={setWeekStart}
              selected={selected}
              onDaySelect={d => { setSelected(d); setMonth(startOfMonth(d)) }}
              onVisitOpen={v => setVisitForm({ visit: v })}
              onSlotClick={start => setVisitForm({ visit: null, date: start })}
              onMove={moveVisit}
            />
          )}

          {/* ─── Month grid ─────────────────────────────────────────────── */}
          {!weekMode && (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-ink-faint/15">
              {WEEKDAYS.map(d => (
                <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold text-ink-muted">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map(day => {
                const key = format(day, 'yyyy-MM-dd')
                const dayJobs = showJobs ? jobsByDay.get(key) ?? [] : []
                const dayVisits = showVisits ? visitsByDay.get(key) ?? [] : []
                const outside = !isSameMonth(day, month)
                const isSel = selected != null && isSameDay(day, selected)

                return (
                  <div
                    key={key}
                    onClick={() => { setSelected(day); if (isSameMonth(day, month)) setTimelineDay(day) }}
                    className={`group relative min-h-[118px] border-b border-r border-ink-faint/10 p-1.5 cursor-pointer transition-colors ${
                      outside ? 'bg-bg/40' : 'hover:bg-bg-sidebar/50'
                    } ${isSel ? 'ring-2 ring-inset ring-accent' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold tabular-nums ${
                        isToday(day)
                          ? 'bg-accent text-white rounded-md px-1.5'
                          : outside ? 'text-ink-faint' : 'text-ink'
                      }`}>
                        {format(day, 'd')}
                      </span>
                      {/* Unobtrusive counters: visits and jobs */}
                      <span className="flex items-center gap-1.5 text-[10px] text-ink-faint tabular-nums">
                        {showVisits && <span className="flex items-center gap-0.5"><User size={9} />{dayVisits.length}</span>}
                        {showJobs && <span className="flex items-center gap-0.5"><Zap size={9} />{dayJobs.length}</span>}
                      </span>
                    </div>

                    {/* Visits always occupy the top section */}
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

                      {/* Divider only when both halves have content */}
                      {dayVisits.length > 0 && dayJobs.length > 0 && (
                        <div className="border-t border-dashed border-ink-faint/25 my-1" />
                      )}

                      {/* Production below, coloured BY STAGE */}
                      {dayJobs.slice(0, 3).map(j => {
                        const late = isOverdue(j)
                        const st = stageMap[j.status]
                        return (
                          <div
                            key={j.id}
                            onDoubleClick={e => { e.stopPropagation(); onJobClick(j) }}
                            title={`${j.too ?? 'Määramata'} (${workTypeLabel(j.too)}) · ${j.patsient} · ${st?.label ?? j.status}`}
                            className="rounded-md px-1.5 py-0.5 border-l-[3px]"
                            // Fill = work type (what kind of job), left edge =
                            // production stage (how far along). Two questions,
                            // two channels — overdue only overrides the edge, so
                            // the type stays readable.
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

                      {/* Empty day: quiet on rest, actionable on hover */}
                      {dayVisits.length === 0 && dayJobs.length === 0 && !outside && (
                        <>
                          <p className="text-[9px] text-ink-faint/70 group-hover:hidden pl-1">
                            0 visiiti · 0 tööd
                          </p>
                          <div className="hidden group-hover:flex flex-col gap-0.5">
                            <button
                              onClick={e => { e.stopPropagation(); setVisitForm({ visit: null, date: day }) }}
                              className="text-[10px] text-accent hover:underline text-left pl-1"
                            >
                              + Lisa visiit
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                onNewJobOnDate(format(day, "yyyy-MM-dd'T'09:00"))
                              }}
                              className="text-[10px] text-accent hover:underline text-left pl-1"
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

          )}

          {/* ─── Legend: one row per channel ────────────────────────────── */}
          <div className="space-y-1.5 px-1">
            {weekMode ? (
              // Week grid shows visits only, so the stage/type key would explain
              // nothing that is on screen
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider w-[86px]">
                  Visiidi seis
                </span>
                {(Object.keys(VISIT_STATUS_LABEL) as VisitStatus[]).map(st => (
                  <span key={st} className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                    <span className="w-0.5 h-3 rounded-sm" style={{ backgroundColor: VISIT_STATUS_HEX[st] }} />
                    {VISIT_STATUS_LABEL[st]}
                  </span>
                ))}
              </div>
            ) : (
            <><div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider w-[86px]">
                Serv = etapp
              </span>
              {stages.map(s => (
                <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                  <span className="w-0.5 h-3 rounded-sm" style={{ backgroundColor: s.hex }} />
                  {s.label}
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                <span className="w-0.5 h-3 rounded-sm bg-red-500" />
                Tähtaeg möödas
              </span>
            </div>
            {visibleTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider w-[86px]">
                  Täidis = töö
                </span>
                {visibleTypes.map(t => (
                  <span key={t.label} className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                    <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: `${t.hex}1f`, boxShadow: `inset 0 0 0 1px ${t.hex}66` }} />
                    {t.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                  <span className="w-2.5 h-2.5 rounded bg-bg-sidebar ring-1 ring-inset ring-ink-faint" />
                  Visiit
                </span>
              </div>
            )}</>
            )}
          </div>
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

      <AnimatePresence>
        {visitForm && (
          <VisitForm
            key={visitForm.visit?.id ?? 'new'}
            visit={visitForm.visit}
            initialDate={visitForm.date}
            onClose={() => setVisitForm(null)}
            onOpenPatient={onOpenPatient}
          />
        )}
      </AnimatePresence>
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
