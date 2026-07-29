import type React from 'react'
import type { StageKey } from '../types/job'

export interface PipelineStage {
  key: StageKey
  label: string          // Estonian display label
  hex: string            // THE colour. Everything renders from this.
  // ─── LEGACY, do not render from these ─────────────────────────────────────
  // Tailwind class names, kept only so stages saved in localStorage before
  // 1.1.7 still parse. A user-picked colour (Seaded → Töö etapid) can never be
  // a Tailwind class, so anything reading these silently keeps the OLD colour
  // after a recolour — that was the 1.3.2 bug, in four separate places.
  // Use stageChipStyle(hex) or an inline style instead.
  color: string
  bg: string
  border: string
}

// Ordered list — matches physical workflow; easy to reorder/rename here
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    key: 'disain',
    label: 'Disain',
    color: 'text-indigo-700',
    bg: 'bg-indigo-100',
    border: 'border-indigo-400',
    hex: '#6366F1'
  },
  {
    key: 'print',
    label: 'Printimine',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    border: 'border-amber-400',
    hex: '#F59E0B'
  },
  {
    key: 'poleeri',
    label: 'Poleerimine',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    border: 'border-emerald-400',
    hex: '#10B981'
  },
  {
    key: 'puhasta',
    label: 'Puhastamine',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    border: 'border-blue-400',
    hex: '#3B82F6'
  },
  {
    key: 'varvi',
    label: 'Värvimine',
    color: 'text-pink-700',
    bg: 'bg-pink-100',
    border: 'border-pink-400',
    hex: '#EC4899'
  },
  {
    key: 'valmis',
    label: 'Valmis',
    color: 'text-green-700',
    bg: 'bg-green-100',
    border: 'border-green-400',
    hex: '#22C55E'
  }
]

// Lookup by key
export const STAGE_MAP = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.key, s])
) as Record<StageKey, PipelineStage>

// Pill styling derived from a stage's hex, so a user-picked colour works. The
// Tailwind `color`/`bg`/`border` fields above are only defaults for new stages —
// nothing renders from them any more, because an arbitrary hex cannot be a class.
export function stageChipStyle(hex: string): React.CSSProperties {
  return {
    backgroundColor: `${hex}1f`,   // ~12% tint
    color: hex,
    boxShadow: `inset 0 0 0 1px ${hex}59`
  }
}
