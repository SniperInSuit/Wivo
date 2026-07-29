import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, Plus, Stethoscope } from 'lucide-react'
import {
  format, parseISO, isValid, isSameDay, isToday, startOfWeek, addDays, addWeeks
} from 'date-fns'
import { et } from 'date-fns/locale'
import type { Visit } from '../../types/visit'
import { VISIT_STATUS_HEX, VISIT_STATUS_LABEL } from '../../types/visit'
import { useSettings } from '../../stores/useSettings'

// Working day, drag step and row height. The hours and the step come from Seaded
// → Kalender: they used to be constants, which quietly assumed one lab's day.
// Visits outside the range still render, clamped to the edge, rather than
// disappearing — a 07:30 drop-off must not vanish.
const PX_PER_HOUR = 58

// Breathing room above 09:00 and below 18:00. Without it the first and last hour
// labels are centred on the grid's exact edges and get clipped in half, and a
// 09:00 visit block sits flush against the header.
const PAD_TOP = 16
const PAD_BOTTOM = 20

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

interface VisitWeekGridProps {
  visits: Visit[]
  weekStart: Date
  now: Date
  onWeekChange: (d: Date) => void
  onVisitOpen: (v: Visit) => void
  onSlotClick: (start: Date) => void
  onMove: (visit: Visit, newStart: Date) => void
  onDaySelect: (d: Date) => void
  selected: Date | null
}

// Column assignment for visits that overlap in time, so two 09:00 arrivals sit
// side by side instead of on top of each other.
interface Placed {
  visit: Visit
  start: number
  end: number
  col: number
  cols: number
}

