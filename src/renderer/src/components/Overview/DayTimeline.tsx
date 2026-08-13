import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, User, Stethoscope } from 'lucide-react'
import { format, parseISO, isValid, isSameDay, addDays } from 'date-fns'
import { et } from 'date-fns/locale'
import type { Job } from '../../types/job'
import type { Patient } from '../../types/patient'
import type { Visit } from '../../types/visit'
import { VISIT_STATUS_LABEL, VISIT_STATUS_HEX } from '../../types/visit'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings, useWorkTypes, useVisitTypes } from '../../stores/useSettings'
import { stageChipStyle } from '../../config/pipeline'

// Rail hours come from Seaded → Kalender; they used to be constants here.

interface DayTimelineProps {
  jobs: Job[]
  patients: Patient[]
  /** Empty in WivoLab — a laboratory books no patients. */
  visits: Visit[]
  day: Date
  onDayChange: (d: Date) => void
  now: Date
  onJobClick: (job: Job) => void
  onOpenCalendar: () => void
}

// A slot is one point on the rail. Two kinds share it:
//
//   'job'   — a DEADLINE (valmis_aeg): when work is due off the bench.
//   'visit' — an APPOINTMENT (visits.algus): when a person is in the chair.
//
// They are deliberately not merged into one list of "events". A deadline that
// has passed with the work unfinished is a problem; an appointment that has
// passed is simply over. Colouring them the same would make the rail lie.
interface Slot {
  key: string
  kind: 'job' | 'visit'
  /** Work-type colour for a job, visit-type colour for a visit. */
  hex: string
  minutes: number      // minutes past midnight
  label: string        // HH:mm
  arst: string
  jobs: Job[]
  visit?: Visit
  overdue: boolean     // job only: past its deadline and not in the done stage
  done: boolean        // every job in the slot is finished
}

