import type { StageKey } from '../types/job'

export interface PipelineStage {
  key: StageKey
  label: string          // Estonian display label
  color: string          // Tailwind text color class
  bg: string             // Tailwind bg class (pill background)
  border: string         // Tailwind border class (column header accent)
  hex: string            // Raw hex for inline styles where needed
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
