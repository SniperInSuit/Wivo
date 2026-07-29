import { useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Job, StageKey } from '../../types/job'
import type { PipelineStage } from '../../config/pipeline'
import type { BoardEntry } from './Board'
import { usePipeline } from '../../context/PipelineContext'
import { JobCard } from './JobCard'
import { RevisionBoardCard } from './RevisionBoardCard'
import { MergedValmisCard } from './MergedValmisCard'

interface BoardColumnProps {
  stage: PipelineStage
  entries: BoardEntry[]
  onJobClick: (job: Job) => void
  onDrop: (jobId: string, targetStage: StageKey) => void
  onStageChange: (jobId: string, stage: StageKey) => void
  onRevisionStageChange?: (jobId: string, revId: string, stage: StageKey) => void
  onRevisionClick?: (job: Job, revId: string) => void
  wide?: boolean
  totalCount?: number
  // Valmis week navigation
  weekLabel?: string
  isCurrentWeek?: boolean
  onPrevWeek?: () => void
  onNextWeek?: () => void
  onThisWeek?: () => void
}

export function BoardColumn({
  stage, entries, onJobClick, onDrop, onStageChange,
  onRevisionStageChange, onRevisionClick,
  wide, totalCount, weekLabel, isCurrentWeek, onPrevWeek, onNextWeek, onThisWeek,
}: BoardColumnProps) {
  const { doneStageKey } = usePipeline()
  const [isDragOver, setIsDragOver] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const columnRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.DragEvent, jobId: string) => {
    e.dataTransfer.setData('jobId', jobId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(jobId)
  }
  const handleDragEnd   = () => setDraggingId(null)
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDragOver(true) }
  const handleDragLeave = (e: React.DragEvent) => { if (!columnRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false) }
  const handleDrop      = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); const id = e.dataTransfer.getData('jobId'); if (id) onDrop(id, stage.key) }

  const jobCount = entries.filter(e => e.type === 'job').length

  return (
    <div className={`flex flex-col flex-shrink-0 ${wide ? 'min-w-[500px] w-[500px]' : 'min-w-[240px] w-[240px]'}`}>
      {/* ── Column header ── */}
      {/* Accent bar from stage.hex, not the legacy Tailwind border class — a
          user-picked colour can never be a class, so the class field goes stale
          the moment a stage is recoloured in Seaded. */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-card border-t-2 bg-bg-card mb-0.5"
        style={{ borderTopColor: stage.hex }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stage.hex }} />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="font-semibold text-sm text-ink">{stage.label}</span>
            {totalCount !== undefined && (
              <span className="text-[10px] text-ink-faint font-normal">see nädal · kokku {totalCount}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Week navigation (Valmis only) */}
          {weekLabel && (
            <>
              <button onClick={onPrevWeek} className="p-0.5 rounded hover:bg-bg-sidebar text-ink-faint hover:text-ink transition-colors">
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={!isCurrentWeek ? onThisWeek : undefined}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                  isCurrentWeek
                    ? 'text-ink-muted cursor-default'
                    : 'text-accent hover:bg-accent/10 cursor-pointer'
                }`}
              >
                {weekLabel}
              </button>
              <button onClick={onNextWeek} className="p-0.5 rounded hover:bg-bg-sidebar text-ink-faint hover:text-ink transition-colors">
                <ChevronRight size={14} />
              </button>
            </>
          )}

          <span className="text-xs font-bold text-ink-muted bg-bg-sidebar px-2 py-0.5 rounded-full ml-1">
            {jobCount}
          </span>
        </div>
      </div>

      {/* ── Drop zone ── */}
      <div
        ref={columnRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 min-h-[200px] p-2 rounded-b-card transition-colors duration-150
          ${wide ? 'grid grid-cols-2 gap-2 content-start' : 'flex flex-col gap-2'}
          ${isDragOver ? 'bg-accent-light ring-2 ring-accent/30' : 'bg-bg-sidebar/60'}`}
      >
        <AnimatePresence mode="popLayout">
          {entries.map(entry => {
            if (entry.type === 'rev') {
              return (
                <div
                  key={`rev-${entry.job.id}-${entry.rev.id}`}
                  draggable
                  onDragStart={e => handleDragStart(e, entry.job.id)}
                  onDragEnd={handleDragEnd}
                >
                  <RevisionBoardCard
                    job={entry.job}
                    revision={entry.rev}
                    revIndex={entry.revNum}
                    onClick={() => onRevisionClick?.(entry.job, entry.rev.id)}
                    onRevisionStageChange={onRevisionStageChange
                      ? (j, revId, s) => onRevisionStageChange(j.id, revId, s)
                      : undefined}
                    isDragging={draggingId === entry.job.id}
                  />
                </div>
              )
            }

            // 'job' entry in wide (done) column → check for completed revisions
            if (wide) {
              const hasCompletedRevs = (entry.job.revisions ?? []).some(r => r.status === doneStageKey)
              if (hasCompletedRevs) {
                return (
                  <div
                    key={entry.job.id}
                    className="col-span-2"
                    draggable
                    onDragStart={e => handleDragStart(e, entry.job.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <MergedValmisCard job={entry.job} onClick={() => onJobClick(entry.job)} />
                  </div>
                )
              }
            }

            // Normal job card
            return (
              <div
                key={entry.job.id}
                draggable
                onDragStart={e => handleDragStart(e, entry.job.id)}
                onDragEnd={handleDragEnd}
              >
                <JobCard
                  job={entry.job}
                  onClick={onJobClick}
                  onStageChange={(j, s) => onStageChange(j.id, s)}
                  isDragging={draggingId === entry.job.id}
                />
              </div>
            )
          })}
        </AnimatePresence>

        {entries.length === 0 && !isDragOver && (
          <div className={`flex items-center justify-center py-6 ${wide ? 'col-span-2' : ''}`}>
            <p className="text-xs text-ink-faint text-center">Tühi</p>
          </div>
        )}
      </div>
    </div>
  )
}
