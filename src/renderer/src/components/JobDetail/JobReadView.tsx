import { Calendar, Cpu, Euro, Hash, User, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { ShadeChip } from '../ui/ShadeChip'
import { ToothBadges } from '../ui/ToothBadges'
import { StatusPill } from '../ui/StatusPill'

interface JobReadViewProps {
  job: Job
  isBottom: boolean
  highlightRevisionId?: string
}

function fmt(value: string | null | undefined, pattern: string): string {
  if (!value) return '—'
  const d = parseISO(value)
  return isValid(d) ? format(d, pattern) : '—'
}

const toothCount = (s: string | null | undefined) =>
  s ? s.split(',').filter(t => t.trim()).length : 0

/**
 * Read-only view of a job. Opening an existing job lands here — the full edit
 * form only appears after pressing "Muuda", so looking a job up does not put
 * every field one stray keystroke away from being changed.
 */
export function JobReadView({ job, isBottom, highlightRevisionId }: JobReadViewProps) {
  const { stageMap } = usePipeline()
  const revisions = job.revisions ?? []
  const revTotal = revisions.reduce((s, r) => s + (r.price ?? 0), 0)
  const total = (job.hind ?? 0) + revTotal

  return (
    <div className={isBottom ? 'px-6 py-5 grid grid-cols-2 gap-x-8 items-start' : 'px-6 py-5 space-y-5'}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={job.status} size="md" />
          {job.kiirtoo && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-300 rounded-lg px-2 py-1">
              <Zap size={12} className="text-orange-500 fill-orange-400" />
              Kiirtöö
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Row label="Kuupäev" icon={Calendar} value={fmt(job.kuupaev, 'dd.MM.yyyy')} />
          <Row label="Patsient" icon={User} value={job.patsient || '—'} />
        </div>

        <Row label="Töö" value={job.too || '—'} big />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="label">Materjal</p>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-ink-soft">{job.materjal || '—'}</span>
              <ShadeChip shade={job.varv} />
            </div>
          </div>
          <Row label="Masin" icon={Cpu} value={job.masina || '—'} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Row label="Print ID" icon={Hash} value={job.print_id || '—'} />
          <Row label="Valmis aeg" icon={Calendar} value={fmt(job.valmis_aeg, 'dd.MM.yyyy HH:mm')} />
        </div>
      </div>

      <div className={isBottom ? 'space-y-5' : 'space-y-5 pt-5'}>
        <div>
          <p className="label">Hambad (FDI)</p>
          {toothCount(job.hambad) > 0 ? (
            <>
              <ToothBadges hambad={job.hambad} max={32} />
              <p className="text-[11px] text-ink-faint mt-1">{toothCount(job.hambad)} hammast</p>
            </>
          ) : (
            <p className="text-sm text-ink-faint">—</p>
          )}
        </div>

        <div className="border border-ink-faint/20 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-ink flex items-center gap-2">
            <Euro size={15} className="text-accent" />
            Hind ja maksmine
          </p>
          <Line label="Töö hind" value={`${(job.hind ?? 0).toFixed(2)} €`} />
          {job.disain_hind != null && <Line label="Disain" value={`${job.disain_hind.toFixed(2)} €`} />}
          {revisions.length > 0 && <Line label={`Muudatused (${revisions.length})`} value={`${revTotal.toFixed(2)} €`} />}
          <div className="flex items-center justify-between pt-2 border-t border-ink-faint/15">
            <span className="text-sm font-semibold text-ink">Kokku</span>
            <span className="text-sm font-bold text-ink">{total.toFixed(2)} €</span>
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${job.makstud ? 'text-emerald-600' : 'text-orange-600'}`}>
              {job.makstud ? 'Makstud' : 'Maksmata'}
            </span>
            {job.makstud && job.makse_kuupaev && (
              <span className="text-[11px] text-ink-faint">{fmt(job.makse_kuupaev, 'dd.MM.yyyy')}</span>
            )}
          </div>
        </div>

        {revisions.length > 0 && (
          <div className="space-y-2">
            <p className="label">Muudatused</p>
            {revisions.map((r, i) => (
              <div
                key={r.id}
                className={`rounded-xl border p-3 space-y-1 ${
                  r.id === highlightRevisionId
                    ? 'border-accent bg-accent/5'
                    : 'border-ink-faint/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-ink-muted">#{i + 1}</span>
                  <span className="text-xs text-ink-muted">
                    {stageMap[r.status ?? job.status]?.label ?? r.status ?? ''}
                  </span>
                  {r.kiirtoo && <Zap size={11} className="text-orange-500 fill-orange-400" />}
                  {r.price != null && (
                    <span className="ml-auto text-xs font-semibold text-ink">{r.price.toFixed(2)} €</span>
                  )}
                </div>
                {r.note?.trim() && <p className="text-sm text-ink-soft whitespace-pre-wrap">{r.note}</p>}
                {r.hambad && <ToothBadges hambad={r.hambad} max={12} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, icon: Icon, value, big }: {
  label: string
  icon?: LucideIcon
  value: string
  big?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="label flex items-center gap-1">
        {Icon && <Icon size={11} className="text-ink-faint" />}
        {label}
      </p>
      <p className={`${big ? 'text-base font-semibold' : 'text-sm'} text-ink-soft truncate`} title={value}>
        {value}
      </p>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink font-medium">{value}</span>
    </div>
  )
}
