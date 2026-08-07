/**
 * MultiOdontogramPicker — clean grid-based dental arch
 *
 * Each tooth is a rounded square with the FDI number inside.
 * Selected teeth get the work type's color as background.
 * Upper arch = U-shape at top, lower arch = U-shape at bottom.
 */
import { useState } from 'react'
import type { WorkItem } from '../../types/job'

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

function shiftHex(hex: string, index: number): string {
  if (index === 0) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const shift = index * 25
  const nr = Math.min(255, Math.max(0, r + (index % 2 === 0 ? shift : -shift)))
  const ng = Math.min(255, Math.max(0, g + (index % 2 === 1 ? shift : -shift / 2)))
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

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

  // Build tooth ownership map
  const perTypeTotal = new Map<string, number>()
  for (const i of items) perTypeTotal.set(i.too, (perTypeTotal.get(i.too) ?? 0) + 1)

  const toothOwner = new Map<string, { itemId: string; color: string; itemNum: number; showNum: boolean }>()
  const seen = new Map<string, number>()
  for (const item of items) {
    const idx = seen.get(item.too) ?? 0
    seen.set(item.too, idx + 1)
    const baseHex = colorMap[item.too] ?? '#94A3B8'
    const color = shiftHex(baseHex, idx)
    const showNum = (perTypeTotal.get(item.too) ?? 1) > 1
    for (const t of item.hambad.split(',')) {
      const trimmed = t.trim()
      if (trimmed) toothOwner.set(trimmed, { itemId: item.id, color, itemNum: idx + 1, showNum })
    }
  }

  // Count per arch
  const upperCount = UPPER.filter(n => toothOwner.has(String(n))).length
  const lowerCount = LOWER.filter(n => toothOwner.has(String(n))).length
  const totalTeeth = toothOwner.size

  function handleClick(num: number) {
    if (disabled || !activeItemId) return
    onToggleTooth(num)
  }

  const order = (arr: number[]) => mirror ? [...arr].reverse() : arr

  function Tooth({ num }: { num: number }) {
    const s = String(num)
    const owner = toothOwner.get(s)
    const isOwned = !!owner
    const isActive = owner?.itemId === activeItemId

    return (
      <button
        type="button"
        onClick={() => handleClick(num)}
        disabled={disabled}
        className={`relative flex items-center justify-center rounded-lg text-xs font-bold transition-all duration-100 select-none
          ${isOwned
            ? 'text-white shadow-sm'
            : 'bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200'
          }
          ${isActive ? 'ring-2 ring-offset-1 ring-slate-900/30 scale-110' : ''}
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        `}
        style={{
          width: 32, height: 32,
          ...(isOwned ? { backgroundColor: owner!.color } : {}),
        }}
      >
        {isOwned && owner!.showNum ? owner!.itemNum : num}
      </button>
    )
  }

  // Bridge connectors — thin line between consecutive bridge teeth
  function BridgeBar({ arch }: { arch: 'upper' | 'lower' }) {
    const nums = arch === 'upper' ? order(UPPER) : order(LOWER)
    const bars: React.ReactNode[] = []

    for (const item of items) {
      if (!item.bridge) continue
      const idx = (seen.get(item.too) ?? 1) - 1
      const baseHex = colorMap[item.too] ?? '#94A3B8'
      const color = shiftHex(baseHex, idx)
      const teeth = item.hambad.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n))
      if (teeth.length < 2) continue

      // Find consecutive positions in the displayed arch
      const positions = teeth.map(t => nums.indexOf(t)).filter(p => p >= 0).sort((a, b) => a - b)
      for (let j = 0; j < positions.length - 1; j++) {
        if (positions[j + 1] - positions[j] === 1) {
          // Adjacent teeth — show connector
          const left = positions[j]
          bars.push(
            <div
              key={`bridge-${item.id}-${j}`}
              className="absolute h-1 rounded-full"
              style={{
                backgroundColor: color,
                left: `calc(${(left + 0.5) / 16 * 100}% + 16px)`,
                width: `calc(${1 / 16 * 100}% - 4px)`,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
          )
        }
      }
    }
    return <>{bars}</>
  }

  return (
    <div className="space-y-3">
      {/* Header: counts + mirror */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          {upperCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-pink-400" />
              Upper {upperCount}
            </span>
          )}
          {lowerCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Lower {lowerCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !mirror
            setMirror(next)
            try { localStorage.setItem('wivo_odonto_mirror', next ? '1' : '0') } catch {}
          }}
          className="text-[11px] text-ink-faint hover:text-ink-muted px-2 py-1 rounded-lg hover:bg-bg-sidebar transition-colors"
        >
          {mirror ? '👤 Patsiendi' : '🩺 Arsti vaade'}
        </button>
      </div>

      {/* Dental arch */}
      <div className="bg-pink-50/60 rounded-2xl px-4 py-5 space-y-2">
        {/* Upper arch */}
        <div className="relative">
          <div className="flex justify-center gap-1">
            {order(UPPER).map(num => <Tooth key={num} num={num} />)}
          </div>
          <BridgeBar arch="upper" />
        </div>

        {/* Center labels */}
        <div className="flex items-center justify-between px-2 py-0.5">
          <span className="text-[10px] font-semibold text-pink-300/80">{mirror ? 'L' : 'R'}</span>
          <span className="text-[10px] font-medium text-pink-300/60">UPPER</span>
          <span className="text-[10px] font-medium text-pink-300/60 invisible">UPPER</span>
        </div>

        <div className="border-t border-dashed border-pink-200/60" />

        <div className="flex items-center justify-between px-2 py-0.5">
          <span className="text-[10px] font-semibold text-pink-300/80 invisible">R</span>
          <span className="text-[10px] font-medium text-pink-300/60">LOWER</span>
          <span className="text-[10px] font-semibold text-pink-300/80">{mirror ? 'R' : 'L'}</span>
        </div>

        {/* Lower arch */}
        <div className="relative">
          <div className="flex justify-center gap-1">
            {order(LOWER).map(num => <Tooth key={num} num={num} />)}
          </div>
          <BridgeBar arch="lower" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs">
        {totalTeeth > 0 ? (
          <p className="text-ink-muted">
            <span className="font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">{totalTeeth}</span>
            <span className="ml-1.5">teeth selected</span>
          </p>
        ) : (
          <p className="text-ink-faint">
            {activeItemId ? 'Klõpsa hambaid' : 'Vali tööosa'}
          </p>
        )}
      </div>
    </div>
  )
}
