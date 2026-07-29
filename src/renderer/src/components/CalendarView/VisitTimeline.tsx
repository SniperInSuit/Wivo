import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Stethoscope, User, X } from 'lucide-react'
import { format, parseISO, isValid, isSameDay, addDays } from 'date-fns'
import type { Job } from '../../types/job'
import type { Visit } from '../../types/visit'
import { useSettings } from '../../stores/useSettings'
import { VISIT_STATUS_HEX, VISIT_STATUS_LABEL } from '../../types/visit'

// Rail hours come from Seaded → Kalender; they used to be constants here.

interface VisitTimelineProps {
  visits: Visit[]
  jobsFor: (v: Visit) => Job[]
  day: Date
  now: Date
  onDayChange: (d: Date) => void
  onVisitOpen: (v: Visit) => void
  onOpenJobs: (v: Visit) => void
}

/**
 * Today's visits on a horizontal rail. One of Workly's signature elements — the
 * whole day readable in a single glance, no vertical calendar, no hour rows.
 */
export function VisitTimeline({
  visits, jobsFor, day, now, onDayChange, onVisitOpen, onOpenJobs
}: VisitTimelineProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const { settings } = useSettings()
  const START_HOUR = settings.ajajoonAlgus
  const END_HOUR = Math.max(settings.ajajoonAlgus + 1, settings.ajajoonLopp)
  const SPAN = (END_HOUR - START_HOUR) * 60
  const pct = (minutes: number) =>
    Math.min(100, Math.max(0, ((minutes - START_HOUR * 60) / SPAN) * 100))


  const dayVisits = visits
    .filter(v => {
      const d = parseISO(v.algus)
      return isValid(d) && isSameDay(d, day)
    })
    .sort((a, b) => a.algus.localeCompare(b.algus))

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const isToday = isSameDay(day, now)
  const showNow = isToday && nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  // "Current" = the visit whose window contains now; otherwise the next one up
  const currentId = isToday
    ? dayVisits.find(v => {
        const d = parseISO(v.algus)
        const start = d.getHours() * 60 + d.getMinutes()
        return nowMinutes >= start && nowMinutes < start + v.kestus_min
      })?.id ?? dayVisits.find(v => {
        const d = parseISO(v.algus)
        return d.getHours() * 60 + d.getMinutes() >= nowMinutes
      })?.id ?? null
    : null

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
          <User size={12} />
          {isToday ? 'Täna' : format(day, 'dd.MM')} — visiidid ({dayVisits.length})
        </h2>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onDayChange(addDays(day, -1))}
          className="w-7 h-7 rounded-full border border-ink-faint/25 flex items-center justify-center text-ink-muted hover:text-accent hover:border-accent/50 transition-colors flex-shrink-0"
          title="Eelmine päev"
        >
          <ChevronLeft size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="relative h-[126px]">
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

            {/* Rail, with the elapsed part in accent so the day reads as spent vs ahead */}
            <div className="absolute inset-x-0 top-[24px] h-[2px] bg-ink-faint/25 rounded-full" />
            {showNow && (
              <div
                className="absolute top-[24px] h-[2px] bg-accent rounded-full"
                style={{ left: 0, width: `${pct(nowMinutes)}%` }}
              />
            )}

            {/* Current-time indicator: label above, line crossing the rail and
                extending below it */}
            {showNow && (
              <div
                className="absolute top-0 bottom-0 -translate-x-1/2 pointer-events-none z-10"
                style={{ left: `${pct(nowMinutes)}%` }}
              >
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-white bg-accent rounded px-1.5 py-0.5 tabular-nums whitespace-nowrap">
                  {format(now, 'HH:mm')}
                </span>
                <span className="absolute top-[18px] bottom-1 left-1/2 -translate-x-1/2 w-[2px] bg-accent/70" />
              </div>
            )}

            {dayVisits.map((v, i) => {
              const d = parseISO(v.algus)
              const minutes = d.getHours() * 60 + d.getMinutes()
              const left = pct(minutes)
              const jobs = jobsFor(v)
              const cancelled = v.staatus === 'tuhistatud' || v.staatus === 'ei_tulnud'
              const done = v.staatus === 'toimunud'
                || (v.staatus === 'planeeritud' && isToday && nowMinutes >= minutes + v.kestus_min)
              // "Saabunud" always reads as the live one, whatever the clock says
              const isCurrent = v.staatus === 'saabunud'
                || (v.id === currentId && !cancelled && !done)
              const row = i % 2

              return (
                <div key={v.id}>
                  <span
                    className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 border-2 border-bg-card z-[5]"
                    style={{
                      left: `${left}%`,
                      top: '19px',
                      backgroundColor: VISIT_STATUS_HEX[v.staatus]
                    }}
                  />
                  <span
                    className="absolute w-[1px] bg-ink-faint/30"
                    style={{ left: `${left}%`, top: '29px', height: row === 0 ? '8px' : '34px' }}
                  />
                  <button
                    onMouseEnter={() => setOpenId(v.id)}
                    onMouseLeave={() => setOpenId(id => (id === v.id ? null : id))}
                    onDoubleClick={() => onVisitOpen(v)}
                    onClick={() => onVisitOpen(v)}
                    title="Ava visiit"
                    className={`absolute -translate-x-1/2 w-[146px] text-left rounded-xl border px-2.5 py-1.5 transition-all ${
                      v.staatus === 'ei_tulnud'
                        ? 'bg-amber-50 border-amber-200 hover:border-amber-300'
                        : cancelled
                        ? 'bg-red-50 border-red-200 hover:border-red-300'
                        : done
                          ? 'bg-bg-sidebar border-ink-faint/20 opacity-80 hover:opacity-100'
                          : isCurrent
                            ? 'bg-bg-card border-accent shadow-card'
                            : 'bg-bg-card border-ink-faint/25 hover:border-accent/50'
                    }`}
                    style={{ left: `${left}%`, top: row === 0 ? '39px' : '65px', zIndex: openId === v.id ? 30 : 6 }}
                  >
                    <span className="flex items-center gap-1 text-[10px] text-ink-muted tabular-nums">
                      <Clock size={9} />
                      {format(d, 'HH:mm')}
                      {done && !cancelled && <Check size={9} className="text-emerald-600" />}
                      {cancelled && <X size={9} style={{ color: VISIT_STATUS_HEX[v.staatus] }} />}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-ink truncate">
                      <Stethoscope size={10} className="text-ink-faint flex-shrink-0" />
                      <span className="truncate">{v.arst?.trim() || v.patsient}</span>
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {jobs.length} {jobs.length === 1 ? 'töö' : 'tööd'}
                    </span>

                    {/* Hover detail: patient, duration, and a way into the jobs */}
                    {openId === v.id && (
                      <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-[220px] card p-2.5 space-y-1.5 block text-left z-40">
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                          <User size={10} className="text-ink-faint" />
                          {v.patsient}
                        </span>
                        <span className="block text-[10px] text-ink-muted">
                          {format(d, 'HH:mm')}–{format(new Date(d.getTime() + v.kestus_min * 60000), 'HH:mm')}
                          {' · '}{v.kestus_min} min
                        </span>
                        <span
                          className="inline-block text-[9px] font-medium rounded-full px-1.5"
                          style={{
                            color: VISIT_STATUS_HEX[v.staatus],
                            backgroundColor: `${VISIT_STATUS_HEX[v.staatus]}1f`
                          }}
                        >
                          {VISIT_STATUS_LABEL[v.staatus]}
                        </span>
                        {v.markus?.trim() && (
                          <span className="block text-[10px] text-ink-soft">{v.markus}</span>
                        )}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={e => { e.stopPropagation(); onOpenJobs(v) }}
                          className="block text-[10px] font-medium text-accent hover:underline pt-0.5 border-t border-ink-faint/15"
                        >
                          Vaata tööde nimekirja ({jobs.length})
                        </span>
                      </span>
                    )}
                  </button>
                </div>
              )
            })}

            {dayVisits.length === 0 && (
              <p className="absolute inset-x-0 top-[52px] text-center text-sm text-ink-faint">
                Sellel päeval visiite ei ole.
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
