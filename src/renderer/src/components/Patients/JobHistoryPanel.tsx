import { CornerDownRight, Stethoscope, Zap } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job, Revision } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { ShadeChip } from '../ui/ShadeChip'
import { ToothBadges } from '../ui/ToothBadges'
import { PanelCard } from './PanelCard'
import { jobTotal } from './derive'

interface JobHistoryPanelProps {
  jobs: Job[]
  orderRefs: Map<string, string>
  onJobClick: (job: Job) => void
  onRevisionClick?: (job: Job, revisionId: string) => void
}

// One rendered line. A revision is its own piece of work — own teeth, own price,
// own deadline, own pipeline stage — so it gets its own row instead of being
// hidden inside a count. It stays tied to its parent job through the indent and
// the -M1 order-ref suffix.
interface Line {
  key: string
  job: Job
  revision: Revision | null
  index: number       // 1-based revision number; 0 for the parent job
}

function buildLines(jobs: Job[]): Line[] {
  const out: Line[] = []
  // Newest job first; revisions follow their parent oldest → newest so each
  // group reads as the actual order the work happened in.
  const sorted = [...jobs].sort((a, b) => (b.kuupaev ?? '').localeCompare(a.kuupaev ?? ''))
  for (const j of sorted) {
    out.push({ key: j.id, job: j, revision: null, index: 0 })
    const revs = [...(j.revisions ?? [])].sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''))
    revs.forEach((r, i) => out.push({ key: `${j.id}:${r.id}`, job: j, revision: r, index: i + 1 }))
    // Legacy imported revision — lives in the old flat columns until the job is
    // opened and saved once. Without this it stays invisible here while still
    // counting toward the patient's teeth and totals.
    if (revs.length === 0 && (j.muudatused || j.rev_hambad)) {
      out.push({
        key: `${j.id}:legacy`,
        job: j,
        revision: {
          id: 'legacy',
          ts: j.updated_at,
          note: j.muudatused ?? '',
          hambad: j.rev_hambad ?? undefined,
          varv: j.rev_varv ?? undefined,
          deadline: j.uus_valmis ?? undefined
        },
        index: 1
      })
    }
  }
  return out
}

export function JobHistoryPanel({ jobs, orderRefs, onJobClick, onRevisionClick }: JobHistoryPanelProps) {
  const { stageMap } = usePipeline()
  const lines = buildLines(jobs)
  const revisionCount = lines.filter(l => l.revision).length

  // Distinct stages appearing in these rows, in pipeline order
  const usedStages = (() => {
    const keys = new Set(lines.map(l => (l.revision?.status ?? l.job.status)))
    return [...keys].map(k => stageMap[k]).filter(Boolean)
  })()

  return (
    <PanelCard
      title="TÖÖDE AJALUGU"
      icon={Stethoscope}
      action={
        <span className="text-[11px] text-ink-muted">
          {jobs.length} tööd{revisionCount > 0 && ` · ${revisionCount} muudatust`}
        </span>
      }
    >
      {lines.length === 0 ? (
        <p className="text-sm text-ink-muted">Sellel patsiendil pole veel töid.</p>
      ) : (
        // The table is intrinsically wider than the column it sits in — it must
        // scroll inside itself, never widen the profile.
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-faint/15">
                <Th>Tellimus</Th>
                <Th>Töö</Th>
                <Th>Materjal / Värv</Th>
                <Th>Hambad</Th>
                <Th align="right">Hind</Th>
                <Th>Makstud</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ key, job, revision, index }) => {
                const isRev = revision != null
                const ref = orderRefs.get(job.id) ?? '—'
                const date = isRev ? revision.ts : job.kuupaev
                const d = date ? parseISO(date) : null
                const status = isRev ? (revision.status ?? job.status) : job.status
                const teeth = isRev ? (revision.hambad ?? null) : job.hambad
                const shade = isRev ? (revision.varv ?? null) : job.varv
                const material = isRev ? (revision.materjal ?? null) : job.materjal
                const price = isRev ? (revision.price ?? 0) : (job.hind ?? 0)

                return (
                  <tr
                    key={key}
                    onClick={() =>
                      isRev && revision.id !== 'legacy' && onRevisionClick
                        ? onRevisionClick(job, revision.id)
                        : onJobClick(job)
                    }
                    className={`border-b border-ink-faint/10 last:border-0 cursor-pointer transition-colors ${
                      isRev ? 'bg-bg-sidebar/40 hover:bg-bg-sidebar' : 'hover:bg-bg-sidebar'
                    }`}
                  >
                    {/* Stage is the coloured edge, not a text column — an inset
                        shadow so it costs no layout width. Legend is below the
                        table. */}
                    <td
                      className="py-1.5 pl-2.5 pr-3 whitespace-nowrap"
                      style={{ boxShadow: `inset 3px 0 0 ${stageMap[status]?.hex ?? '#A8B4BE'}` }}
                      title={stageMap[status]?.label ?? status}
                    >
                      <span className={`flex items-center gap-1 font-mono text-[11px] text-ink-muted ${isRev ? 'pl-2' : ''}`}>
                        {isRev && <CornerDownRight size={10} className="text-ink-faint flex-shrink-0" />}
                        {isRev ? `${ref}-M${index}` : ref}
                      </span>
                      <span className={`block text-[10px] text-ink-faint ${isRev ? 'pl-5' : ''}`}>
                        {d && isValid(d) ? format(d, 'dd.MM.yyyy') : '—'}
                      </span>
                    </td>
                    <td className={`py-2 pr-3 ${isRev ? 'text-ink-soft' : 'text-ink font-medium'}`}>
                      <span className="flex items-center gap-1.5">
                        {isRev
                          ? (revision.note?.trim() || 'Muudatus')
                          : (job.too ?? 'Määramata töö')}
                        {(isRev ? revision.kiirtoo : job.kiirtoo) && (
                          <Zap size={11} className="text-orange-500 fill-orange-400 flex-shrink-0" />
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-ink-soft">{material ?? '—'}</span>
                        <ShadeChip shade={shade} />
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <ToothBadges hambad={teeth} max={4} />
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-ink whitespace-nowrap">
                      {price.toFixed(2)} €
                    </td>
                    <td
                      className={`py-2 text-[11px] font-medium whitespace-nowrap ${
                        job.makstud ? 'text-emerald-600' : 'text-orange-600'
                      }`}
                    >
                      {/* Payment is tracked per job, not per revision — a revision
                          inherits its parent's paid state, so the cell stays empty
                          rather than repeating it. */}
                      {isRev ? '' : (job.makstud ? 'Makstud' : 'Maksmata')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Colour key for the row edges — only the stages actually present, so
              it stays a single quiet line rather than the whole pipeline. */}
          {usedStages.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 pt-2 border-t border-ink-faint/10">
              {usedStages.map(st => (
                <span key={st.key} className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: st.hex }} />
                  {st.label}
                </span>
              ))}
              {revisionCount > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-ink-faint ml-auto">
                  <CornerDownRight size={9} />
                  taane = muudatus · kokku {jobs.reduce((s, j) => s + jobTotal(j), 0).toFixed(2)} €
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </PanelCard>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`${align === 'right' ? 'text-right' : 'text-left'} pb-2 pr-3 last:pr-0 whitespace-nowrap text-[10px] font-medium text-ink-muted uppercase tracking-wider`}
    >
      {children}
    </th>
  )
}
