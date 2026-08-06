/**
 * RevisionBoardCard — shown alongside the original job card in non-Valmis columns
 * when a job has one or more active revisions.
 */
import { motion } from 'framer-motion'
import { CornerDownLeft, ChevronLeft, ChevronRight, Euro, Zap } from 'lucide-react'
import type { Job, StageKey, Revision } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useWorkTypes } from '../../stores/useSettings'
import { DeadlineChip } from '../ui/DeadlineChip'

interface RevisionBoardCardProps {
  job: Job
  revision: Revision
  revIndex: number        // 1-based display number
  onClick: () => void
  onRevisionStageChange?: (job: Job, revId: string, stage: StageKey) => void
  isDragging?: boolean
}

export function RevisionBoardCard({
  job, revision, revIndex, onClick, onRevisionStageChange, isDragging,
}: RevisionBoardCardProps) {
  const { stages, doneStageKey } = usePipeline()
  const wt = useWorkTypes()
  const revStage  = revision.status ?? stages[0]?.key ?? 'disain'
  const stageIdx  = stages.findIndex(s => s.key === revStage)
  const prevStage = stageIdx > 0 ? stages[stageIdx - 1] : null
  const nextStage = stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      className={`card cursor-pointer select-none relative overflow-hidden
        hover:shadow-card-hover transition-all duration-150
        ${isDragging ? 'opacity-50 rotate-1 shadow-panel' : ''}`}
    >
      {/* Color strip */}
      <div className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ backgroundColor: wt.hex(job.too) }} />
      <div className="p-3.5 pl-[18px]">
      {/* ── Navy muudatus badge ── */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded
          bg-slate-700 text-slate-100">
          <CornerDownLeft size={9} />
          Muudatus #{revIndex}
        </span>
        {(revision.mudel || job.mudel) && (
          <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded">M</span>
        )}
        {revision.taspidev === false && (
          <span className="text-[9px] font-bold bg-red-100 text-red-600 px-1 py-0.5 rounded">Tasustamata</span>
        )}
        {revision.kiirtoo && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded
            bg-orange-500/20 text-orange-400">
            <Zap size={8} /> 2×
          </span>
        )}
        {revision.price != null && (
          <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">
            {revision.price.toFixed(2)} €
          </span>
        )}
      </div>

      {/* Patient + work type */}
      <p className="font-semibold text-sm text-ink leading-tight mb-1">{job.patsient}</p>
      {job.too && <p className="text-xs text-ink-muted truncate mb-1.5">{job.too}</p>}

      {/* Revision note */}
      <p className="text-xs text-slate-500 italic line-clamp-2 mb-2 leading-snug">{revision.note}</p>

      {/* Deadline */}
      {revision.deadline && (
        <DeadlineChip deadline={revision.deadline} compact isDone={revStage === doneStageKey} />
      )}

      {/* Stage nav — same job moves through pipeline */}
      {onRevisionStageChange && (prevStage || nextStage) && (
        <div className="flex items-center mt-2.5 pt-2 border-t border-ink-faint/10 gap-1">
          {prevStage ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRevisionStageChange(job, revision.id, prevStage.key) }}
              className="flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-ink
                font-medium px-1.5 py-1 rounded-md hover:bg-bg-sidebar transition-colors"
            >
              <ChevronLeft size={11} /> {prevStage.label}
            </button>
          ) : <div className="flex-1" />}
          {nextStage && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRevisionStageChange(job, revision.id, nextStage.key) }}
              className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-1
                rounded-md ml-auto transition-all hover:opacity-80"
              style={{ color: nextStage.hex, background: `${nextStage.hex}18` }}
            >
              {nextStage.label} <ChevronRight size={11} />
            </button>
          )}
        </div>
      )}
      </div>
    </motion.div>
  )
}
