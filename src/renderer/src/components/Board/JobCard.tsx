import { motion } from 'framer-motion'
import { MessageSquare, Euro, ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import type { Job, StageKey } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useWorkTypes } from '../../stores/useSettings'
import { DeadlineChip } from '../ui/DeadlineChip'
import { ShadeChip } from '../ui/ShadeChip'
import { ToothBadges } from '../ui/ToothBadges'

interface JobCardProps {
  job: Job
  onClick: (job: Job) => void
  onStageChange?: (job: Job, stage: StageKey) => void
  isDragging?: boolean
}

export function JobCard({ job, onClick, onStageChange, isDragging }: JobCardProps) {
  const { stages } = usePipeline()
  const wt = useWorkTypes()
  const hasRevision = (job.revisions?.length ?? 0) > 0 || !!job.muudatused

  const stageIdx  = stages.findIndex(s => s.key === job.status)
  const prevStage = stageIdx > 0 ? stages[stageIdx - 1] : null
  const nextStage = stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null

  return (
    <motion.div
      layout
      layoutId={job.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={`card p-3.5 cursor-pointer select-none border-l-[3px] border border-transparent hover:border-accent/20 hover:shadow-card-hover transition-all duration-150 ${
        isDragging ? 'opacity-50 rotate-1 shadow-panel' : ''
      }`}
      style={{ borderLeftColor: wt.hex(job.too) }}
      onClick={() => onClick(job)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-semibold text-sm text-ink leading-tight">{job.patsient}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          {job.kiirtoo && (
            <span title="Kiirtöö">
              <Zap size={13} className="text-orange-500" />
            </span>
          )}
          {hasRevision && (
            <span title="Muudatused">
              <MessageSquare size={13} className="text-amber-500" />
            </span>
          )}
          {job.hind != null && !job.makstud && (
            <span title={`${job.hind} € maksmata`}>
              <Euro size={13} className="text-red-400" />
            </span>
          )}
        </div>
      </div>

      {/* Töö type */}
      {job.too && (
        <p className="text-xs text-ink-muted mb-2 truncate">{job.too}</p>
      )}

      {/* Tooth badges */}
      {job.hambad && (
        <div className="mb-2">
          <ToothBadges hambad={job.hambad} max={5} />
        </div>
      )}

      {/* Shade + Material row */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {job.varv && <ShadeChip shade={job.varv} />}
        {job.materjal && (
          <span className="text-xs text-ink-muted bg-bg-sidebar px-2 py-0.5 rounded-full truncate max-w-[120px]">
            {job.materjal}
          </span>
        )}
      </div>

      {/* Deadline */}
      {job.valmis_aeg && (
        <DeadlineChip deadline={job.valmis_aeg} compact isDone={job.status === stages[stages.length - 1]?.key} />
      )}

      {/* Stage nav */}
      {onStageChange && (prevStage || nextStage) && (
        <div className="flex items-center mt-2.5 pt-2 border-t border-ink-faint/10 gap-1">
          {prevStage ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onStageChange(job, prevStage.key) }}
              className="flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-ink font-medium px-1.5 py-1 rounded-md hover:bg-bg-sidebar transition-colors"
            >
              <ChevronLeft size={11} />
              {prevStage.label}
            </button>
          ) : <div className="flex-1" />}

          {nextStage && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onStageChange(job, nextStage.key) }}
              className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-1 rounded-md ml-auto transition-all hover:opacity-80"
              style={{ color: nextStage.hex, background: `${nextStage.hex}18` }}
            >
              {nextStage.label}
              <ChevronRight size={11} />
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}
