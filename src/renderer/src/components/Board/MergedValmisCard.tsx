/**
 * MergedValmisCard — shown in the double-wide Valmis column when a job has revisions.
 * Spans both grid columns. Revision is the prominent (left) side; original is the
 * smaller context (right) side.
 */
import { CornerDownLeft, Euro, Zap } from 'lucide-react'
import { toDate, fmtDate } from '../../lib/dates'
import type { Job } from '../../types/job'
import { DeadlineChip } from '../ui/DeadlineChip'
import { ShadeChip } from '../ui/ShadeChip'
import { ToothBadges } from '../ui/ToothBadges'
import { useWorkTypes, useSettings } from '../../stores/useSettings'
import { usePipeline } from '../../context/PipelineContext'

interface MergedValmisCardProps {
  job: Job
  onClick: () => void
}

export function MergedValmisCard({ job, onClick }: MergedValmisCardProps) {
  const { doneStageKey } = usePipeline()
  const wt = useWorkTypes()
  const { settings } = useSettings()
  const revisions = job.revisions ?? []
  // Show the most recently completed revision as the "active" one
  const latest = [...revisions]
    .filter(r => r.status === doneStageKey)
    .sort((a, b) => b.ts.localeCompare(a.ts))[0]
    ?? [...revisions].sort((a, b) => b.ts.localeCompare(a.ts))[0]
  if (!latest) return null

  // One colour, two strengths: the full hex for the edge, a 15% wash for the
  // panel. Previously this string-swapped a Tailwind class name ("border-l-blue-400"
  // → "bg-blue-100"), which could not survive colours becoming user-editable.
  const typeHex = wt.hex(job.too)

  return (
    <div
      onClick={onClick}
      className={`card cursor-pointer hover:shadow-card-hover transition-all duration-150
        overflow-hidden border-l-[3px] col-span-2`}
      style={{ borderLeftColor: typeHex }}
    >
      <div className="flex min-h-[100px]">

        {/* ── LEFT: Revision (focused / prominent) ── */}
        <div className="flex-[3] p-3.5 flex flex-col gap-1.5">
          {/* Badge row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5
              rounded bg-slate-700 text-slate-100">
              <CornerDownLeft size={9} />
              Muudatus #{revisions.length}
            </span>
            {latest.kiirtoo && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5
                rounded bg-orange-500/20 text-orange-400">
                <Zap size={8} /> {settings.kiirtooKordaja}×
              </span>
            )}
            {latest.price != null && (
              <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                {latest.price.toFixed(2)} €
              </span>
            )}
          </div>

          {/* Patient */}
          <p className="font-bold text-sm text-ink leading-tight">{job.patsient}</p>

          {/* Revision note */}
          <p className="text-xs text-ink-muted leading-snug line-clamp-2 mb-1">{latest.note}</p>

          {/* New color / material from revision */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {latest.varv && <ShadeChip shade={latest.varv} />}
            {latest.materjal && (
              <span className="text-[10px] text-ink-muted bg-bg-sidebar px-1.5 py-0.5 rounded-full truncate max-w-[110px]">
                {latest.materjal}
              </span>
            )}
          </div>

          {/* Revised teeth */}
          {latest.hambad && (
            <div className="mt-1">
              <ToothBadges hambad={latest.hambad} max={6} />
            </div>
          )}

          {/* Revision deadline */}
          {toDate(latest.deadline) && (
            <p className="text-[10px] text-ink-faint font-mono mt-auto pt-1">
              → {fmtDate(latest.deadline, 'dd.MM.yy HH:mm')}
            </p>
          )}
        </div>

        {/* ── Divider ── */}
        <div className="w-px bg-ink-faint/10 self-stretch" />

        {/* ── RIGHT: Original (context / smaller) ── */}
        <div className="flex-[2] p-3 flex flex-col gap-1" style={{ backgroundColor: `${typeHex}18` }}>
          <p className="text-[9px] font-bold text-ink-faint uppercase tracking-wider mb-0.5">
            Originaal
          </p>
          <p className="font-semibold text-xs text-ink-muted leading-tight">{job.patsient}</p>
          {job.too && (
            <p className="text-[10px] text-ink-faint truncate">{job.too}</p>
          )}
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            {job.varv && <ShadeChip shade={job.varv} />}
            {job.materjal && (
              <span className="text-[9px] text-ink-faint bg-bg-sidebar px-1.5 py-0.5 rounded-full truncate max-w-[90px]">
                {job.materjal}
              </span>
            )}
          </div>
          {job.hind != null && (
            <div className="flex items-center gap-1 text-[10px] text-ink-faint mt-auto">
              <Euro size={9} />
              <span className={job.makstud ? 'text-green-600 font-semibold' : 'text-red-400 font-semibold'}>
                {job.hind.toFixed(2)} €
              </span>
              {job.makstud && <span className="text-green-500 text-[9px]">✓</span>}
            </div>
          )}
          {job.valmis_aeg && (
            <div className="mt-0.5">
              <DeadlineChip deadline={job.valmis_aeg} compact isDone />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
