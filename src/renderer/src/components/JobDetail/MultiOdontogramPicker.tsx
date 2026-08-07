/**
 * Odontogram — modern dental production planning map.
 *
 * Not a clinical chart. A clean, professional tool where technicians assign
 * work types to specific teeth. Inspired by Apple Health / Linear / Figma.
 *
 * Layout: two U-shaped arches with FDI-numbered tooth buttons, legend chips
 * above, action bar below. Large targets, minimal borders, smooth feedback.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FlipHorizontal2, Trash2 } from 'lucide-react'
import type { WorkItem } from '../../types/job'

// ─── FDI numbering ──────────────────────────────────────────────────────────
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

// Curve offsets (px) — create the U-shape. Centrals sit at the deepest point.
// index 0 = leftmost molar, 7–8 = centrals, 15 = rightmost molar.
const UPPER_Y = [33, 30, 26, 20, 14, 8, 3, 0, 0, 3, 8, 14, 20, 26, 30, 33]
const LOWER_Y = [33, 30, 26, 20, 14, 8, 3, 0, 0, 3, 8, 14, 20, 26, 30, 33]

// Slight X spread — molars wider apart, centrals tighter
const X_NUDGE = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]

// Slight rotation to follow the arch curve
const ROTATIONS = [-18, -14, -10, -6, -3, -1, 0, 0, 0, 0, 1, 3, 6, 10, 14, 18]

// ─── Color helpers ──────────────────────────────────────────────────────────
function shiftHex(hex: string, index: number): string {
  if (index === 0) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const shift = index * 25
  return `#${Math.min(255, Math.max(0, r + (index % 2 === 0 ? shift : -shift))).toString(16).padStart(2, '0')}${Math.min(255, Math.max(0, g + (index % 2 === 1 ? shift : -shift / 2))).toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ─── Component ──────────────────────────────────────────────────────────────
interface Props {
  items: WorkItem[]
  activeItemId: string | null
  colorMap: Record<string, string>
  onToggleTooth: (tooth: number) => void
  disabled?: boolean
}

export function MultiOdontogramPicker({ items, activeItemId, colorMap, onToggleTooth, disabled }: Props) {
  const [mirror, setMirror] = useState(() => {
    try { return localStorage.getItem('wivo_odonto_mirror') === '1' } catch { return false }
  })

  const toggleMirror = useCallback(() => {
    setMirror(prev => {
      const next = !prev
      try { localStorage.setItem('wivo_odonto_mirror', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  // ── Ownership map ─────────────────────────────────────────────────────────
  const perTypeTotal = new Map<string, number>()
  for (const i of items) perTypeTotal.set(i.too, (perTypeTotal.get(i.too) ?? 0) + 1)

  const toothOwner = new Map<string, { itemId: string; color: string; num: number; showNum: boolean }>()
  const seen = new Map<string, number>()
  for (const item of items) {
    const idx = seen.get(item.too) ?? 0
    seen.set(item.too, idx + 1)
    const color = shiftHex(colorMap[item.too] ?? '#94A3B8', idx)
    const showNum = (perTypeTotal.get(item.too) ?? 1) > 1
    for (const t of item.hambad.split(',')) {
      const s = t.trim()
      if (s) toothOwner.set(s, { itemId: item.id, color, num: idx + 1, showNum })
    }
  }

  // ── Legend data ───────────────────────────────────────────────────────────
  type LegendItem = { too: string; color: string; count: number }
  const legendMap = new Map<string, LegendItem>()
  for (const item of items) {
    const existing = legendMap.get(item.too)
    const count = item.hambad.split(',').filter(t => t.trim()).length
    if (existing) { existing.count += count }
    else { legendMap.set(item.too, { too: item.too, color: colorMap[item.too] ?? '#94A3B8', count }) }
  }
  const legend = [...legendMap.values()]
  const totalTeeth = toothOwner.size

  // Which tooth has a bridge connection to its RIGHT neighbor in display order
  function bridgeToRight(num: number, archNums: number[]): string | null {
    const displayOrder = order(archNums)
    const idx = displayOrder.indexOf(num)
    if (idx < 0 || idx >= displayOrder.length - 1) return null
    const nextNum = displayOrder[idx + 1]
    // Both must belong to the same bridge item
    for (const item of items) {
      if (!item.bridge) continue
      const teeth = new Set(item.hambad.split(',').map(t => t.trim()))
      if (teeth.has(String(num)) && teeth.has(String(nextNum))) {
        return colorMap[item.too] ?? '#94A3B8'
      }
    }
    return null
  }

  // ── Drag-to-paint ──────────────────────────────────────────────────────────
  // mousedown starts painting, mouseenter on other teeth continues, mouseup stops.
  // paintMode: 'add' = selecting teeth, 'remove' = deselecting teeth
  const paintingRef = useRef<'add' | 'remove' | null>(null)
  const paintedRef = useRef(new Set<number>())

  useEffect(() => {
    function stopPaint() {
      paintingRef.current = null
      paintedRef.current = new Set()
    }
    window.addEventListener('mouseup', stopPaint)
    return () => window.removeEventListener('mouseup', stopPaint)
  }, [])

  function handlePointerDown(num: number) {
    if (disabled || !activeItemId) return
    const s = String(num)
    const isOwned = toothOwner.has(s) && toothOwner.get(s)!.itemId === activeItemId
    paintingRef.current = isOwned ? 'remove' : 'add'
    paintedRef.current = new Set([num])
    onToggleTooth(num)
  }

  function handlePointerEnter(num: number) {
    if (!paintingRef.current || disabled || !activeItemId) return
    if (paintedRef.current.has(num)) return
    paintedRef.current.add(num)
    const s = String(num)
    const isOwned = toothOwner.has(s) && toothOwner.get(s)!.itemId === activeItemId
    if (paintingRef.current === 'add' && !isOwned) onToggleTooth(num)
    if (paintingRef.current === 'remove' && isOwned) onToggleTooth(num)
  }

  const order = (arr: number[]) => mirror ? [...arr].reverse() : arr
  const orderIdx = (i: number) => mirror ? 15 - i : i

  // ── Tooth button ──────────────────────────────────────────────────────────
  function Tooth({ num, yOffset, xNudge, rotation, isUpper, archNums }: {
    num: number; yOffset: number; xNudge: number; rotation: number; isUpper: boolean; archNums: number[]
  }) {
    const s = String(num)
    const owner = toothOwner.get(s)
    const isOwned = !!owner
    const isActive = owner?.itemId === activeItemId
    const canClick = !disabled && !!activeItemId
    const bridgeColor = bridgeToRight(num, archNums)

    return (
      <motion.button
        type="button"
        onMouseDown={e => { e.preventDefault(); handlePointerDown(num) }}
        onMouseEnter={() => handlePointerEnter(num)}
        whileHover={canClick ? { scale: 1.12, y: isUpper ? -2 : 2 } : undefined}
        whileTap={canClick ? { scale: 0.95 } : undefined}
        className={[
          'relative flex items-center justify-center rounded-lg transition-colors duration-100 select-none',
          'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
          isOwned
            ? 'text-white shadow-sm'
            : 'bg-white text-slate-400 border border-slate-200/80 hover:border-accent/40',
          isActive ? 'ring-2 ring-white/80 shadow-md' : '',
          disabled ? 'opacity-40 cursor-not-allowed' : canClick ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        style={{
          width: 34,
          height: 40,
          marginTop: isUpper ? yOffset : undefined,
          marginBottom: !isUpper ? yOffset : undefined,
          marginLeft: xNudge > 0 ? xNudge : undefined,
          marginRight: xNudge > 0 ? xNudge : undefined,
          transform: `rotate(${rotation}deg)`,
          ...(isOwned ? { backgroundColor: owner!.color } : {}),
        }}
      >
        <span className="text-[11px] font-bold" style={{ transform: `rotate(${-rotation}deg)` }}>
          {num}
        </span>
        {/* Bridge connector — bar below (upper arch) or above (lower arch) */}
        {bridgeColor && (
          <span
            className="absolute rounded-full pointer-events-none"
            style={{
              backgroundColor: bridgeColor,
              width: 10,
              height: 4,
              right: -7,
              zIndex: 1,
              ...(isUpper
                ? { bottom: -3 }
                : { top: -3 }),
            }}
          />
        )}
      </motion.button>
    )
  }


  return (
    <div className="space-y-3">
      {/* ── Legend chips ──────────────────────────────────────────────────── */}
      {legend.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {legend.map(l => (
            <span key={l.too} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: l.color }} />
              {l.too}
              <span className="text-ink-faint">{l.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Arch card ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-b from-rose-50/50 to-pink-50/30 border border-pink-100/60 px-6 py-5">
        {/* Mirror toggle */}
        <div className="flex justify-end mb-2">
          <button type="button" onClick={toggleMirror}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-white/60 transition-colors"
          >
            <FlipHorizontal2 size={12} />
            {mirror ? 'Patsiendi vaade' : 'Arsti vaade'}
          </button>
        </div>

        {/* ── Upper arch ─────────────────────────────────────────────────── */}
        <div className="flex justify-center mb-1">
          <div className="relative flex items-start gap-[2px]">
            {order(UPPER).map((num, displayIdx) => {
              const origIdx = orderIdx(displayIdx)
              return (
                <Tooth key={num} num={num}
                  yOffset={UPPER_Y[origIdx]}
                  xNudge={X_NUDGE[origIdx]}
                  rotation={ROTATIONS[origIdx] * (mirror ? -1 : 1)}
                  isUpper
                  archNums={UPPER}
                />
              )
            })}
          </div>
        </div>

        {/* ── Center labels ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-2 my-2">
          <span className="text-[10px] font-bold text-pink-300/70 tracking-wider">
            {mirror ? 'L' : 'R'}
          </span>
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 border-t border-dashed border-pink-200/50" />
            <span className="text-[9px] font-semibold text-pink-300/60 tracking-widest">UPPER</span>
            <div className="flex-1 border-t border-dashed border-pink-200/50" />
          </div>
          <span className="text-[10px] font-bold text-pink-300/70 tracking-wider">
            {mirror ? 'R' : 'L'}
          </span>
        </div>

        <div className="flex items-center gap-4 px-2 mb-2">
          <span className="text-[10px] font-bold text-pink-300/70 tracking-wider invisible">R</span>
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 border-t border-dashed border-pink-200/50" />
            <span className="text-[9px] font-semibold text-pink-300/60 tracking-widest">LOWER</span>
            <div className="flex-1 border-t border-dashed border-pink-200/50" />
          </div>
          <span className="text-[10px] font-bold text-pink-300/70 tracking-wider invisible">L</span>
        </div>

        {/* ── Lower arch ─────────────────────────────────────────────────── */}
        <div className="flex justify-center mt-1">
          <div className="relative flex items-end gap-[2px]">
            {order(LOWER).map((num, displayIdx) => {
              const origIdx = orderIdx(displayIdx)
              return (
                <Tooth key={num} num={num}
                  yOffset={LOWER_Y[origIdx]}
                  xNudge={X_NUDGE[origIdx]}
                  rotation={-ROTATIONS[origIdx] * (mirror ? -1 : 1)}
                  isUpper={false}
                  archNums={LOWER}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom toolbar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {totalTeeth > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-md tabular-nums">{totalTeeth}</span>
              <span className="text-ink-muted">hammast valitud</span>
            </span>
          ) : (
            <span className="text-xs text-ink-faint">
              {activeItemId ? 'Klõpsa hambaid' : 'Vali tööosa'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={toggleMirror}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink-muted hover:bg-bg-sidebar transition-colors"
            title="Peegelda"
          >
            <FlipHorizontal2 size={14} />
          </button>
          {totalTeeth > 0 && (
            <button type="button"
              className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Tühjenda"
              onClick={() => {
                // Clear all teeth from active item by toggling each one off
                if (!activeItemId) return
                const activeItem = items.find(i => i.id === activeItemId)
                if (!activeItem) return
                for (const t of activeItem.hambad.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))) {
                  onToggleTooth(t)
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
