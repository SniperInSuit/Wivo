import { motion } from 'framer-motion'
import { MessageSquare, ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import type { Job, StageKey } from '../../types/job'
import { jobWorkItems } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { useWorkTypes } from '../../stores/useSettings'
import { usePayments, useInvoices } from '../../hooks/useInvoices'
import { jobPaymentState } from '../../lib/jobPayments'
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
  const { data: allPayments = [] } = usePayments()
  // Invoices too: a job settled through an invoice has no payment row of its
  // own, and without them the card shows a paid job as unpaid forever.
  const { data: invoices = [] } = useInvoices()
  const pay = jobPaymentState(job, allPayments, invoices)
  const hasRevision = (job.revisions?.length ?? 0) > 0 || !!job.muudatused
  // Every job is a LIST of work items, one of them included: `jobWorkItems`
  // builds a single legacy item from `too`/`hambad` when a job has none. The
  // card used to branch on the count and render one-item jobs as plain grey
  // text, so two cards showing the same kind of thing looked like two kinds of
  // card. Colour is the fastest thing on a board to scan and the one-item job
  // was the only one not getting it.
  const workItems = jobWorkItems(job).filter(i => i.too?.trim())

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
      className={`card cursor-pointer select-none relative overflow-hidden hover:shadow-card-hover transition-all duration-150 ${
        isDragging ? 'opacity-50 rotate-1 shadow-panel' : ''
      }`}
      onClick={() => onClick(job)}
    >
      {/* Color strip — absolute, clips to card's border-radius via overflow-hidden */}
      <div className="absolute left-0 top-0 bottom-0 w-[4px] flex flex-col">
        {workItems.length > 0 ? (
          workItems.map(item => (
            <span key={item.id} className="flex-1" style={{ backgroundColor: wt.hex(item.too) }} />
          ))
        ) : (
          // Nothing named at all — a job can exist before anyone says what it is.
          <span className="flex-1" style={{ backgroundColor: wt.hex(job.too) }} />
        )}
        {job.mudel && <span className="flex-1" style={{ backgroundColor: '#F59E0B' }} />}
      </div>
      <div className="p-3.5 pl-[18px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-semibold text-sm text-ink leading-tight">{job.patsient}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          {job.mudel && (
            <span title="Mudel" className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1 py-0.5 rounded">
              M
            </span>
          )}
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
          {job.hind != null && (
            <span title={pay.settled ? `${job.hind} € makstud` : pay.partial ? `${pay.paid.toFixed(0)}/${job.hind} €` : `${job.hind} € maksmata`}
              className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                pay.settled
                  ? 'bg-emerald-100 text-emerald-700'
                  : pay.partial
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-red-100 text-red-600'
              }`}
            >
              {pay.settled ? '€ ✓' : pay.partial ? `€ ${Math.round(pay.paid / (job.hind || 1) * 100)}%` : '€'}
            </span>
          )}
        </div>
      </div>

      {/* Töö type(s) — a chip each, however many there are. */}
      {workItems.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-2">
          {workItems.map(item => (
            <span key={item.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${wt.hex(item.too)}20`, color: wt.hex(item.too) }}>
              {item.too}{item.bridge ? ' (sild)' : ''}
            </span>
          ))}
        </div>
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
      </div>
    </motion.div>
  )
}
