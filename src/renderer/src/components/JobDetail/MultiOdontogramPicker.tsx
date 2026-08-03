/**
 * MultiOdontogramPicker — dental arch with per-work-item coloring
 *
 * Each WorkItem's teeth are colored by their work type's hex.
 * Bridge items get connector lines between consecutive teeth.
 * One item is "active" at a time — clicking teeth toggles on that item.
 * A tooth can belong to at most one item.
 */
import { useState } from 'react'
import type { WorkItem } from '../../types/job'

// ─── Arch geometry (same as OdontogramPicker) ────────────────────────────────
const W = 460, H = 330
const CX = W / 2

const UCX = CX, UCY = 82, URX = 180, URY = 52
const LCX = CX, LCY = 248, LRX = 180, LRY = 52

const UPPER_NUMS = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER_NUMS = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

const TDIM: { w: number; h: number }[] = [
  { w: 0,  h: 0  },
  { w: 14, h: 19 }, // 1 central
  { w: 12, h: 17 }, // 2 lateral
  { w: 12, h: 20 }, // 3 canine
  { w: 14, h: 16 }, // 4 1st premolar
  { w: 13, h: 15 }, // 5 2nd premolar
  { w: 18, h: 14 }, // 6 1st molar
  { w: 18, h: 13 }, // 7 2nd molar
  { w: 15, h: 11 }, // 8 wisdom
]

function fdiPos(i: number) { return i < 8 ? (8 - i) : (i - 7) }
function archTheta(i: number) { return Math.asin(2 * i / 15 - 1) + Math.PI / 2 }
function toothRot(i: number) { return (archTheta(i) * 180 / Math.PI - 90) * 0.38 }
function upperXY(i: number) {
  const a = archTheta(i)
  return { x: UCX + URX * Math.cos(a), y: UCY + URY * Math.sin(a) }
}
function lowerXY(i: number) {
  const a = archTheta(i)
  return { x: LCX + LRX * Math.cos(a), y: LCY - LRY * Math.sin(a) }
}

const upperGum = [
  `M ${UCX - URX - 20} ${UCY}`,
  `A ${URX + 20} ${URY + 16} 0 0 1 ${UCX + URX + 20} ${UCY}`,
  `L ${UCX + URX + 20} ${UCY - 58}`,
  `L ${UCX - URX - 20} ${UCY - 58}`,
  `Z`
].join(' ')

const lowerGum = [
  `M ${LCX - LRX - 20} ${LCY}`,
  `A ${LRX + 20} ${LRY + 16} 0 0 0 ${LCX + LRX + 20} ${LCY}`,
  `L ${LCX + LRX + 20} ${LCY + 58}`,
  `L ${LCX - LRX - 20} ${LCY + 58}`,
  `Z`
].join(' ')

// ─── Color helpers ───────────────────────────────────────────────────────────

// Slight hue shift for same-type items so adjacent bridges are distinguishable
function shiftHex(hex: string, index: number): string {
  if (index === 0) return hex
  // Parse hex, rotate hue slightly
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const shift = index * 25
  const nr = Math.min(255, Math.max(0, r + (index % 2 === 0 ? shift : -shift)))
  const ng = Math.min(255, Math.max(0, g + (index % 2 === 1 ? shift : -shift / 2)))
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function darken(hex: string): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 30)
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 30)
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 30)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ─── Component ───────────────────────────────────────────────────────────────

interface MultiOdontogramPickerProps {
  items: WorkItem[]
  activeItemId: string | null
  /** Map of work type name → hex color */
  colorMap: Record<string, string>
  onToggleTooth: (tooth: number) => void
  disabled?: boolean
}

