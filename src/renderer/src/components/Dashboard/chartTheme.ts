/**
 * Chart chrome shared by every statistics panel.
 *
 * These constants lived inside Dashboard.tsx, which was fine while one file drew
 * every chart. Panels are separate modules now, and a colour list or an axis
 * width copied into each of them is a set of charts that drift apart one commit
 * at a time — different palettes on the same screen, labels clipped in one panel
 * and not the next.
 */

/** Series palette. Order is meaningful: index 0 is the accent. */
export const CHART_COLORS = ['#0AB6C4', '#6366F1', '#F59E0B', '#10B981', '#EC4899', '#3B82F6']

/** Recharts tooltip chrome — matches the card surface in every theme. */
export const TOOLTIP_STYLE = {
  background: 'rgb(var(--c-bg-card))',
  border: '1px solid rgb(var(--c-ink-faint) / 0.25)',
  borderRadius: 12,
  fontSize: 12,
  color: 'rgb(var(--c-ink))',
} as const

// ─── Horizontal bar chart sizing ──────────────────────────────────────────────
// Recharts' default category-axis `interval` is "preserveEnd", which silently
// DROPS labels that do not fit — at a fixed 180px with 8 rows that meant the top
// bar (the biggest patient) rendered with no name at all. interval={0} forces
// every label, so the height has to grow with the row count instead.
const ROW_HEIGHT = 26

export const rowChartHeight = (rows: number): number => Math.max(120, rows * ROW_HEIGHT)

/** The axis reserves this much for names; longer ones are clipped, not overdrawn. */
export const NAME_AXIS_WIDTH = 118

const NAME_MAX_CHARS = 17

export const truncateName = (v: string): string =>
  v.length > NAME_MAX_CHARS ? `${v.slice(0, NAME_MAX_CHARS - 1)}…` : v
