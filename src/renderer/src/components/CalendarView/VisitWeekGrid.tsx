import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Clock, Plus, Stethoscope } from 'lucide-react'
import {
  format, parseISO, isValid, isSameDay, isToday, startOfWeek, addDays, addWeeks,
  differenceInCalendarDays, differenceInWeeks
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
  onSlotClick: (start: Date, durationMin?: number) => void
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

  // Click-drag to select a time range and create a visit
  const [slotDrag, setSlotDrag] = useState<{
    day: Date; startMin: number; currentMin: number
  } | null>(null)
  const slotDragRef = useRef(slotDrag)
  slotDragRef.current = slotDrag

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  // ── Continuous horizontal strip: ±13 weeks ────────────────────────
  const WEEKS_RANGE = 13
  const allWeeks = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 })
    return Array.from({ length: WEEKS_RANGE * 2 + 1 }, (_, i) =>
      addWeeks(base, i - WEEKS_RANGE)
    )
  }, [])

  const hScrollRef = useRef<HTMLDivElement>(null)
  const [scrollPct, setScrollPct] = useState(50)
  // Track whether the scroll is coming from user interaction (slider/swipe)
  // vs programmatic (arrow buttons). Only arrows trigger smooth scrollTo.
  const scrollSource = useRef<'user' | 'button'>('user')

  // Arrow/button navigation — smooth scroll to that week
  useEffect(() => {
    if (scrollSource.current !== 'button') return
    const el = hScrollRef.current
    if (!el) return
    const base = startOfWeek(new Date(), { weekStartsOn: 1 })
    const idx = Math.round(differenceInCalendarDays(weekStart, base) / 7) + WEEKS_RANGE
    const pageW = el.clientWidth
    el.scrollTo({ left: idx * pageW, behavior: 'smooth' })
    scrollSource.current = 'user'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  // On mount, jump to current week (no animation)
  useEffect(() => {
    const el = hScrollRef.current
    if (!el) return
    const pageW = el.clientWidth
    el.scrollLeft = WEEKS_RANGE * pageW
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync slider + header from scroll — debounced to avoid feedback loop
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleHScroll = useCallback(() => {
    const el = hScrollRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    if (maxScroll > 0) setScrollPct((el.scrollLeft / maxScroll) * 100)
    // Debounce the weekStart update so it doesn't fight the scroll
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      const el2 = hScrollRef.current
      if (!el2) return
      const pageW = el2.clientWidth
      if (pageW <= 0) return
      const idx = Math.round(el2.scrollLeft / pageW)
      const base = startOfWeek(new Date(), { weekStartsOn: 1 })
      const newWeek = addWeeks(base, idx - WEEKS_RANGE)
      if (differenceInCalendarDays(newWeek, weekStart) !== 0) {
        onWeekChange(newWeek)
      }
    }, 150)
  }, [weekStart, onWeekChange])
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
            onClick={() => { scrollSource.current = 'button'; onWeekChange(addWeeks(weekStart, -1)) }}
            className="btn-ghost p-1.5" title="Eelmine nädal"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => { scrollSource.current = 'button'; onWeekChange(startOfWeek(new Date(), { weekStartsOn: 1 })) }}
            className="btn-ghost text-xs"
          >
            Jooksev nädal
          </button>
          <button
            onClick={() => { scrollSource.current = 'button'; onWeekChange(addWeeks(weekStart, 1)) }}
            className="btn-ghost p-1.5" title="Järgmine nädal"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* ── Fixed hour gutter + horizontally scrollable weeks ─────────── */}
      <div className="flex">
        {/* Fixed hour gutter on the left */}
        <div className="flex-shrink-0 w-12">
          {/* Spacer matching day headers height */}
          <div className="h-[52px] border-b border-ink-faint/15" />
          <div className="overflow-hidden" style={{ height: GRID_H }}>
            <div className="relative" style={{ height: GRID_H }}>
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
          </div>
        </div>

        {/* Scrollable week strip */}
        <div
          ref={hScrollRef}
          onScroll={handleHScroll}
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          <div className="flex gap-[6px]" style={{ width: `calc(${allWeeks.length} * (100% + 6px) - 6px)` }}>
            {allWeeks.map((wk, wi) => {
              const wDays = Array.from({ length: 7 }, (_, i) => addDays(wk, i))
              const wByDay = new Map<string, Placed[]>()
              for (const d of wDays) {
                const k = format(d, 'yyyy-MM-dd')
                wByDay.set(k, place(visits.filter(v => {
                  const vd = parseISO(v.algus)
                  return isValid(vd) && isSameDay(vd, d)
                })))
              }
              return (
                <div key={wi} className="flex-shrink-0" style={{ width: `calc(100% / ${allWeeks.length})` }}>
                  {/* Day headers */}
                  <div className="flex border-b border-ink-faint/15">
                    {wDays.map(day => {
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
                            {format(day, 'd')}<span className="text-ink-muted font-normal">.{format(day, 'MM')}</span>
                          </p>
                        </button>
                      )
                    })}
                  </div>

                  {/* Week body */}
                  <div className="overflow-y-auto max-h-[560px]">
                    <div className="flex" ref={wi === WEEKS_RANGE ? bodyRef : undefined}>
                      {wDays.map(day => {
                      const key = format(day, 'yyyy-MM-dd')
                      const placed = wByDay.get(key) ?? []
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
                          onMouseDown={e => {
                            if (e.button !== 0 || (e.target as HTMLElement).closest('button[draggable]')) return
                            const minutes = minutesFromEvent(e, e.currentTarget)
                            setSlotDrag({ day, startMin: minutes, currentMin: minutes })
                            const col = e.currentTarget
                            const onMove = (ev: MouseEvent) => {
                              const m = minutesFromEvent(ev as unknown as React.MouseEvent, col)
                              setSlotDrag(prev => prev ? { ...prev, currentMin: m } : null)
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                              const drag = slotDragRef.current
                              if (!drag) return
                              const from = Math.min(drag.startMin, drag.currentMin)
                              const to = Math.max(drag.startMin, drag.currentMin)
                              const duration = Math.max(SNAP_MIN, to - from)
                              const start = new Date(drag.day)
                              start.setHours(Math.floor(from / 60), from % 60, 0, 0)
                              setSlotDrag(null)
                              onSlotClick(start, duration)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                          onDoubleClick={e => {
                            const minutes = minutesFromEvent(e, e.currentTarget)
                            const start = new Date(day)
                            start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
                            onSlotClick(start)
                          }}
                          title="Klõpsa ja lohista ajavahemiku valimiseks"
                        >
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

                          {isToday(day) && minutesOf(now) >= HOUR_START * 60 && minutesOf(now) <= HOUR_END * 60 && (
                            <span
                              className="absolute inset-x-0 h-[2px] bg-accent z-20 pointer-events-none"
                              style={{ top: yFor(minutesOf(now)) }}
                            >
                              <span className="absolute -left-0.5 -top-[3px] w-2 h-2 rounded-full bg-accent" />
                            </span>
                          )}

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

                          {slotDrag && isSameDay(slotDrag.day, day) && (() => {
                            const from = Math.min(slotDrag.startMin, slotDrag.currentMin)
                            const to = Math.max(slotDrag.startMin, slotDrag.currentMin)
                            const top = yFor(from)
                            const height = Math.max(4, yFor(to) - top)
                            return (
                              <div
                                className="absolute inset-x-1 bg-accent/15 border border-accent/40 rounded-md z-30 pointer-events-none"
                                style={{ top, height }}
                              >
                                <span className="absolute -top-4 left-1 text-[10px] font-semibold text-accent bg-bg-card rounded px-1 tabular-nums">
                                  {String(Math.floor(from / 60)).padStart(2, '0')}:{String(from % 60).padStart(2, '0')}
                                  {' – '}
                                  {String(Math.floor(to / 60)).padStart(2, '0')}:{String(to % 60).padStart(2, '0')}
                                </span>
                              </div>
                            )
                          })()}

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
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-ink-faint/15">
        <span className="text-[10px] text-ink-faint tabular-nums whitespace-nowrap w-16">
          {format(weekStart, 'dd.MM', { locale: et })}
        </span>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={scrollPct * 10}
          onChange={e => {
            const el = hScrollRef.current
            if (!el) return
            const maxScroll = el.scrollWidth - el.clientWidth
            el.scrollLeft = (parseInt(e.target.value) / 1000) * maxScroll
          }}
          className="flex-1 h-1 accent-accent cursor-pointer"
          title="Libista sujuvalt"
        />
        <span className="text-[10px] text-ink-faint tabular-nums whitespace-nowrap w-16 text-right">
          {format(addDays(weekStart, 6), 'dd.MM', { locale: et })}
        </span>
      </div>
      <p className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] text-ink-faint">
        <Plus size={10} />
        Klõpsa ja lohista ajavahemiku valimiseks
      </p>
    </section>
  )
}
