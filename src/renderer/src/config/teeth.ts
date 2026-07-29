import type { ToothStatus, ManualToothStatus } from '../types/teeth'

// ─── FDI layout ───────────────────────────────────────────────────────────────
// Rendered LEFT → RIGHT in dentist view: quadrants 1/4 on the viewer's left.
// This is the REVERSE of OdontogramPicker's placement, which puts #18 at x=410
// while labelling the left edge "R". Do not copy that file's geometry.
export const FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] as const
export const FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const
export const ALL_FDI: number[] = [...FDI_UPPER, ...FDI_LOWER]

// FDI position from midline, 1 = central incisor … 8 = wisdom
export const fdiPos = (num: number) => num % 10

// Tooth size by position — copied verbatim from OdontogramPicker.tsx:21-31,
// this size differentiation is what makes it read as a real odontogram.
export const TDIM: { w: number; h: number }[] = [
  { w: 0,  h: 0  }, // 0 unused
  { w: 14, h: 19 }, // 1 central incisor
  { w: 12, h: 17 }, // 2 lateral incisor
  { w: 12, h: 20 }, // 3 canine (tallest)
  { w: 14, h: 16 }, // 4 1st premolar
  { w: 13, h: 15 }, // 5 2nd premolar
  { w: 18, h: 14 }, // 6 1st molar
  { w: 18, h: 13 }, // 7 2nd molar
  { w: 15, h: 11 }, // 8 wisdom tooth
]

// ─── Straight-row geometry (replaces the arch math) ───────────────────────────
// Straight rows, not an arch: this chart is read at a glance next to a table, so
// even spacing and a flat label row beat anatomical curvature.
export const CHART_W = 460, CHART_H = 132
export const PITCH = 26, PAD = 35            // x_i = PAD + i*PITCH → 35…425
export const Y_UPPER = 24, Y_LOWER = 100     // rect anchors; bodies 24→44 / 80→100
export const Y_LABEL_UPPER = 13, Y_LABEL_LOWER = 119
export const MIDLINE_X = 230                 // between i=7 (217) and i=8 (243)

// ─── 4-state visual config ────────────────────────────────────────────────────
export interface ToothStateStyle {
  key: ToothStatus
  label: string        // Estonian
  fill: string
  stroke: string
  strokeWidth: number
  dash?: string
  opacity?: number
  labelFill: string
  detail: boolean      // draw bite line / molar ridges
}

// Hexes are the existing tokens: accent #0AB6C4, accent-dark #077080,
// accent-light #E6F7F9, ink-faint #A8B4BE, ink-muted #637381.
export const TOOTH_STATES: ToothStateStyle[] = [
  { key: 'toodeldud', label: 'Töödeldud',   fill: '#0AB6C4', stroke: '#077080', strokeWidth: 1.3, labelFill: '#077080', detail: true },
  { key: 'ravi',      label: 'Ravi olemas', fill: '#E6F7F9', stroke: '#0AB6C4', strokeWidth: 1.5, labelFill: '#0AB6C4', detail: true },
  { key: 'terve',     label: 'Terve',       fill: '#FFFFFF', stroke: '#A8B4BE', strokeWidth: 1.2, labelFill: '#637381', detail: true },
  { key: 'puudub',    label: 'Puudub',      fill: 'none',    stroke: '#A8B4BE', strokeWidth: 1,   dash: '3 2', opacity: 0.45, labelFill: '#A8B4BE', detail: false },
]

// Lookup by key
export const TOOTH_STATE_MAP = Object.fromEntries(
  TOOTH_STATES.map((s) => [s.key, s])
) as Record<ToothStatus, ToothStateStyle>

// Click cycle in the chart editor. Landing back on undefined clears the manual
// override and the tooth falls back to its derived state.
export const STATUS_CYCLE: (ManualToothStatus | undefined)[] = ['ravi', 'puudub', 'terve', undefined]