export function DayTimeline({
  jobs, patients, visits, day, onDayChange, now, onJobClick, onOpenCalendar
}: DayTimelineProps) {
  const { stageMap, doneStageKey } = usePipeline()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const { settings } = useSettings()
  const wt = useWorkTypes()
  const vt = useVisitTypes()
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
      const arst = `${j.patsient} · ${j.too ?? 'Määramata'}`
      const key = `job|${label}|${j.id}`
      const slot = map.get(key) ?? {
        key, kind: 'job' as const, hex: wt.hex(j.too), minutes, label, arst,
        jobs: [], overdue: false, done: false,
      }
      slot.jobs.push(j)
      map.set(key, slot)
    }

    // One node per visit, never grouped: two people in the chair at 10:00 is a
    // double-booking, and collapsing them into one node would hide it.
    for (const v of visits) {
      const d = parseISO(v.algus)
      if (!isValid(d) || !isSameDay(d, day)) continue
      const label = format(d, 'HH:mm')
      map.set(`visit|${v.id}`, {
        key: `visit|${v.id}`,
        kind: 'visit',
        hex: vt.hex(v.tyyp),
        minutes: d.getHours() * 60 + d.getMinutes(),
        label,
        arst: v.patsient || 'Nimeta',
        jobs: [],
        visit: v,
        overdue: false,
        done: v.staatus === 'toimunud' || v.staatus === 'tuhistatud',
      })
    }

    return [...map.values()]
      .map(s => s.kind === 'visit' ? s : {
        ...s,
        done: s.jobs.every(j => j.status === doneStageKey),
        overdue: s.minutes < now.getHours() * 60 + now.getMinutes()
          && isSameDay(day, now)
          && s.jobs.some(j => j.status !== doneStageKey)
      })
      .sort((a, b) => a.minutes - b.minutes)
  }, [jobs, visits, day, doctorOf, doneStageKey, now, wt, vt])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const showNow = isSameDay(day, now) && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  // The next slot still ahead of us — the one that reads as "current"
  const currentKey = isSameDay(day, now)
    ? slots.find(s => s.minutes >= nowMinutes)?.key ?? null
    : null

  const totalJobs = slots.reduce((n, s) => n + s.jobs.length, 0)
  const totalVisits = slots.filter(s => s.kind === 'visit').length

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            {isSameDay(day, now) ? 'Tänane plaan' : 'Päeva plaan'} — {format(day, 'd. MMMM yyyy', { locale: et })}
          </h2>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {totalJobs === 0 && totalVisits === 0
              ? 'Sellel päeval ei ole ühtegi tähtaega ega visiiti'
              : [
                  totalJobs > 0 ? `${totalJobs} tööd tähtajaga` : null,
                  totalVisits > 0 ? `${totalVisits} visiiti` : null,
                ].filter(Boolean).join(' · ')}
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
                      // The category colour — work type for a job, visit type
                      // for a visit — so the rail reads the same way the board
                      // and the calendar do. Overdue still overrides it: a
                      // missed deadline outranks knowing what kind of work it
                      // was. Finished things go grey and stop competing.
                      backgroundColor: s.overdue ? '#EF4444' : s.done ? '#A8B4BE' : s.hex
                    }}
                  />
                  <span
                    className="absolute w-[1px] bg-ink-faint/30"
                    style={{ left: `${left}%`, top: '31px', height: row === 0 ? '10px' : '38px' }}
                  />
                  <button
                    onMouseEnter={() => setOpenKey(s.key)}
                    onMouseLeave={() => setOpenKey(k => (k === s.key ? null : k))}
                    onClick={() => s.kind === 'visit' ? onOpenCalendar() : s.jobs[0] && onJobClick(s.jobs[0])}
                    className={`absolute -translate-x-1/2 w-[150px] text-left rounded-xl border border-l-4 pl-2 pr-2.5 py-1.5 transition-all hover:shadow-card ${
                      s.overdue
                        ? 'bg-red-50'
                        : s.done
                          ? 'bg-bg-sidebar opacity-75 hover:opacity-100'
                          : isCurrent
                            ? 'bg-bg-card shadow-card'
                            : 'bg-bg-card'
                    }`}
                    style={{
                      left: `${left}%`,
                      top: row === 0 ? '43px' : '71px',
                      zIndex: openKey === s.key ? 30 : 6,
                      // The thick left edge is the category. The thin rest of
                      // the border is state, so a card says "what" and "how is
                      // it going" without a legend.
                      borderLeftColor: s.overdue ? '#EF4444' : s.hex,
                      borderTopColor: s.overdue ? '#FECACA' : isCurrent ? 'rgb(var(--c-accent))' : `${s.hex}33`,
                      borderRightColor: s.overdue ? '#FECACA' : isCurrent ? 'rgb(var(--c-accent))' : `${s.hex}33`,
                      borderBottomColor: s.overdue ? '#FECACA' : isCurrent ? 'rgb(var(--c-accent))' : `${s.hex}33`,
                    }}
                  >
                    <span className="flex items-center gap-1 text-[10px] text-ink-muted tabular-nums">
                      <Clock size={9} />
                      {s.label}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-ink truncate">
                      {s.kind === 'visit'
                        ? <User size={10} className="text-ink-faint flex-shrink-0" />
                        : <Stethoscope size={10} className="text-ink-faint flex-shrink-0" />}
                      <span className="truncate">{s.arst}</span>
                    </span>
                    <span className="text-[10px] truncate" style={{ color: s.hex }}>
                      {s.kind === 'visit'
                        ? `${s.visit!.tyyp ?? 'Määramata'} · ${s.visit!.kestus_min} min`
                        : `${s.jobs.length} ${s.jobs.length === 1 ? 'töö' : 'tööd'}`}
                    </span>

                    {/* Hover detail: who, what, which stage */}
                    {openKey === s.key && s.kind === 'visit' && (
                      <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-[230px] card p-2.5 space-y-1.5 block text-left z-40">
                        <span className="flex items-center gap-1 text-[11px] font-medium text-ink">
                          <User size={9} className="text-ink-faint" />
                          {s.visit!.patsient || 'Nimeta'}
                        </span>
                        {s.visit!.arst?.trim() && (
                          <span className="flex items-center gap-1 text-[10px] text-ink-muted pl-3.5">
                            <Stethoscope size={9} className="text-ink-faint" />
                            {s.visit!.arst}
                          </span>
                        )}
                        <span className="block text-[10px] text-ink-muted pl-3.5">
                          <span className="font-medium" style={{ color: s.hex }}>
                            {s.visit!.tyyp ?? 'Määramata tüüp'}
                          </span>
                          {' · '}{s.label} · {s.visit!.kestus_min} min
                        </span>
                        <span className="block text-[10px] pl-3.5">
                          <span style={{ color: VISIT_STATUS_HEX[s.visit!.staatus] }}>
                            {VISIT_STATUS_LABEL[s.visit!.staatus]}
                          </span>
                        </span>
                        {s.visit!.markus?.trim() && (
                          <span className="block text-[10px] text-ink-faint pl-3.5">{s.visit!.markus}</span>
                        )}
                        <span className="block text-[10px] text-ink-faint pt-0.5 border-t border-ink-faint/15">
                          Klõpsa, et avada kalender
                        </span>
                      </span>
                    )}

                    {openKey === s.key && s.kind === 'job' && (
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
                Sellel päeval ei ole midagi.
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
