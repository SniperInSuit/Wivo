import { useState } from 'react'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { startOfWeek, endOfWeek, addWeeks, parseISO, isWithinInterval, format } from 'date-fns'
import type { Job, StageKey, Revision } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { BoardColumn } from './BoardColumn'

// ── Discriminated union for board entries ─────────────────────────────────────
export type BoardEntry =
  | { type: 'job'; job: Job }
  | { type: 'rev'; job: Job; rev: Revision; revNum: number }

interface BoardProps {
  jobs: Job[]
  loading: boolean
  onJobClick: (job: Job) => void
  onStageChange: (jobId: string, stage: StageKey) => void
  onRevisionStageChange?: (jobId: string, revId: string, stage: StageKey) => void
  onRevisionClick?: (job: Job, revId: string) => void
}

export function Board({
  jobs, loading, onJobClick, onStageChange, onRevisionStageChange, onRevisionClick,
}: BoardProps) {
  const [weekOffset, setWeekOffset] = useState(0)
  const { stages, doneStageKey } = usePipeline()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    )
  }

  const baseDate  = addWeeks(new Date(), weekOffset)
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 })
  const weekEnd   = endOfWeek(baseDate,   { weekStartsOn: 1 })
  const weekLabel = `${format(weekStart, 'd. MMM')} – ${format(weekEnd, 'd. MMM')}`
  const isCurrentWeek = weekOffset === 0

  // ── Build per-stage entry lists ─────────────────────────────────────────────
  const byStage: Record<StageKey, BoardEntry[]> =
    Object.fromEntries(stages.map(s => [s.key, []])) as Record<StageKey, BoardEntry[]>

  const totalDone = jobs.filter(j => j.status === doneStageKey).length

  jobs.forEach(job => {
    const revs = job.revisions ?? []

    // Active revisions (not yet in done stage) → each gets its own card
    revs.forEach((rev, i) => {
      const revStage = rev.status ?? stages[0]?.key ?? doneStageKey
      if (revStage !== doneStageKey && byStage[revStage]) {
        byStage[revStage].push({ type: 'rev', job, rev, revNum: i + 1 })
      }
    })

    // Original job card
    if (job.status === doneStageKey) {
      // Week filter: show if original job OR any completed revision falls in this week
      const inWeek = (dateStr: string) => {
        try { return isWithinInterval(parseISO(dateStr), { start: weekStart, end: weekEnd }) }
        catch { return false }
      }
      const doneRevDates = revs
        .filter(r => r.status === doneStageKey)
        .map(r => r.deadline ?? r.ts)
      const appearsThisWeek = inWeek(job.kuupaev) || doneRevDates.some(inWeek)
      if (byStage[doneStageKey] && appearsThisWeek) {
        byStage[doneStageKey].push({ type: 'job', job })
      }
    } else if (byStage[job.status]) {
      byStage[job.status].push({ type: 'job', job })
    }
  })

  return (
    <div className="flex gap-3 h-full overflow-x-auto pb-4 px-4 pt-2">
      {stages.map((stage) => (
        <BoardColumn
          key={stage.key}
          stage={stage}
          entries={byStage[stage.key] ?? []}
          onJobClick={onJobClick}
          onDrop={onStageChange}
          onStageChange={onStageChange}
          onRevisionStageChange={onRevisionStageChange}
          onRevisionClick={onRevisionClick}
          wide={stage.key === doneStageKey}
          totalCount={stage.key === doneStageKey ? totalDone : undefined}
          weekLabel={stage.key === doneStageKey ? weekLabel : undefined}
          isCurrentWeek={stage.key === doneStageKey ? isCurrentWeek : undefined}
          onPrevWeek={stage.key === doneStageKey ? () => setWeekOffset(o => o - 1) : undefined}
          onNextWeek={stage.key === doneStageKey ? () => setWeekOffset(o => o + 1) : undefined}
          onThisWeek={stage.key === doneStageKey ? () => setWeekOffset(0) : undefined}
        />
      ))}
    </div>
  )
}
