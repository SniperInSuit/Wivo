import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Stethoscope, User, X } from 'lucide-react'
import { format, parseISO, isValid, isSameDay, addDays } from 'date-fns'
import type { Job } from '../../types/job'
import type { Visit } from '../../types/visit'
import { useSettings } from '../../stores/useSettings'
import { VISIT_STATUS_HEX, VISIT_STATUS_LABEL } from '../../types/visit'

interface VisitTimelineProps {
  visits: Visit[]
  jobsFor: (v: Visit) => Job[]
  day: Date
  now: Date
  onDayChange: (d: Date) => void
  onVisitOpen: (v: Visit) => void
  onOpenJobs: (v: Visit) => void
}

/*
 * Layout (top to bottom):
 *   0–14px   — current-time badge (floats above everything)
 *  18px      — hour tick dots + dotted stems going up to labels
 *  18–30px   — hour labels row
 *  34px      — the rail (horizontal line)
 *  38px+     — visit cards in two staggered rows
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

  // Vertical positions
  const LABEL_TOP = 6     // hour labels
  const RAIL_TOP = 28     // the main horizontal rail
  const DOT_TOP = RAIL_TOP - 3  // dots sit centred on the rail
  const STEM_TOP = LABEL_TOP + 14  // dotted stem from label down to rail
  const CARD_ROW_0 = 42   // first card row
  const CARD_ROW_1 = 68   // second (staggered) card row
  const TOTAL_H = 136

  return (
    <section className="card p-4 rounded-r-none">
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
          <div className="relative" style={{ height: TOTAL_H }}>

            {/* ── Hour labels + dots + dotted stems ───────────────── */}
            {hours.map(h => {
              const x = pct(h * 60)
              return (
                <div key={h} className="absolute -translate-x-1/2" style={{ left: `${x}%`, top: 0, bottom: 0 }}>
                  {/* Label */}
                  <span
                    className="absolute -translate-x-1/2 text-[10px] text-ink-faint tabular-nums whitespace-nowrap"
                    style={{ left: '50%', top: LABEL_TOP }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </span>
                  {/* Dotted stem from label to rail */}
                  <span
                    className="absolute left-1/2 -translate-x-1/2 border-l border-dashed border-ink-faint/30"
                    style={{ top: STEM_TOP, height: RAIL_TOP - STEM_TOP }}
                  />
                  {/* Dot on the rail */}
                  <span
                    className="absolute left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full bg-ink-faint/40"
                    style={{ top: DOT_TOP }}
                  />
                </div>
              )
            })}

            {/* ── Main rail ───────────────────────────────────────── */}
            <div
              className="absolute inset-x-0 h-[2px] bg-ink-faint/25 rounded-full"
              style={{ top: RAIL_TOP }}
            />
            {/* Elapsed portion */}
            {showNow && (
              <div
                className="absolute h-[2px] bg-accent rounded-full"
                style={{ top: RAIL_TOP, left: 0, width: `${pct(nowMinutes)}%` }}
              />
            )}

            {/* ── Visit start dots on the rail ────────────────────── */}
            {dayVisits.map(v => {
              const d = parseISO(v.algus)
              const startMin = d.getHours() * 60 + d.getMinutes()
              const endMin = startMin + v.kestus_min
              return (
                <div key={`dots-${v.id}`}>
                  {/* Start dot */}
                  <span
                    className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 border-2 border-bg-card z-[5]"
                    style={{
                      left: `${pct(startMin)}%`,
                      top: RAIL_TOP - 4,
                      backgroundColor: VISIT_STATUS_HEX[v.staatus]
                    }}
                  />
                  {/* End dot (smaller, hollow) */}
                  <span
                    className="absolute w-[7px] h-[7px] rounded-full -translate-x-1/2 border-[1.5px] bg-bg-card z-[4]"
                    style={{
                      left: `${pct(endMin)}%`,
                      top: RAIL_TOP - 2.5,
                      borderColor: VISIT_STATUS_HEX[v.staatus]
                    }}
                  />
                </div>
              )
            })}

            {/* ── Current-time indicator ──────────────────────────── */}
            {showNow && (
              <div
                className="absolute -translate-x-1/2 pointer-events-none z-10"
                style={{ left: `${pct(nowMinutes)}%`, top: 0, bottom: 0 }}
              >
                {/* Badge above everything */}
                <span
                  className="absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold text-white bg-accent rounded-md px-1.5 py-0.5 tabular-nums whitespace-nowrap"
                  style={{ top: -4 }}
                >
                  {format(now, 'HH:mm')}
                </span>
                {/* Vertical line from below badge to bottom */}
                <span
                  className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-accent/60"
                  style={{ top: LABEL_TOP + 12, bottom: 0 }}
                />
              </div>
            )}

            {/* ── Visit cards ─────────────────────────────────────── */}
            {dayVisits.map((v, i) => {
              const d = parseISO(v.algus)
              const minutes = d.getHours() * 60 + d.getMinutes()
              const left = pct(minutes)
              const jobs = jobsFor(v)
              const cancelled = v.staatus === 'tuhistatud' || v.staatus === 'ei_tulnud'
              const done = v.staatus === 'toimunud'
                || (v.staatus === 'planeeritud' && isToday && nowMinutes >= minutes + v.kestus_min)
              const isCurrent = v.staatus === 'saabunud'
                || (v.id === currentId && !cancelled && !done)
              // Client is late: past start time, not arrived, not done, not cancelled
              const isLate = isToday && nowMinutes > minutes + 5
                && v.staatus === 'planeeritud' && !done && !cancelled
              const row = i % 2

              return (
                <div key={v.id}>
                  {/* Connector line from rail down to card */}
                  <span
                    className="absolute w-[1px] bg-ink-faint/30"
                    style={{ left: `${left}%`, top: RAIL_TOP + 4, height: (row === 0 ? CARD_ROW_0 : CARD_ROW_1) - RAIL_TOP - 4 }}
                  />
                  <button
                    onMouseEnter={() => setOpenId(v.id)}
                    onMouseLeave={() => setOpenId(id => (id === v.id ? null : id))}
                    onDoubleClick={() => onVisitOpen(v)}
                    onClick={() => onVisitOpen(v)}
                    title="Ava visiit"
                    className={`absolute w-[146px] text-left rounded-xl border px-2.5 py-1.5 transition-all ${
                      v.staatus === 'ei_tulnud'
                        ? 'bg-amber-50 border-amber-200 hover:border-amber-300'
                        : cancelled
                        ? 'bg-red-50 border-red-200 hover:border-red-300'
                        : done
                          ? 'bg-bg-sidebar border-ink-faint/20 opacity-80 hover:opacity-100'
                          : isLate
                            ? 'bg-red-50 border-red-300 hover:border-red-400'
                            : isCurrent
                              ? 'bg-bg-card border-accent shadow-card'
                              : 'bg-bg-card border-ink-faint/25 hover:border-accent/50'
                    }`}
                    style={{ left: `${left}%`, top: row === 0 ? CARD_ROW_0 : CARD_ROW_1, zIndex: openId === v.id ? 30 : 6 }}
                  >
                    <span className="flex items-center gap-1 text-[10px] text-ink-muted tabular-nums">
                      <Clock size={9} />
                      {format(d, 'HH:mm')}
                      {done && !cancelled && <Check size={9} className="text-emerald-600" />}
                      {cancelled && <X size={9} style={{ color: VISIT_STATUS_HEX[v.staatus] }} />}
                      {isLate && <span className="text-[9px] font-semibold text-red-500">hilines</span>}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-semibold text-ink truncate">
                      <Stethoscope size={10} className="text-ink-faint flex-shrink-0" />
                      <span className="truncate">{v.arst?.trim() || v.patsient}</span>
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {jobs.length} {jobs.length === 1 ? 'töö' : 'tööd'}
                    </span>

                    {/* Hover detail */}
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
              <p className="absolute inset-x-0 text-center text-sm text-ink-faint" style={{ top: CARD_ROW_0 + 10 }}>
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
