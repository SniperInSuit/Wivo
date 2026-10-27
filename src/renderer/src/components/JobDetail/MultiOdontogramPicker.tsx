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
import { FlipHorizontal2, Trash2, Bolt, PenTool } from 'lucide-react'
import type { WorkItem } from '../../types/job'
import type { ToothPickerProps } from '../teeth/toothPickerProps'
import { useOdontogramMirror, setOdontogramMirror } from '../../stores/useUiPrefs'

/** The pre-1.94 machine-global choice. Read once, never written. */
function legacyMirror(): boolean {
  try { return localStorage.getItem('wivo_odonto_mirror') === '1' } catch { return false }
}
import { deriveOdontogramState, pairKey } from '../teeth/odontogramState'
import {
  decideToothClick, decideDragPaint, ownsTooth,
  type ClickContext, type MarkMode,
} from '../teeth/toothInteraction'

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

// ─── Component ──────────────────────────────────────────────────────────────

export function MultiOdontogramPicker({
  items, activeItemId, colorMap, onToggleTooth, onToggleImplant, onToggleDesign, disabled,
}: ToothPickerProps) {
  // A marking mode retargets the SAME click. A second chart, or a modifier key,
  // would both be worse: one doubles the drawing, the other is invisible.
  const [markMode, setMarkMode] = useState<MarkMode | null>(null)
  // Per USER now, not per machine. `wivo_odonto_mirror` was machine-global,
  // which is wrong the moment two people share a PC — or one person uses two.
  // The legacy key is still READ once, so nobody's existing choice flips on
  // the upgrade; it is never written again.
  const storedMirror = useOdontogramMirror()
  const mirror = storedMirror ?? legacyMirror()

  const toggleMirror = useCallback(() => {
    setOdontogramMirror(!mirror)
  }, [mirror])

  // ONE derivation, shared with whatever else draws this chart — see
  // teeth/odontogramState.ts for why it does not live here any more.
  const { owners: toothOwner, implants: implantSet, designed: designSet, legend, totalTeeth, bridgePairs } =
    deriveOdontogramState(items, colorMap)

  /** The bridge bar drawn to this tooth's right-hand neighbour in display order. */
  function bridgeToRight(num: number, archNums: number[]): string | null {
    const displayOrder = order(archNums)
    const idx = displayOrder.indexOf(num)
    if (idx < 0 || idx >= displayOrder.length - 1) return null
    // The pair is direction-free in the data; mirroring only changes which of
    // the two is drawn on the left.
    return bridgePairs.get(pairKey(String(num), String(displayOrder[idx + 1]))) ?? null
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

  // The rules themselves live in teeth/toothInteraction.ts, because the 3D
  // chart has to obey exactly the same ones and they decide what gets billed
  // and who gets paid. This component is left with the DRAWING consequences:
  // which direction a drag is going, and which teeth it has already visited.
  const clickCtx = (): ClickContext => ({
    owners: toothOwner, activeItemId, markMode, disabled,
  })

  function handlePointerDown(num: number) {
    switch (decideToothClick(num, clickCtx())) {
      case 'none': return
      case 'implant': onToggleImplant?.(num); return
      case 'design': onToggleDesign?.(num); return
    }
    // Only a plain toggle starts a drag. A mark never paints — see the rules.
    paintingRef.current = ownsTooth(toothOwner, num, activeItemId) ? 'remove' : 'add'
    paintedRef.current = new Set([num])
    onToggleTooth(num)
  }

  function handlePointerEnter(num: number) {
    if (paintedRef.current.has(num)) return
    if (decideDragPaint(num, clickCtx(), paintingRef.current) !== 'toggle') return
    paintedRef.current.add(num)
    onToggleTooth(num)
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
    const isImplant = implantSet.has(s)
    const isDesigned = designSet.has(s)

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
        {/* Implant marker. A ring and a dot rather than a different fill: the
            fill already says which work item owns this tooth, and a second
            meaning on the same channel would cost the first one. */}
        {isImplant && (
          <>
            <span
              className="absolute inset-0 rounded-lg pointer-events-none ring-2 ring-offset-1 ring-slate-900/70"
              style={{ zIndex: 2 }}
            />
            <span
              className="absolute rounded-full bg-slate-900 pointer-events-none flex items-center justify-center"
              style={{
                width: 12, height: 12, zIndex: 3,
                right: -4,
                ...(isUpper ? { top: -4 } : { bottom: -4 }),
              }}
            >
              <Bolt size={8} className="text-white" />
            </span>
          </>
        )}
        {/* Designed by the designer — a violet bar along the outer edge. A
            different channel from the implant ring, because one tooth can
            easily be both: a third molar on an implant that the AI would not
            design either. */}
        {isDesigned && (
          <span
            aria-hidden
            className="absolute rounded-full bg-violet-500 pointer-events-none"
            style={{
              left: 4, right: 4, height: 3, zIndex: 2,
              ...(isUpper ? { top: 2 } : { bottom: 2 }),
            }}
          />
        )}
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
        <div className="flex justify-end items-center gap-1 mb-2">
          {/* Only the modes the caller enabled. A chart with nothing to mark
              must not grow buttons about marking. */}
          {onToggleImplant && (
            <button
              type="button"
              onClick={() => setMarkMode(m => (m === 'implant' ? null : 'implant'))}
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors ${
                markMode === 'implant'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-white/60'
              }`}
            >
              <Bolt size={12} />
              Implantaadid
            </button>
          )}
          {onToggleDesign && (
            <button
              type="button"
              onClick={() => setMarkMode(m => (m === 'design' ? null : 'design'))}
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors ${
                markMode === 'design'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-white/60'
              }`}
            >
              <PenTool size={12} />
              Disainija hambad
            </button>
          )}
          <button type="button" onClick={toggleMirror}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-white/60 transition-colors"
          >
            <FlipHorizontal2 size={12} />
            {mirror ? 'Patsiendi vaade' : 'Arsti vaade'}
          </button>
        </div>

        {markMode === 'implant' && (
          <p className="text-[11px] text-slate-500 text-center mb-2">
            Klõpsa valitud hammastel, mis istuvad implantaadil. Ülejäänud on
            vahelülid. Kruvide kulu arvestatakse märgitud hammaste järgi.
          </p>
        )}
        {markMode === 'design' && (
          <p className="text-[11px] text-violet-600 text-center mb-2">
            Klõpsa hammastel, mille disainis <strong>disainija</strong>. Ülejäänud
            tegi tehnik ise. Märkimata jätmine tähendab, et disainija tegi kõik —
            disainitasu arvestatakse märgitud hammaste järgi.
          </p>
        )}

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
