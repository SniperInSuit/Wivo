import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, User, Stethoscope } from 'lucide-react'
import { format, parseISO, isValid, isSameDay, addDays } from 'date-fns'
import { et } from 'date-fns/locale'
import type { Job } from '../../types/job'
import type { Patient } from '../../types/patient'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings } from '../../stores/useSettings'
import { stageChipStyle } from '../../config/pipeline'

// Rail hours come from Seaded → Kalender; they used to be constants here.

interface DayTimelineProps {
  jobs: Job[]
  patients: Patient[]
  day: Date
  onDayChange: (d: Date) => void
  now: Date
  onJobClick: (job: Job) => void
  onOpenCalendar: () => void
}

// A slot is one point on the rail: everything due at the same time for the same
// referring doctor. There is no appointment entity in Workly, so the rail is
// built from job DEADLINES (valmis_aeg) — the real, recorded times work is due.
interface Slot {
  key: string
  minutes: number      // minutes past midnight
  label: string        // HH:mm
  arst: string
  jobs: Job[]
  overdue: boolean     // past its deadline and not in the done stage
  done: boolean        // every job in the slot is finished
}

export function DayTimeline({
  jobs, patients, day, onDayChange, now, onJobClick, onOpenCalendar
}: DayTimelineProps) {
  const { stageMap, doneStageKey } = usePipeline()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const { settings } = useSettings()
  const START_HOUR = settings.ajajoonAlgus
  const END_HOUR = Math.max(settings.ajajoonAlgus + 1, settings.ajajoonLopp)
  const SPAN = (END_HOUR - START_HOUR) * 60
  const pct = (minutes: number) =>
    Math.min(100, Math.max(0, ((minutes - START_HOUR * 60) / SPAN) * 100))


  // patient name → referring doctor. Linked by id when the job has one, by name
  // otherwise (imported rows still have patient_id = null).
  const doctorOf = useMemo(() => {
    const byId = new Map(patients.map(p => [p.id, p]))
    const byName = new Map(patients.map(p => [p.nimi.trim().toLowerCase(), p]))
    return (job: Job): string => {
      const p = (job.patient_id ? byId.get(job.patient_id) : undefined)
        ?? byName.get((job.patsient ?? '').trim().toLowerCase())
      return p?.arst?.trim() || p?.kliinik?.trim() || 'Määramata arst'
    }
  }, [patients])

  const slots = useMemo<Slot[]>(() => {
    const map = new Map<string, Slot>()
    for (const j of jobs) {
      if (!j.valmis_aeg) continue
      const d = parseISO(j.valmis_aeg)
      if (!isValid(d) || !isSameDay(d, day)) continue
      const minutes = d.getHours() * 60 + d.getMinutes()
      const label = format(d, 'HH:mm')
      const arst = doctorOf(j)
      const key = `${label}|${arst}`
      const slot = map.get(key) ?? {
        key, minutes, label, arst, jobs: [], overdue: false, done: false
      }
      slot.jobs.push(j)
      map.set(key, slot)
    }
    return [...map.values()]
      .map(s => ({
        ...s,
        done: s.jobs.every(j => j.status === doneStageKey),
        overdue: s.minutes < now.getHours() * 60 + now.getMinutes()
          && isSameDay(day, now)
          && s.jobs.some(j => j.status !== doneStageKey)
      }))
      .sort((a, b) => a.minutes - b.minutes)
  }, [jobs, day, doctorOf, doneStageKey, now])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const showNow = isSameDay(day, now) && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  // The next slot still ahead of us — the one that reads as "current"
  const currentKey = isSameDay(day, now)
    ? slots.find(s => s.minutes >= nowMinutes)?.key ?? null
    : null

  const totalJobs = slots.reduce((n, s) => n + s.jobs.length, 0)

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            {isSameDay(day, now) ? 'Tänane plaan' : 'Päeva plaan'} — {format(day, 'd. MMMM yyyy', { locale: et })}
          </h2>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {totalJobs > 0
              ? `${slots.length} ajahetke · ${totalJobs} tööd tähtajaga sel päeval`
              : 'Sellel päeval ei ole ühtegi tähtaega'}
          </p>
        </div>
        <button onClick={onOpenCalendar} className="btn-ghost text-xs border border-ink-faint/25">
          Ava kalender
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onDayChange(addDays(day, -1))}
          className="w-7 h-7 rounded-full border border-ink-faint/25 flex items-center justify-center text-ink-muted hover:text-accent hover:border-accent/50 transition-colors flex-shrink-0"
          title="Eelmine päev"
        >
          <ChevronLeft size={14} />
        </button>

        {/* ─── The rail ───────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="relative h-[150px]">
            {/* Hour ticks */}
            <div className="absolute inset-x-0 top-0 h-4">
              {hours.map(h => (
                <span
                  key={h}
                  className="absolute -translate-x-1/2 text-[10px] text-ink-faint tabular-nums"
                  style={{ left: `${pct(h * 60)}%` }}
                >
                  {String(h).padStart(2, '0')}:00
                </span>
              ))}
            </div>

            {/* Rail: solid up to now, dotted after — the day reads as "spent" vs
                "ahead" without needing a legend. */}
            <div className="absolute inset-x-0 top-[26px] h-[2px] bg-ink-faint/25 rounded-full" />
            {showNow && (
              <div
                className="absolute top-[26px] h-[2px] bg-accent rounded-full"
                style={{ left: 0, width: `${pct(nowMinutes)}%` }}
              />
            )}

            {/* Current-time indicator: label, then a line through the rail that
                extends below it. */}
            {showNow && (
              <div
                className="absolute top-0 bottom-0 -translate-x-1/2 pointer-events-none z-10"
                style={{ left: `${pct(nowMinutes)}%` }}
              >
                <span className="absolute -top-[2px] left-1/2 -translate-x-1/2 text-[10px] font-semibold text-white bg-accent rounded px-1.5 py-0.5 tabular-nums whitespace-nowrap">
                  {format(now, 'HH:mm')}
                </span>
                <span className="absolute top-[20px] bottom-2 left-1/2 -translate-x-1/2 w-[2px] bg-accent/70" />
              </div>
            )}

            {/* Slot nodes + floating cards */}
            {slots.map((s, i) => {
              const isCurrent = s.key === currentKey
              const left = pct(s.minutes)
              // Alternate card rows so neighbouring times do not overlap
              const row = i % 2
              return (
                <div key={s.key}>
                  <span
                    className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 border-2 border-bg-card z-[5]"
                    style={{
                      left: `${left}%`,
                      top: '21px',
                      backgroundColor: s.overdue ? '#EF4444' : s.done ? '#A8B4BE' : 'rgb(var(--c-accent))'
                    }}
                  />
                  <span
                    className="absolute w-[1px] bg-ink-faint/30"
                    style={{ left: `${left}%`, top: '31px', height: row === 0 ? '10px' : '38px' }}
                  />
                  <button
                    onMouseEnter={() => setOpenKey(s.key)}
                    onMouseLeave={() => setOpenKey(k => (k === s.key ? null : k))}
                    onClick={() => s.jobs[0] && onJobClick(s.jobs[0])}
                    className={`absolute -translate-x-1/2 w-[150px] text-left rounded-xl border px-2.5 py-1.5 transition-all ${
                      s.overdue
                        ? 'bg-red-50 border-red-200 hover:border-red-300'
                        : s.done
                          ? 'bg-bg-sidebar border-ink-faint/20 opacity-80 hover:opacity-100'
                          : isCurrent
                            ? 'bg-bg-card border-accent shadow-card'
                            : 'bg-bg-card border-ink-faint/25 hover:border-accent/50'
                    }`}
                    style={{ left: `${left}%`, top: row === 0 ? '43px' : '71px', zIndex: openKey === s.key ? 30 : 6 }}
                  >
                    <span className="flex items-center gap-1 text-[10px] text-ink-muted tabular-nums">
                      <Clock size={9} />
                      {s.label}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-ink truncate">
                      <Stethoscope size={10} className="text-ink-faint flex-shrink-0" />
                      <span className="truncate">{s.arst}</span>
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {s.jobs.length} {s.jobs.length === 1 ? 'töö' : 'tööd'}
                    </span>

                    {/* Hover detail: who, what, which stage */}
                    {openKey === s.key && (
                      <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-[230px] card p-2.5 space-y-1.5 block text-left z-40">
                        {s.jobs.map(j => (
                          <span key={j.id} className="block">
                            <span className="flex items-center gap-1 text-[11px] font-medium text-ink">
                              <User size={9} className="text-ink-faint" />
                              {j.patsient}
                            </span>
                            <span className="flex items-center gap-1.5 pl-3.5">
                              <span className="text-[10px] text-ink-muted truncate">
                                {j.too ?? 'Määramata töö'}
                              </span>
                              <span
                                className="text-[9px] font-medium rounded-full px-1.5 flex-shrink-0"
                                // Live stage colour + label, so a recoloured or
                                // renamed stage reads correctly here too
                                style={stageChipStyle(stageMap[j.status]?.hex ?? '#A8B4BE')}
                              >
                                {stageMap[j.status]?.label ?? j.status}
                              </span>
                            </span>
                          </span>
                        ))}
                        <span className="block text-[10px] text-ink-faint pt-0.5 border-t border-ink-faint/15">
                          Klõpsa, et avada esimene töö
                        </span>
                      </span>
                    )}
                  </button>
                </div>
              )
            })}

            {slots.length === 0 && (
              <p className="absolute inset-x-0 top-[60px] text-center text-sm text-ink-faint">
                Ühtegi tähtaega sellel päeval.
              </p>
            )}
          </div>
        </div>

        <button
          onClick={() => onDayChange(addDays(day, 1))}
          className="w-7 h-7 rounded-full border border-ink-faint/25 flex items-center justify-center text-ink-muted hover:text-accent hover:border-accent/50 transition-colors flex-shrink-0"
          title="Järgmine päev"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </section>
  )
}
