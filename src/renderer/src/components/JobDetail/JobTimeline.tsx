import { Check } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'

interface JobTimelineProps {
  job: Job
  // Stage to render as current. A revision carries its own pipeline stage, so
  // when one is being viewed the timeline must follow it, not the parent job.
  status?: string
  finishedAt?: string | null
}

/**
 * The production backbone of the job record — always visible, including after
 * completion, so the page reads as "here is how this restoration was made"
 * rather than "here is a status field".
 *
 * Stage order comes from the user's own pipeline (Seaded → Töövoog), so a custom
 * or reordered pipeline is reflected here without changes.
 */
export function JobTimeline({ job, status, finishedAt: finishedAtProp }: JobTimelineProps) {
  const { stages, doneStageKey } = usePipeline()

  const active = status ?? job.status
  const currentIndex = stages.findIndex(s => s.key === active)
  const isDone = active === doneStageKey
  // A stage the pipeline no longer contains (renamed or deleted in Seaded)
  // leaves currentIndex at -1 — nothing is marked complete rather than everything.
  const reached = (i: number) => (isDone ? true : currentIndex >= 0 && i <= currentIndex)

  const raw = finishedAtProp !== undefined ? finishedAtProp : job.valmis_aeg
  const finishedAt = raw ? parseISO(raw) : null

  return (
    <div className="px-6 py-4 border-b border-ink-faint/15 flex-shrink-0">
      <div className="flex items-start">
        {stages.map((s, i) => {
          const done = reached(i)
          const isCurrent = !isDone && i === currentIndex
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center min-w-0">
              <div className="flex items-center w-full">
                {/* Left half of the connector — hidden on the first node */}
                <span
                  className={`h-[2px] flex-1 ${i === 0 ? 'opacity-0' : ''}`}
                  style={{ backgroundColor: reached(i) ? s.hex : '#E2E8EC' }}
                />
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{
                    backgroundColor: done ? s.hex : '#FFFFFF',
                    border: `2px solid ${done ? s.hex : '#D3DBE1'}`,
                    boxShadow: isCurrent ? `0 0 0 3px ${s.hex}33` : undefined
                  }}
                >
                  {done && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                {/* Right half — hidden on the last node */}
                <span
                  className={`h-[2px] flex-1 ${i === stages.length - 1 ? 'opacity-0' : ''}`}
                  style={{ backgroundColor: reached(i + 1) ? stages[i + 1]?.hex ?? s.hex : '#E2E8EC' }}
                />
              </div>
              <span
                className={`mt-1.5 text-[10px] text-center leading-tight truncate w-full px-0.5 ${
                  done ? 'font-semibold text-ink' : 'text-ink-faint'
                }`}
                title={s.label}
              >
                {s.label}
              </span>
            </div>
          )
        })}
      </div>

      {isDone && finishedAt && isValid(finishedAt) && (
        <p className="text-center text-[11px] text-ink-muted mt-2">
          Valmis {format(finishedAt, 'dd.MM.yyyy')} kell {format(finishedAt, 'HH:mm')}
        </p>
      )}
    </div>
  )
}