export function MultiOdontogramPicker({
  items, activeItemId, colorMap, onToggleTooth, disabled
}: MultiOdontogramPickerProps) {

  // Orientation toggle: arsti (standard, R left) vs patsiendi (mirror, R right)
  const [mirror, setMirror] = useState(() => {
    try { return localStorage.getItem('wivo_odonto_mirror') === '1' } catch { return false }
  })
  function toggleMirror() {
    const next = !mirror
    setMirror(next)
    try { localStorage.setItem('wivo_odonto_mirror', next ? '1' : '0') } catch {}
  }

  // Build tooth → { itemId, color, itemIndex } lookup
  const toothOwner = new Map<string, { itemId: string; color: string }>()
  // Track how many items share each work type (for hue shifting)
  const typeCount = new Map<string, number>()
  for (const item of items) {
    const idx = typeCount.get(item.too) ?? 0
    typeCount.set(item.too, idx + 1)
    const baseHex = colorMap[item.too] ?? '#94A3B8'
    const color = shiftHex(baseHex, idx)
    for (const t of item.hambad.split(',')) {
      const trimmed = t.trim()
      if (trimmed) toothOwner.set(trimmed, { itemId: item.id, color })
    }
  }

  const activeItem = items.find(i => i.id === activeItemId)
  const activeColor = activeItem ? (colorMap[activeItem.too] ?? '#0AB6C4') : '#0AB6C4'

  function handleClick(num: number) {
    if (disabled || !activeItemId) return
    onToggleTooth(num)
  }

  function Tooth({ num, cx, cy, upper }: { num: number; cx: number; cy: number; upper: boolean }) {
    const i = upper ? UPPER_NUMS.indexOf(num) : LOWER_NUMS.indexOf(num)
    const pos = fdiPos(i)
    const { w, h } = TDIM[pos]
    const rot = toothRot(i)
    const s = String(num)
    const owner = toothOwner.get(s)
    const isActive = owner?.itemId === activeItemId
    const isOwned = !!owner

    const fill = isOwned ? owner.color : '#FAFAFA'
    const stroke = isOwned ? darken(owner.color) : '#C8B4B6'
    const rectY = upper ? 0 : -h

    return (
      <g
        transform={`translate(${cx},${cy}) rotate(${rot})`}
        onClick={() => handleClick(num)}
        style={{
          cursor: disabled ? 'not-allowed' : !activeItemId ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : (!activeItemId && !isOwned) ? 0.7 : 1
        }}
      >
        <rect
          x={-w / 2} y={rectY} width={w} height={h}
          rx={3} ry={3} fill={fill} stroke={stroke} strokeWidth={isActive ? 2 : 1.3}
        />
        {pos <= 5 && (
          <line
            x1={-w / 2 + 2} y1={upper ? h - 3 : rectY + 3}
            x2={w / 2 - 2} y2={upper ? h - 3 : rectY + 3}
            stroke={isOwned ? 'rgba(255,255,255,0.6)' : '#D8C8CA'} strokeWidth={0.8}
          />
        )}
        {pos >= 6 && (
          <>
            <line x1={-2} y1={upper ? 2 : rectY + 2} x2={-2} y2={upper ? h - 2 : -2} stroke={isOwned ? 'rgba(255,255,255,0.5)' : '#E0CECE'} strokeWidth={0.8} />
            <line x1={2} y1={upper ? 2 : rectY + 2} x2={2} y2={upper ? h - 2 : -2} stroke={isOwned ? 'rgba(255,255,255,0.5)' : '#E0CECE'} strokeWidth={0.8} />
          </>
        )}
      </g>
    )
  }

  // ─── Bridge connectors ──────────────────────────────────────────────────────
  function BridgeConnectors() {
    const lines: React.ReactNode[] = []
    const typeIdx = new Map<string, number>()

    for (const item of items) {
      if (!item.bridge) continue
      const idx = typeIdx.get(item.too) ?? 0
      typeIdx.set(item.too, idx + 1)
      const baseHex = colorMap[item.too] ?? '#94A3B8'
      const color = shiftHex(baseHex, idx)

      const teeth = item.hambad.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n))
      if (teeth.length < 2) continue

      // Sort by position in the arch arrays
      const sorted = teeth.sort((a, b) => {
        const ai = UPPER_NUMS.indexOf(a) >= 0 ? UPPER_NUMS.indexOf(a) : LOWER_NUMS.indexOf(a) + 16
        const bi = UPPER_NUMS.indexOf(b) >= 0 ? UPPER_NUMS.indexOf(b) : LOWER_NUMS.indexOf(b) + 16
        return ai - bi
      })

      for (let j = 0; j < sorted.length - 1; j++) {
        const t1 = sorted[j], t2 = sorted[j + 1]
        // Both must be in the same arch
        const u1 = UPPER_NUMS.indexOf(t1), u2 = UPPER_NUMS.indexOf(t2)
        const l1 = LOWER_NUMS.indexOf(t1), l2 = LOWER_NUMS.indexOf(t2)

        let p1: { x: number; y: number }, p2: { x: number; y: number }
        let offset: number

        if (u1 >= 0 && u2 >= 0) {
          p1 = upperXY(u1); p2 = upperXY(u2)
          offset = -10 // above upper teeth
        } else if (l1 >= 0 && l2 >= 0) {
          p1 = lowerXY(l1); p2 = lowerXY(l2)
          offset = 10 // below lower teeth
        } else continue // cross-arch, skip

        lines.push(
          <line
            key={`bridge-${item.id}-${j}`}
            x1={p1.x} y1={p1.y + offset}
            x2={p2.x} y2={p2.y + offset}
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={idx > 0 ? '6 3' : undefined}
            opacity={0.8}
          />
        )
      }
    }
    return <>{lines}</>
  }

  const totalTeeth = toothOwner.size

  return (
    <div className="space-y-2">
      {/* Orientation toggle */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={toggleMirror}
          className="text-[10px] text-ink-faint hover:text-ink-muted transition-colors px-2 py-1 rounded-lg hover:bg-bg-sidebar"
        >
          {mirror ? '👤 Patsiendi vaade' : '🩺 Arsti vaade'}
        </button>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-xl"
        style={{ maxHeight: H, background: '#FFF5F6', transform: mirror ? 'scaleX(-1)' : undefined }}
      >
        <path d={upperGum} fill="#F5C4CA" />
        <path d={lowerGum} fill="#F5C4CA" />
        <ellipse cx={UCX} cy={UCY} rx={URX - 10} ry={URY - 4} fill="#FDDFE1" />
        <ellipse cx={LCX} cy={LCY} rx={LRX - 10} ry={LRY - 4} fill="#FDDFE1" />
        <path d={`M ${UCX - URX - 4} ${UCY} A ${URX + 4} ${URY + 4} 0 0 1 ${UCX + URX + 4} ${UCY}`} fill="none" stroke="#EBA8B0" strokeWidth={3} />
        <path d={`M ${LCX - LRX - 4} ${LCY} A ${LRX + 4} ${LRY + 4} 0 0 0 ${LCX + LRX + 4} ${LCY}`} fill="none" stroke="#EBA8B0" strokeWidth={3} />
        <line x1={CX} y1={12} x2={CX} y2={H - 12} stroke="#DDB8BC" strokeWidth={1} strokeDasharray="3 3" />
        {/* R/L labels — flip text back so it's readable when mirrored */}
        <text x={16} y={H / 2 + 4} fontSize={10} fill="#C4989E" fontWeight="600" fontFamily="sans-serif"
          style={mirror ? { transform: 'scaleX(-1)', transformOrigin: '16px' } : undefined}
        >{mirror ? 'L' : 'R'}</text>
        <text x={W - 16} y={H / 2 + 4} fontSize={10} fill="#C4989E" fontWeight="600" fontFamily="sans-serif" textAnchor="end"
          style={mirror ? { transform: 'scaleX(-1)', transformOrigin: `${W - 16}px` } : undefined}
        >{mirror ? 'R' : 'L'}</text>

        {/* Bridge connectors (behind teeth) */}
        <BridgeConnectors />

        {UPPER_NUMS.map((num, i) => {
          const { x, y } = upperXY(i)
          return <Tooth key={num} num={num} cx={x} cy={y} upper={true} />
        })}
        {LOWER_NUMS.map((num, i) => {
          const { x, y } = lowerXY(i)
          return <Tooth key={num} num={num} cx={x} cy={y} upper={false} />
        })}

        {/* FDI labels — flip text back when mirrored so numbers read correctly */}
        {UPPER_NUMS.map((num, i) => {
          const { x } = upperXY(i)
          const owner = toothOwner.get(String(num))
          return (
            <text key={`ul-${num}`} x={x} y={16} textAnchor="middle" fontSize={9.5}
              fontFamily="monospace" fontWeight="700"
              fill={owner ? owner.color : '#A08088'}
              onClick={() => handleClick(num)}
              style={{
                cursor: disabled ? 'not-allowed' : !activeItemId ? 'default' : 'pointer',
                userSelect: 'none',
                ...(mirror ? { transform: `scaleX(-1)`, transformOrigin: `${x}px 16px` } : {})
              }}
            >{num}</text>
          )
        })}
        {LOWER_NUMS.map((num, i) => {
          const { x } = lowerXY(i)
          const owner = toothOwner.get(String(num))
          return (
            <text key={`ll-${num}`} x={x} y={322} textAnchor="middle" fontSize={9.5}
              fontFamily="monospace" fontWeight="700"
              fill={owner ? owner.color : '#A08088'}
              onClick={() => handleClick(num)}
              style={{
                cursor: disabled ? 'not-allowed' : !activeItemId ? 'default' : 'pointer',
                userSelect: 'none',
                ...(mirror ? { transform: `scaleX(-1)`, transformOrigin: `${x}px 322px` } : {})
              }}
            >{num}</text>
          )
        })}
      </svg>

      <div className="flex items-center justify-between">
        {totalTeeth > 0 ? (
          <p className="text-xs text-ink-muted">
            <span className="font-semibold text-ink">{totalTeeth}</span> hammas{totalTeeth !== 1 ? 't' : ''} kokku
            {activeItemId && <span className="text-accent"> · vali hambad aktiivse tööosa jaoks</span>}
          </p>
        ) : (
          <p className="text-xs text-ink-faint">
            {activeItemId ? 'Klõpsa hambaid, et neid tööosale lisada' : 'Lisa tööosa ja vali hambad'}
          </p>
        )}
      </div>
    </div>
  )
}
