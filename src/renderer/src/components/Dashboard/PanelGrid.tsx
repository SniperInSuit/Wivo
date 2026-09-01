/**
 * Lays the selected panels out, and — in edit mode — lets them be moved and
 * resized.
 *
 * ── Cells, not pixels ────────────────────────────────────────────────────────
 * A panel is [columns, rows] on a four-column grid with a fixed row height.
 * Nothing here is a pixel measurement, which is what lets one stored layout be
 * right on a laptop, on a 27" screen and at 125% text scale. Free pixel
 * resizing would store a number that is only true on the machine it was dragged
 * on.
 *
 * ── Edit mode ────────────────────────────────────────────────────────────────
 * Dragging and resizing are behind a toggle for a concrete reason: the charts
 * have hover tooltips, and a card that is always draggable fights every
 * tooltip, every table scroll and every text selection. Off is a clean
 * dashboard; on is the jiggle-mode equivalent.
 *
 * Visibility is decided HERE, at render, never at write time. A permission can
 * be granted back and a product mode switched on again; a layout that deleted
 * itself the week somebody's `payments.read` was revoked would be data loss
 * wearing a feature's clothes.
 */
import { Component, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, GripVertical, X, Maximize2 } from 'lucide-react'
import { PANEL_BY_ID, type PanelMeta } from './panels/catalogue'
import { PANEL_RENDER } from './panels/render'
import { GRID_COLS, MAX_PANEL_ROWS } from '../../lib/uiPrefs'
import type { PanelCtx, PanelNeed } from './useStatsContext'
import type { PermissionKey } from '../../hooks/usePermissions'

/**
 * Written out rather than built with template strings: Tailwind scans source
 * for literal class names, and `xl:col-span-${w}` reaches the stylesheet as
 * nothing at all.
 */
const COL_SPAN: Record<number, string> = {
  1: 'xl:col-span-1',
  2: 'xl:col-span-2 md:col-span-2',
  3: 'xl:col-span-3 md:col-span-2',
  4: 'xl:col-span-4 md:col-span-2',
}

const ROW_SPAN: Record<number, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
  5: 'row-span-5',
  6: 'row-span-6',
}

/**
 * One row unit. Six of them plus gaps is about a laptop screen's worth, which
 * is what makes "6 rows" mean "full height" without measuring anything.
 */
const ROW_HEIGHT_PX = 132

/**
 * Slow enough to read as one block moving rather than a cut, fast enough not to
 * be waited on. The curve decelerates hard at the end so a panel arrives
 * settling rather than stopping dead.
 */
const GLIDE = { duration: 0.34, ease: [0.22, 1, 0.36, 1] } as const

/** Apple-style discrete sizes. Named, because "2×2" means nothing on a menu. */
export const SIZE_PRESETS: { label: string; size: [number, number] }[] = [
  { label: 'Väike',      size: [1, 1] },
  { label: 'Lai',        size: [2, 1] },
  { label: 'Kõrge',      size: [1, 2] },
  { label: 'Ruut',       size: [2, 2] },
  { label: 'Suur',       size: [3, 2] },
  { label: 'Täislaius',  size: [4, 2] },
  { label: 'Pikk',       size: [2, 4] },
  { label: 'Täisekraan', size: [4, 6] },
]

export interface VisibilityInput {
  can: (p: PermissionKey) => boolean
  clinical: boolean
  laboratory: boolean
}

/** Can this person, in this clinic, see this panel at all? */
export function isPanelVisible(p: PanelMeta, v: VisibilityInput): boolean {
  if (p.perm && !v.can(p.perm)) return false
  if (p.feature === 'clinical' && !v.clinical) return false
  if (p.feature === 'lab' && !v.laboratory) return false
  return true
}

/** Stored ids → the ones this build can draw for this person, in order. */
export function visiblePanels(ids: readonly string[], v: VisibilityInput): PanelMeta[] {
  return ids
    .map(id => PANEL_BY_ID[id])
    .filter((p): p is PanelMeta => !!p && isPanelVisible(p, v))
}

/** Which expensive context slices the visible set actually needs. */
export function neededSlices(panels: PanelMeta[]): Set<PanelNeed> {
  const out = new Set<PanelNeed>()
  for (const p of panels) for (const n of p.needs ?? []) out.add(n)
  return out
}

/**
 * One panel's blast radius. The app-wide ErrorBoundary is a full-screen crash
 * report, which is the wrong answer here: a single card throwing on an
 * unparseable date must cost that card, not the whole dashboard.
 */
class PanelBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[wivo] paneel "${this.props.title}" ei renderdunud:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="card p-4 h-full flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          {this.props.title}
        </h3>
        <p className="text-[11px] text-orange-500 flex items-start gap-1.5">
          <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
          Seda paneeli ei õnnestunud kuvada. Ülejäänud lehe numbrid on korras.
        </p>
      </div>
    )
  }
}

