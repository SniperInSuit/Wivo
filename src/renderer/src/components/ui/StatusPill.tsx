import type { StageKey } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { stageChipStyle } from '../../config/pipeline'

interface StatusPillProps {
  status: StageKey
  size?: 'sm' | 'md'
}

export function StatusPill({ status, size = 'sm' }: StatusPillProps) {
  const { stageMap } = usePipeline()
  const stage = stageMap[status]
  if (!stage) return null

  return (
    <span
      // Coloured from stage.hex so a recoloured stage (Seaded → Töö etapid)
      // shows its own colour everywhere the pill appears.
      style={stageChipStyle(stage.hex)}
      className={`inline-flex items-center font-medium rounded-full ${
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'
      }`}
    >
      {stage.label}
    </span>
  )
}