function place(dayVisits: Visit[]): Placed[] {
  const items = dayVisits
    .map(v => {
      const d = parseISO(v.algus)
      const start = minutesOf(d)
      return { visit: v, start, end: start + v.kestus_min, col: 0, cols: 1 }
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)

  // Greedy: walk clusters of mutually overlapping items and spread them across
  // as many columns as the widest point of the cluster needs.
  let cluster: Placed[] = []
  let clusterEnd = -1
  const flush = () => {
    const cols = Math.max(1, ...cluster.map(i => i.col + 1))
    cluster.forEach(i => { i.cols = cols })
    cluster = []
  }
  for (const it of items) {
    if (it.start >= clusterEnd && cluster.length) flush()
    const taken = new Set(cluster.filter(c => c.end > it.start).map(c => c.col))
    let col = 0
    while (taken.has(col)) col++
    it.col = col
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  if (cluster.length) flush()
  return items
}

export function VisitWeekGrid({
  visits, weekStart, now, onWeekChange, onVisitOpen, onSlotClick, onMove,
  onDaySelect, selected
}: VisitWeekGridProps) {
  const { settings } = useSettings()
  const HOUR_START = settings.nadalAlgus
  const HOUR_END = Math.max(settings.nadalAlgus + 1, settings.nadalLopp)
  const SNAP_MIN = settings.ajaSamm
  const RAIL_H = (HOUR_END - HOUR_START) * PX_PER_HOUR
  const GRID_H = PAD_TOP + RAIL_H + PAD_BOTTOM
  // Everything positions through this, so the padding offset lives in one place
  const yFor = (minutes: number) =>
    PAD_TOP + ((Math.min(Math.max(minutes, HOUR_START * 60), HOUR_END * 60) - HOUR_START * 60) / 60) * PX_PER_HOUR

  const bodyRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState<{ day: string; minutes: number } | null>(null)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

  const byDay = useMemo(() => {
    const map = new Map<string, Placed[]>()
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd')
      const list = visits.filter(v => {
        const d = parseISO(v.algus)
        return isValid(d) && isSameDay(d, day)
      })
      map.set(key, place(list))
    }
    return map
  }, [visits, days])

  // Y position inside a column → snapped minutes past midnight
  function minutesFromEvent(e: React.DragEvent | React.MouseEvent, colEl: HTMLElement): number {
    const rect = colEl.getBoundingClientRect()
    const y = Math.max(PAD_TOP, Math.min(PAD_TOP + RAIL_H, e.clientY - rect.top))
    const raw = HOUR_START * 60 + ((y - PAD_TOP) / PX_PER_HOUR) * 60
    return Math.round(raw / SNAP_MIN) * SNAP_MIN
  }

  function handleDrop(e: React.DragEvent, day: Date) {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('visitId')
    const v = visits.find(x => x.id === id)
    if (!v) return
    const minutes = minutesFromEvent(e, e.currentTarget as HTMLElement)
    const next = new Date(day)
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    // Nothing changed — skip the write rather than bumping updated_at for nothing
    const prev = parseISO(v.algus)
    if (isValid(prev) && prev.getTime() === next.getTime()) return
    onMove(v, next)
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-ink-faint/15">
        <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          {format(weekStart, 'd. MMM', { locale: et })} – {format(addDays(weekStart, 6), 'd. MMM yyyy', { locale: et })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onWeekChange(addWeeks(weekStart, -1))}
            className="btn-ghost p-1.5" title="Eelmine nädal"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => onWeekChange(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="btn-ghost text-xs"
          >
            Jooksev nädal
          </button>
          <button
            onClick={() => onWeekChange(addWeeks(weekStart, 1))}
            className="btn-ghost p-1.5" title="Järgmine nädal"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Day headers, aligned with the columns below via the same 48px gutter */}
      <div className="flex border-b border-ink-faint/15">
        <div className="w-12 flex-shrink-0" />
        {days.map(day => {
          const isSel = selected != null && isSameDay(day, selected)
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDaySelect(day)}
              className={`flex-1 min-w-0 px-1 py-1.5 text-center border-l border-ink-faint/10 transition-colors ${
                isSel ? 'bg-accent/10' : 'hover:bg-bg-sidebar/60'
              }`}
            >
              <p className="text-[10px] text-ink-muted first-letter:uppercase truncate">
                {format(day, 'EEEEEE', { locale: et })}
              </p>
              <p className={`text-sm font-semibold tabular-nums ${
                isToday(day) ? 'text-accent' : 'text-ink'
              }`}>
                {format(day, 'd')}
              </p>
            </button>
          )
        })}
      </div>

      {/* Scrollable body */}
      <div className="overflow-y-auto max-h-[560px]">
        <div className="flex" ref={bodyRef}>
          {/* Hour gutter */}
          <div className="w-12 flex-shrink-0 relative" style={{ height: GRID_H }}>
            {hours.map(h => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] text-ink-faint tabular-nums"
                style={{ top: yFor(h * 60) }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd')
            const placed = byDay.get(key) ?? []
            const isDragTarget = dragOver?.day === key

            return (
              <div
                key={key}
                className={`flex-1 min-w-0 relative border-l border-ink-faint/10 ${
                  isDragTarget ? 'bg-accent/5' : ''
                }`}
                style={{ height: GRID_H }}
                onDragOver={e => {
                  e.preventDefault()
                  setDragOver({ day: key, minutes: minutesFromEvent(e, e.currentTarget) })
                }}
                onDragLeave={() => setDragOver(d => (d?.day === key ? null : d))}
                onDrop={e => handleDrop(e, day)}
                onDoubleClick={e => {
                  const minutes = minutesFromEvent(e, e.currentTarget)
                  const start = new Date(day)
                  start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
                  onSlotClick(start)
                }}
                title="Topeltklõps lisab visiidi"
              >
                {/* Hour lines; the half-hour is fainter */}
                {hours.map(h => (
                  <span key={h}>
                    <span
                      className="absolute inset-x-0 border-t border-ink-faint/15"
                      style={{ top: yFor(h * 60) }}
                    />
                    {h < HOUR_END && (
                      <span
                        className="absolute inset-x-0 border-t border-dashed border-ink-faint/10"
                        style={{ top: yFor(h * 60 + 30) }}
                      />
                    )}
                  </span>
                ))}

                {/* Current-time line, only on today */}
                {isToday(day) && minutesOf(now) >= HOUR_START * 60 && minutesOf(now) <= HOUR_END * 60 && (
                  <span
                    className="absolute inset-x-0 h-[2px] bg-accent z-20 pointer-events-none"
                    style={{ top: yFor(minutesOf(now)) }}
                  >
                    <span className="absolute -left-0.5 -top-[3px] w-2 h-2 rounded-full bg-accent" />
                  </span>
                )}

                {/* Drop preview */}
                {isDragTarget && dragOver && (
                  <span
                    className="absolute inset-x-1 h-[2px] bg-accent/70 z-30 pointer-events-none"
                    style={{ top: yFor(dragOver.minutes) }}
                  >
                    <span className="absolute -top-4 left-0 text-[10px] font-semibold text-accent bg-bg-card rounded px-1 tabular-nums">
                      {String(Math.floor(dragOver.minutes / 60)).padStart(2, '0')}:
                      {String(dragOver.minutes % 60).padStart(2, '0')}
                    </span>
                  </span>
                )}

                {placed.map(({ visit: v, start, col, cols }) => {
                  const hex = VISIT_STATUS_HEX[v.staatus]
                  const cancelled = v.staatus === 'tuhistatud'
                  // Clamp so a long visit stops at 18:00 instead of spilling into
                  // the bottom padding
                  const top = yFor(start) + 1
                  const height = Math.max(
                    24,
                    Math.min((v.kestus_min / 60) * PX_PER_HOUR - 2, PAD_TOP + RAIL_H - top)
                  )
                  const widthPct = 100 / cols
                  return (
                    <button
                      key={v.id}
                      draggable
                      onDragStart={e => e.dataTransfer.setData('visitId', v.id)}
                      onClick={e => { e.stopPropagation(); onVisitOpen(v) }}
                      onDoubleClick={e => { e.stopPropagation(); onVisitOpen(v) }}
                      title={`${format(parseISO(v.algus), 'HH:mm')} · ${v.patsient}${v.arst ? ` · ${v.arst}` : ''} · ${v.kestus_min} min · ${VISIT_STATUS_LABEL[v.staatus]}`}
                      className={`absolute rounded-md border-l-[3px] px-1.5 py-0.5 text-left overflow-hidden z-10 cursor-grab active:cursor-grabbing hover:z-40 hover:shadow-card transition-shadow ${
                        cancelled ? 'line-through opacity-70' : ''
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        backgroundColor: `${hex}1f`,
                        borderLeftColor: hex
                      }}
                    >
                      <p className="flex items-center gap-1 text-[10px] font-semibold text-ink tabular-nums truncate">
                        <Clock size={8} className="flex-shrink-0" />
                        {format(parseISO(v.algus), 'HH:mm')}
                      </p>
                      <p className="text-[10px] text-ink-soft truncate">{v.patsient}</p>
                      {height > 44 && v.arst?.trim() && (
                        <p className="flex items-center gap-1 text-[9px] text-ink-muted truncate">
                          <Stethoscope size={8} className="flex-shrink-0" />
                          {v.arst}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      <p className="flex items-center gap-1.5 px-4 py-2 border-t border-ink-faint/15 text-[10px] text-ink-faint">
        <Plus size={10} />
        Topeltklõps tühjal alal lisab visiidi · lohista visiiti, et aega või päeva muuta
      </p>
    </section>
  )
}