interface PanelGridProps {
  panels: PanelMeta[]
  ctx: PanelCtx
  sizes: Record<string, [number, number]>
  editing: boolean
  onMove: (ids: string[]) => void
  onResize: (id: string, w: number, h: number) => void
  onRemove: (id: string) => void
}

/** The 16px `gap-4` between cards, in the numbers this file has to reason about. */
const GAP_PX = 16

/**
 * A place the dragged panel can be inserted, with the geometry to draw it.
 *
 * `index` is a position in the LINEAR order — that is what a flow grid actually
 * stores. The geometry is what makes it legible: a vertical bar between two
 * cards for "between these two", a full-width horizontal bar at a row boundary
 * for "start a new row here". Both are the same kind of answer; only one of
 * them used to be offered, which is why dropping a panel below another was
 * impossible however carefully you aimed.
 */
interface Slot {
  index: number
  horizontal: boolean
  left: number
  top: number
  width: number
  height: number
}

export function PanelGrid({ panels, ctx, sizes, editing, onMove, onResize, onRemove }: PanelGridProps) {
  // ── Why refs and not just state ─────────────────────────────────────────────
  // `setDragId` does not take effect until React re-renders, but `dragover`
  // starts firing immediately — and a handler that reads a not-yet-updated
  // `dragId` returns early, never calls preventDefault, and the browser then
  // treats the whole grid as a place where nothing may be dropped.
  const dragIdRef = useRef<string | null>(null)
  const slotRef = useRef<Slot | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const reduced = useReducedMotion()

  // Measured from the real DOM, because the slot has to follow the POINTER and
  // not whichever element happened to receive the event: the gaps between cards
  // belong to no panel at all, and that is exactly where someone aiming
  // "between these two" puts the cursor.
  //
  // Found by data attribute rather than by a ref map, and that is not a style
  // choice. `AnimatePresence mode="popLayout"` renders each child through
  // `cloneElement(children, { ref })` — it REPLACES the child's ref with its
  // own, so a ref map filled that way stays empty and every lookup misses.
  const gridRef = useRef<HTMLDivElement>(null)
  const lastPoint = useRef({ x: -1, y: -1 })

  if (panels.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-ink-muted">Ühtegi paneeli ei ole valitud.</p>
        <p className="text-xs text-ink-faint mt-1">
          Vajuta „Kohanda" ja vali, mida sa siin näha tahad.
        </p>
      </div>
    )
  }

  /**
   * Every insertion point on screen, in container coordinates.
   *
   * Vertical ones sit in the gap beside each card; horizontal ones sit at each
   * row boundary and span the whole grid. A dense flow grid has no other
   * positions — "below this card" is really "at the start of the next row", and
   * offering it as such is the difference between a layout you can arrange and
   * one that only ever grows sideways.
   */
  function slots(): Slot[] {
    const root = gridRef.current
    if (!root) return []
    const box = root.getBoundingClientRect()
    const items = [...root.querySelectorAll<HTMLElement>('[data-panel-id]')].map((el, i) => {
      const r = el.getBoundingClientRect()
      return {
        id: el.dataset.panelId as string,
        index: i,
        left: r.left - box.left,
        top: r.top - box.top,
        right: r.right - box.left,
        bottom: r.bottom - box.top,
        width: r.width,
        height: r.height,
      }
    })
    if (items.length === 0) return []

    // The bar is as wide as the PANEL BEING MOVED. A bar spanning the whole
    // grid promised a full-width landing and delivered something else — the
    // marker has to be the size of the thing it is placing.
    const dragged = items.find(it => it.id === dragIdRef.current)
    const dropWidth = Math.min(dragged?.width ?? items[0].width, box.width)

    const half = GAP_PX / 2
    const out: Slot[] = []

    // Beside each card.
    for (const it of items) {
      out.push({ index: it.index, horizontal: false, left: it.left - half - 2, top: it.top, width: 4, height: it.height })
      out.push({ index: it.index + 1, horizontal: false, left: it.right + half - 2, top: it.top, width: 4, height: it.height })
    }

    // At every row boundary. Rows are found by grouping on `top`, which is exact
    // for a grid: cards in the same row share a grid line even when they span
    // different numbers of rows.
    const rows: { top: number; bottom: number; left: number; first: number }[] = []
    for (const it of items) {
      const row = rows.find(r => Math.abs(r.top - it.top) < 4)
      if (row) { row.bottom = Math.max(row.bottom, it.bottom); row.left = Math.min(row.left, it.left) }
      else rows.push({ top: it.top, bottom: it.bottom, left: it.left, first: it.index })
    }
    for (const r of rows) {
      // Starts where that row starts — which is not always the grid's left edge,
      // because a tall card from the row above can hold the first column.
      out.push({ index: r.first, horizontal: true, left: r.left, top: r.top - half - 2, width: dropWidth, height: 4 })
    }
    const last = items[items.length - 1]
    out.push({ index: items.length, horizontal: true, left: 0, top: last.bottom + half - 2, width: dropWidth, height: 4 })

    return out
  }

  /**
   * How much harder a row boundary has to be aimed at than a card edge.
   *
   * Cards are wider than they are tall, so without a handicap the row bar above
   * or below would win from almost anywhere: a small card's side gaps are 200px
   * away while its row boundary is 60. At 3 the middle of a card offers
   * left/right and its top and bottom thirds offer above/below, which is the
   * behaviour a file manager teaches everyone.
   */
  const ROW_SLOT_HANDICAP = 3

  /** Straight-line distance from the pointer to a slot's bar. */
  function distanceTo(s: Slot, x: number, y: number): number {
    const cx = s.left + s.width / 2
    const cy = s.top + s.height / 2
    const dx = s.horizontal
      ? Math.max(s.left - x, 0, x - (s.left + s.width))
      : Math.abs(x - cx)
    const dy = s.horizontal
      ? Math.abs(y - cy)
      : Math.max(s.top - y, 0, y - (s.top + s.height))
    const d = Math.hypot(dx, dy)
    return s.horizontal ? d * ROW_SLOT_HANDICAP : d
  }

  function setDropSlot(next: Slot | null): void {
    const prev = slotRef.current
    if (prev?.index === next?.index && prev?.horizontal === next?.horizontal) return
    slotRef.current = next
    setSlot(next)
  }

  function handleDragOver(e: React.DragEvent): void {
    if (!editing || !dragIdRef.current) return
    // FIRST, unconditionally, on every single event: this is what tells the
    // browser the grid accepts the drop. Skipping it even once while the
    // pointer is over a card leaves that card refusing the drag.
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

    // Only the measuring is throttled — never the acceptance above.
    const { x, y } = lastPoint.current
    if (Math.abs(e.clientX - x) < 4 && Math.abs(e.clientY - y) < 4) return
    lastPoint.current = { x: e.clientX, y: e.clientY }

    const root = gridRef.current
    if (!root) return
    const box = root.getBoundingClientRect()
    const px = e.clientX - box.left
    const py = e.clientY - box.top

    let best: Slot | null = null
    let bestD = Infinity
    for (const s of slots()) {
      const d = distanceTo(s, px, py)
      if (d < bestD) { bestD = d; best = s }
    }
    setDropSlot(best)
  }

  function begin(e: React.DragEvent, id: string): void {
    dragIdRef.current = id
    setDragId(id)
    lastPoint.current = { x: -1, y: -1 }
    // Chromium will start a drag without any payload, but a drag carrying no
    // data is one the platform is free to treat as a native file drag.
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', id) } catch { /* older webviews */ }
    }
  }

  function finish(): void {
    const id = dragIdRef.current
    const target = slotRef.current
    // Read from refs, so this is correct no matter which of drop/dragend fires
    // first or how stale the render that installed the handler was.
    if (id && target) {
      const ids = panels.map(p => p.id)
      const from = ids.indexOf(id)
      if (from >= 0) {
        ids.splice(from, 1)
        // Removing the panel shifts every later index down by one.
        const to = target.index > from ? target.index - 1 : target.index
        if (to !== from) {
          ids.splice(to, 0, id)
          onMove(ids)
        }
      }
    }
    dragIdRef.current = null
    slotRef.current = null
    setDragId(null)
    setSlot(null)
    lastPoint.current = { x: -1, y: -1 }
  }

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 relative"
      style={{
        gridAutoRows: `${ROW_HEIGHT_PX}px`,
        // NOT `dense`. Dense packing backfills holes by taking a later card and
        // placing it earlier, so the visual position stops matching the order —
        // and the order is the only thing a drop can change. The line would
        // promise one place and the browser would choose another. A hole is a
        // cue to resize or reorder something; a layout that rearranges itself
        // behind you is not arrangeable at all.
        gridAutoFlow: 'row',
      }}
      // On the container so the GAPS between cards are live surface too, and
      // again on each card below — dragover has to be accepted wherever the
      // pointer happens to be, and one missed element is a dead zone.
      onDragOver={handleDragOver}
      onDrop={e => { e.preventDefault(); finish() }}
      onDragEnd={finish}
    >
      {/* One marker for the whole grid, positioned in container coordinates.
          Drawing it inside a card could only ever produce a bar as tall as that
          card — which is why a row boundary had no way to be shown. */}
      {slot && (
        <motion.div
          layoutId="wivo-drop-line"
          transition={reduced ? { duration: 0 } : GLIDE}
          className="absolute rounded-full bg-accent z-30 pointer-events-none"
          style={{ left: slot.left, top: slot.top, width: slot.width, height: slot.height }}
        />
      )}

      <AnimatePresence initial={false}>
        {panels.map(p => {
          const [w, h] = sizes[p.id] ?? p.defaultSize
          const dragging = dragId === p.id
          return (
            <motion.div
              key={p.id}
              // `layout` is what turns a reorder or a resize into movement: the
              // browser paints the new grid position, framer animates the
              // difference. Off entirely when the system asks for less motion.
              layout={!reduced}
              transition={reduced ? { duration: 0 } : GLIDE}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{
                opacity: dragging ? 0.35 : 1,
                scale: dragging ? 0.98 : 1,
              }}
              exit={{ opacity: 0, scale: 0.97 }}
              className={`${COL_SPAN[w] ?? COL_SPAN[1]} ${ROW_SPAN[h] ?? ROW_SPAN[1]} min-h-0`}
            >
              {/* A PLAIN div carries the native drag, never the motion one:
                  `motion.div` defines its own `onDragStart`/`onDragEnd` for pan
                  gestures, and forwards the native ones only as a special case. */}
              <div
                data-panel-id={p.id}
                className="h-full relative"
                draggable={editing}
                onDragStart={e => begin(e, p.id)}
                onDragOver={handleDragOver}
                onDrop={e => { e.preventDefault(); finish() }}
                onDragEnd={finish}
              >
                <PanelBoundary title={p.title}>
                  {PANEL_RENDER[p.id as keyof typeof PANEL_RENDER](ctx)}
                </PanelBoundary>
                {editing && (
                  <PanelChrome
                    title={p.title}
                    size={[w, h]}
                    onResize={(nw, nh) => onResize(p.id, nw, nh)}
                    onRemove={() => onRemove(p.id)}
                  />
                )}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/**
 * The edit-mode overlay: a drag handle, a size menu and a remove button.
 *
 * An overlay rather than something each panel renders, so no panel author has
 * to know that editing exists.
 */
function PanelChrome({ title, size, onResize, onRemove }: {
  title: string
  size: [number, number]
  onResize: (w: number, h: number) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [w, h] = size

  return (
    <>
      <div className="absolute inset-0 rounded-card ring-2 ring-accent/40 pointer-events-none" />
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-bg-card/95 rounded-lg shadow-card px-1 py-0.5">
        <GripVertical size={13} className="text-ink-faint cursor-grab active:cursor-grabbing" />
        <button
          onClick={() => setOpen(o => !o)}
          className="p-1 rounded text-ink-muted hover:text-ink"
          title={`${title} — suurus ${w}×${h}`}
        >
          <Maximize2 size={12} />
        </button>
        <button onClick={onRemove} className="p-1 rounded text-ink-muted hover:text-red-500" title="Eemalda">
          <X size={12} />
        </button>
      </div>

      {open && (
        <div className="absolute top-9 right-1.5 z-20 bg-bg-card rounded-lg shadow-card border border-ink-faint/15 p-1.5 w-40">
          <p className="text-[10px] text-ink-faint px-1.5 pb-1">Suurus ruutudes</p>
          {SIZE_PRESETS.map(s => {
            const active = s.size[0] === w && s.size[1] === h
            return (
              <button
                key={s.label}
                onClick={() => { onResize(s.size[0], s.size[1]); setOpen(false) }}
                className={`w-full text-left text-[11px] px-1.5 py-1 rounded flex items-center justify-between ${
                  active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-bg-sidebar hover:text-ink'
                }`}
              >
                <span>{s.label}</span>
                <span className="tabular-nums opacity-60">{s.size[0]}×{s.size[1]}</span>
              </button>
            )
          })}
          <div className="border-t border-ink-faint/10 mt-1 pt-1 flex items-center gap-1 px-1.5">
            <Stepper label="L" value={w} max={GRID_COLS} onChange={v => onResize(v, h)} />
            <Stepper label="K" value={h} max={MAX_PANEL_ROWS} onChange={v => onResize(w, v)} />
          </div>
        </div>
      )}
    </>
  )
}

/** For the size the presets do not cover — 3×1, 1×4, whatever it takes. */
function Stepper({ label, value, max, onChange }: {
  label: string; value: number; max: number; onChange: (v: number) => void
}) {
  return (
    <span className="flex items-center gap-0.5 text-[11px] text-ink-muted">
      {label}
      <button
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        className="w-4 h-4 rounded bg-bg-sidebar disabled:opacity-30 leading-none"
      >
        −
      </button>
      <span className="tabular-nums w-3 text-center text-ink">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-4 h-4 rounded bg-bg-sidebar disabled:opacity-30 leading-none"
      >
        +
      </button>
    </span>
  )
}
