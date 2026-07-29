/**
 * TimeDrum — iOS-style drum scroller for 24 h time (HH : MM).
 * Scroll with the mouse wheel; click adjacent rows to jump one step.
 */
import { useRef } from 'react'

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

const ITEM_H   = 34          // px per row
const VISIBLE  = 5           // rows shown (must be odd)
const HALF     = 2           // centre slot index

// Visual weight by distance from centre (far … near … centre)
const OPACITIES: number[] = [0.15, 0.4, 1, 0.4, 0.15]
const SCALES:    number[] = [0.82, 0.92, 1, 0.92, 0.82]

// ─── Single drum column ───────────────────────────────────────────────────────
function Column({
  items, idx, setIdx, dark,
}: {
  items: string[]
  idx: number
  setIdx: (i: number) => void
  dark?: boolean
}) {
  const lastTick = useRef(0)
  const fg      = dark ? '#cbd5e1' : '#334155'
  const bgFade  = dark ? 'rgb(30,41,59)' : 'rgb(255,255,255)'

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const now = Date.now()
    if (now - lastTick.current < 85) return
    lastTick.current = now
    const next = idx + (e.deltaY > 0 ? 1 : -1)
    setIdx(Math.max(0, Math.min(items.length - 1, next)))
  }

  return (
    <div
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: 52,
        height: ITEM_H * VISIBLE,
        overflow: 'hidden',
        cursor: 'ns-resize',
        userSelect: 'none',
      }}
    >
      {/* ── Teal selection band ── */}
      <div style={{
        position: 'absolute', left: 4, right: 4,
        top: ITEM_H * HALF, height: ITEM_H,
        background: 'rgba(10,182,196,0.13)',
        border: '1.5px solid rgba(10,182,196,0.38)',
        borderRadius: 7,
        pointerEvents: 'none', zIndex: 10,
      }} />

      {/* ── Top fade ── */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0,
        height: ITEM_H * HALF,
        background: `linear-gradient(to bottom, ${bgFade} 20%, transparent)`,
        pointerEvents: 'none', zIndex: 20,
      }} />

      {/* ── Bottom fade ── */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: ITEM_H * HALF,
        background: `linear-gradient(to top, ${bgFade} 20%, transparent)`,
        pointerEvents: 'none', zIndex: 20,
      }} />

      {/* ── Rows ── */}
      {Array.from({ length: VISIBLE }, (_, slot) => {
        const i      = idx - HALF + slot
        const valid  = i >= 0 && i < items.length
        const centre = slot === HALF
        return (
          <div
            key={slot}
            onClick={() => valid && !centre && setIdx(i)}
            style={{
              height: ITEM_H,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '0.02em',
              opacity: OPACITIES[slot],
              transform: `scale(${SCALES[slot]})`,
              color: centre ? '#0AB6C4' : fg,
              cursor: valid && !centre ? 'pointer' : 'default',
              transition: 'opacity 0.1s, transform 0.1s',
            }}
          >
            {valid ? items[i] : ''}
          </div>
        )
      })}
    </div>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────
export interface TimeDrumProps {
  value: string             // "HH:MM"
  onChange: (v: string) => void
  dark?: boolean
}

export function TimeDrum({ value, onChange, dark }: TimeDrumProps) {
  const parts = (value || '12:00').split(':')
  const h = Math.min(23, Math.max(0, parseInt(parts[0] ?? '12', 10) || 0))
  const m = Math.min(59, Math.max(0, parseInt(parts[1] ?? '0',  10) || 0))
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           2,
      background:    dark ? 'rgba(15,23,42,0.7)' : '#f8fafc',
      borderRadius:  12,
      padding:       '4px 10px',
      border:        dark
        ? '1px solid rgba(71,85,105,0.55)'
        : '1px solid rgba(0,0,0,0.09)',
      boxShadow:     dark
        ? 'inset 0 1px 3px rgba(0,0,0,0.4)'
        : 'inset 0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <Column
        items={HOURS}
        idx={h}
        setIdx={i => onChange(`${pad(i)}:${pad(m)}`)}
        dark={dark}
      />
      <div style={{
        fontWeight: 800, fontSize: 24,
        color: dark ? '#64748b' : '#94a3b8',
        lineHeight: 1, paddingBottom: 2,
        userSelect: 'none',
      }}>
        :
      </div>
      <Column
        items={MINUTES}
        idx={m}
        setIdx={i => onChange(`${pad(h)}:${pad(i)}`)}
        dark={dark}
      />
    </div>
  )
}
