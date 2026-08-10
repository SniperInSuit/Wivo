import { useState, useRef } from 'react'
import { ArrowUpRight, Clock, Cpu, Euro, FileText, History, UserRound, Zap, Trash2, Plus, Copy, Printer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job, Revision, WorkItem } from '../../types/job'
import { jobWorkItems } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { usePatients } from '../../hooks/usePatients'
import { usePayments, useDeletePayment } from '../../hooks/useInvoices'
import { jobPaymentState } from '../../lib/jobPayments'
import { PAYMENT_METHOD_LABEL } from '../../types/invoice'
import { useWorkTypes } from '../../stores/useSettings'
import { ShadeChip } from '../ui/ShadeChip'
import { ToothBadges } from '../ui/ToothBadges'
import { JobNotesPanel } from './JobNotesPanel'

interface JobReadViewProps {
  job: Job
  isBottom: boolean
  // null = the original job; a revision id = that revision
  activeRevisionId: string | null
  onSelectVariant: (revisionId: string | null) => void
  onMarkPaid?: () => void
  onAddRevision?: () => void
  onDuplicate?: () => void
  highlightNoteId?: string
  onOpenPatient?: (patientId: string) => void
}

function fmt(value: string | null | undefined, pattern: string): string {
  if (!value) return '—'
  const d = parseISO(value)
  return isValid(d) ? format(d, pattern) : '—'
}

const toothCount = (s: string | null | undefined) =>
  s ? s.split(',').filter(t => t.trim()).length : 0

/**
 * Read-only production record for one job — or for one of its revisions.
 *
 * A revision is real work with its own teeth, shade, material, price, deadline
 * and pipeline stage. Opening a revision therefore shows THAT revision's data,
 * not the original's, and the variant switcher lets you peek between them
 * without leaving the panel.
 */
export function JobReadView({
  job, isBottom, activeRevisionId, onSelectVariant, onMarkPaid,
  onAddRevision, onDuplicate, highlightNoteId, onOpenPatient
}: JobReadViewProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const { data: patients = [] } = usePatients()
  // Imported jobs still have patient_id = null, so fall back to the name — the
  // same match the patient page uses to attribute their job history.
  const linkedPatientId = job.patient_id
    ?? patients.find(p => p.nimi.trim().toLowerCase() === (job.patsient ?? '').trim().toLowerCase())?.id
    ?? null
  const { stageMap } = usePipeline()
  const revisions = job.revisions ?? []
  const { data: allPayments = [] } = usePayments()
  const deletePayment = useDeletePayment()
  const jobPayments = allPayments.filter(p => p.job_id === job.id)
  const pay = jobPaymentState(job, allPayments)
  const rev: Revision | null = activeRevisionId
    ? revisions.find(r => r.id === activeRevisionId) ?? null
    : null

  // The work items belonging to whatever is on screen. A revision shows its
  // OWN items, never the job's — which is the same rule the rest of this view
  // follows, and the reason the switcher exists.
  //
  // A revision shows the block from one item up, because a revision has no
  // "Töö tüüp" field of its own (that slot holds its description), so without
  // it the type was nowhere on screen. On a job, one item is already named in
  // the type field and the block would only repeat it.
  const shownItems = rev
    ? (Array.isArray(rev.work_items) ? rev.work_items : [])
    : jobWorkItems(job)
  const showItemsBlock = rev ? shownItems.length > 0 : shownItems.length > 1

  const revTotal = revisions.reduce((s, r) => s + (r.price ?? 0), 0)
  const extras = job.disain_hind ?? 0
  // Revision costs are internal (technician cost), not client-facing
  const jobGrandTotal = (job.hind ?? 0) + extras

  // What this variant is: a revision falls back to nothing, not to the original.
  // Showing the parent's teeth on a revision row is exactly the confusion this
  // whole switcher exists to remove — an empty field means "unchanged here".
  const v = rev
    ? {
        title: rev.note?.trim() || 'Muudatus',
        teeth: rev.hambad ?? null,
        material: rev.materjal ?? null,
        shade: rev.varv ?? null,
        machine: null as string | null,
        printId: rev.print_id ?? null,
        designId: null as string | null,
        date: rev.ts,
        deadline: rev.deadline ?? null,
        price: rev.price ?? 0,
        rush: rev.kiirtoo ?? false
      }
    : {
        title: job.too || '—',
        teeth: job.hambad,
        material: job.materjal,
        shade: job.varv,
        machine: job.masina,
        printId: job.print_id,
        designId: job.disain_id,
        date: job.kuupaev,
        deadline: job.valmis_aeg,
        price: job.hind ?? 0,
        rush: job.kiirtoo
      }

  const teeth = toothCount(v.teeth)

  return (
    <div className="px-5 py-4 space-y-3">
      {/* ─── Variant switcher + actions ───────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Variants + Lisa muudatus inline */}
        <div className="flex flex-wrap items-center gap-1.5">
          {revisions.length > 0 && (
            <Chip active={activeRevisionId === null} onClick={() => onSelectVariant(null)}>
              Originaal
            </Chip>
          )}
          {revisions.map((r, i) => (
            <Chip key={r.id} active={activeRevisionId === r.id} onClick={() => onSelectVariant(r.id)}>
              Muudatus {i + 1}
            </Chip>
          ))}
          {onAddRevision && (
            <button type="button" onClick={onAddRevision}
              className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80 px-2 py-1 rounded-lg border border-accent/30 hover:bg-accent/10 transition-colors"
            >
              <Plus size={12} />
              Lisa muudatus
            </button>
          )}
        </div>

        {/* Other actions */}
        <div className="flex items-center gap-1 ml-auto">
          {onDuplicate && (
            <button type="button" onClick={onDuplicate}
              className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-bg-sidebar transition-colors"
              title="Dubleeri töö"
            >
              <Copy size={12} />
              Dubleeri
            </button>
          )}
          <button type="button"
            onClick={() => {
              const el = printRef.current
              if (!el) return
              const w = window.open('', '_blank', 'width=800,height=600')
              if (!w) return
              w.document.write(`<html><head><title>${job.patsient} — ${job.too || 'Töö'}</title>
                <style>body{font-family:Inter,system-ui,sans-serif;padding:24px;font-size:13px;color:#1a1a1a}
                section{border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin-bottom:12px}
                h3{font-size:11px;text-transform:uppercase;color:#0AB6C4;margin:0 0 8px}
                </style></head><body>${el.innerHTML}</body></html>`)
              w.document.close()
              w.print()
            }}
            className="flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-bg-sidebar transition-colors"
            title="Prindi"
          >
            <Printer size={12} />
          </button>
        </div>
      </div>

      <div ref={printRef} className={isBottom ? 'grid grid-cols-2 gap-3 items-start' : 'grid grid-cols-1 xl:grid-cols-2 gap-3 items-start'}>
        {/* ─── Left: production data ─────────────────────────────────────── */}
        <div className="space-y-3">
          <Card title={rev ? 'MUUDATUSE ANDMED' : 'TÖÖ ANDMED'} icon={FileText}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <div className="min-w-0">
                <Label>Patsient</Label>
                <p className="text-sm font-semibold text-ink truncate" title={job.patsient}>
                  {job.patsient || '—'}
                </p>
                {linkedPatientId && onOpenPatient && (
                  <button
                    type="button"
                    onClick={() => onOpenPatient(linkedPatientId)}
                    className="flex items-center gap-1 text-[10px] font-medium text-accent hover:underline mt-0.5"
                  >
                    <UserRound size={10} />
                    Ava profiil
                    <ArrowUpRight size={10} />
                  </button>
                )}
              </div>
              <div className="min-w-0">
                <Label>{rev ? 'Kirjeldus' : 'Töö tüüp'}</Label>
                <p className="text-sm font-semibold text-ink whitespace-pre-wrap break-words">
                  {v.title}
                  {v.rush && <Zap size={11} className="inline ml-1 text-orange-500 fill-orange-400" />}
                </p>
                {!rev && jobWorkItems(job).length <= 1 && jobWorkItems(job)[0]?.kruvi && (
                  <p className="text-[11px] text-indigo-600 mt-0.5">🔩 {jobWorkItems(job)[0].kruvi}</p>
                )}
              </div>
              {!rev && job.kirjeldus && (
                <div className="col-span-2 min-w-0">
                  <Label>Kirjeldus</Label>
                  <p className="text-sm text-ink-soft whitespace-pre-wrap break-words">{job.kirjeldus}</p>
                </div>
              )}
              {/* Work items breakdown */}
              {showItemsBlock && <WorkItemsReadBlock items={shownItems} />}
              {/* Flat tooth list, when there is no breakdown to show instead.
                  This used to be gated on the JOB's item count even while a
                  revision was on screen, so a revision of a multi-item job
                  showed no teeth at all — neither block was rendered. */}
              {!showItemsBlock && (
              <div>
                <Label>Hambad (FDI)</Label>
                {teeth > 0
                  ? <ToothBadges hambad={v.teeth} max={32} />
                  : <p className="text-sm text-ink-faint">—</p>}
              </div>
              )}
              <Cell label="Kogus" value={teeth > 0 ? `${teeth} hammast` : '—'} />
              <Cell
                label={rev ? 'Muudatuse aeg' : 'Töö kuupäev'}
                value={fmt(v.date, rev ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy')}
              />
              <div className="min-w-0">
                <Label>Tähtaeg</Label>
                <p className="text-sm text-ink-soft">
                  {v.deadline
                    ? <>{fmt(v.deadline, 'dd.MM.yyyy')}{' '}<span className="text-ink-muted">{fmt(v.deadline, 'HH:mm')}</span></>
                    : '—'}
                </p>
              </div>
              {rev && (
                <Cell label="Kuulub töö juurde" value={job.too || '—'} />
              )}
            </div>
          </Card>

          <Card title="TOOTMISE ANDMED" icon={Cpu}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Cell label="Materjal" value={v.material || '—'} strong />
              <div>
                <Label>VITA toon</Label>
                {v.shade ? <ShadeChip shade={v.shade} /> : <p className="text-sm text-ink-faint">—</p>}
              </div>
              <Cell label="Masin" value={v.machine || (rev ? 'sama kui tööl' : '—')} strong />
              <Cell label="Print ID" value={v.printId || '—'} mono />
              <Cell label="Disain ID" value={v.designId || '—'} mono />
            </div>
          </Card>

          {/* Notes belong to the job as a whole, not to the selected variant —
              they stay put when you switch between original and revisions. */}
          <JobNotesPanel job={job} highlightNoteId={highlightNoteId} />
        </div>

        {/* ─── Right: money ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <Card title="HIND JA MAKSMINE" icon={Euro}>
            <div className="space-y-1.5">
              {rev ? (
                <>
                  <Line label="Töö hind" value={`${(job.hind ?? 0).toFixed(2)} €`} />
                  {v.price > 0 && (
                    <Line label="Ümbertegemise kulu (sisemine)" value={`${v.price.toFixed(2)} €`} muted />
                  )}
                  {revisions.length > 1 && (
                    <Line label={`Kõik muudatused (${revisions.length})`} value={`${revTotal.toFixed(2)} €`} muted />
                  )}
                </>
              ) : (
                <>
                  <Line label="Töö hind" value={`${(job.hind ?? 0).toFixed(2)} €`} />
                  {extras > 0 && <Line label="Lisakulud" value={`${extras.toFixed(2)} €`} />}
                </>
              )}
              <div className="flex items-center justify-between pt-1.5 border-t border-ink-faint/15">
                <span className="text-sm font-semibold text-ink">Kokku tööl</span>
                <span className="text-sm font-bold text-ink">{jobGrandTotal.toFixed(2)} €</span>
              </div>
              {revisions.length > 0 && !rev && (
                <div className="flex items-center justify-between text-[11px] text-ink-faint mt-1">
                  <span>Muudatuste kulu (sisemine)</span>
                  <span className="tabular-nums">{revTotal.toFixed(2)} €</span>
                </div>
              )}
            </div>

            {/* Part payments mean the flag alone no longer tells the story: a job
                can read "maksmata" and still have money against it. */}
            {pay.partial ? (
              <div className="rounded-lg px-3 py-2 mt-2.5 bg-orange-50 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  <span className="text-sm font-medium text-orange-800">Osaliselt makstud</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-orange-800">
                  <span>Laekunud</span>
                  <span className="tabular-nums font-semibold">{pay.paid.toFixed(2)} €</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-orange-900">
                  <span className="font-medium">Jääk</span>
                  <span className="tabular-nums font-bold">{pay.outstanding.toFixed(2)} €</span>
                </div>
              </div>
            ) : (
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 mt-2.5 ${
                  pay.settled ? 'bg-emerald-50' : 'bg-red-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${pay.settled ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className={`text-sm font-medium ${pay.settled ? 'text-emerald-700' : 'text-red-700'}`}>
                  {pay.settled ? 'Makstud' : 'Maksmata'}
                </span>
                {pay.settled && job.makse_kuupaev && (
                  <span className="ml-auto text-[11px] text-emerald-700">
                    {fmt(job.makse_kuupaev, 'dd.MM.yyyy')}
                  </span>
                )}
              </div>
            )}

            {/* Individual receipts, so a part payment can be checked rather than
                just believed. */}
            {jobPayments.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {jobPayments.map(p => (
                  <PaymentRow key={p.id} payment={p} onDelete={() => deletePayment.mutate(p.id)} />
                ))}
              </div>
            )}

            {/* Payment lives on the job, so it is stated once and never per revision */}
            <p className="text-[11px] text-ink-muted mt-1.5">
              {pay.settled
                ? 'Makse käib kogu töö kohta, koos muudatustega.'
                : 'Makse käib kogu töö kohta, koos muudatustega.'}
            </p>
            {!pay.settled && onMarkPaid && (
              <button onClick={onMarkPaid} className="btn-ghost text-xs border border-ink-faint/30 mt-1.5">
                {pay.partial ? 'Lisa makse' : 'Märgi makstuks'}
              </button>
            )}
          </Card>

          <Card title="TÖÖ AJALUGU" icon={History}>
            {/* Derived from the timestamps the job already carries — there is no
                audit log table, so this is every event we can honestly show. */}
            <ol className="space-y-2">
              {[...revisions]
                .map((r, i) => ({ r, n: i + 1 }))
                .sort((a, b) => (b.r.ts ?? '').localeCompare(a.r.ts ?? ''))
                .map(({ r, n }) => (
                  <Event
                    key={r.id}
                    ts={r.ts}
                    active={r.id === activeRevisionId}
                    badge={`Muudatus ${n}`}
                    text={r.note?.trim() || 'Muudatus'}
                    meta={stageMap[r.status ?? job.status]?.label}
                    onClick={() => onSelectVariant(r.id)}
                  />
                ))}
              <Event ts={job.updated_at} text="Viimati muudetud" />
              <Event
                ts={job.created_at}
                text="Töö loodud"
                active={activeRevisionId === null}
                onClick={() => onSelectVariant(null)}
              />
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Presentational helpers ────────────────────────────────────────────────
function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
        active
          ? 'bg-accent text-white border-accent'
          : 'bg-nav/10 text-nav-muted border-nav/20 hover:border-accent/50 hover:text-nav'
      }`}
    >
      {children}
    </button>
  )
}

function Card({ title, icon: Icon, children }: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <section className="bg-bg-card border border-ink-faint/20 rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon size={12} className="text-accent" />
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function PaymentRow({ payment: p, onDelete }: {
  payment: { id: string; paid_at: string; method: string; reference: string | null; amount: number }
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="flex items-center gap-2 text-[11px] text-ink-muted group">
      <span className="tabular-nums">{fmt(p.paid_at, 'dd.MM.yyyy')}</span>
      <span>{PAYMENT_METHOD_LABEL[p.method as keyof typeof PAYMENT_METHOD_LABEL] ?? p.method}</span>
      {p.reference && <span className="truncate text-ink-faint">{p.reference}</span>}
      <span className="ml-auto tabular-nums font-medium text-ink">
        {Number(p.amount).toFixed(2)} €
      </span>
      {confirm ? (
        <span className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => { onDelete(); setConfirm(false) }}
            className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-medium">Jah</button>
          <button onClick={() => setConfirm(false)}
            className="text-[10px] text-ink-faint hover:text-ink">Ei</button>
        </span>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className="p-0.5 text-ink-faint hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          title="Kustuta makse"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  )
}

function WorkItemsReadBlock({ items }: { items: WorkItem[] }) {
  const wt = useWorkTypes()
  return (
    <div className="col-span-2 space-y-1.5">
      <Label>Tööosad ({items.length})</Label>
      {items.map(item => {
        const hex = wt.hex(item.too)
        const teethCount = item.hambad.split(',').filter(t => t.trim()).length
        return (
          <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: `${hex}10` }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
            <span className="text-sm font-semibold text-ink">{item.too}</span>
            {item.bridge && <span className="text-[9px] bg-accent/15 text-accent px-1.5 py-0.5 rounded font-medium">sild</span>}
            {item.materjal && (
              <span className="text-[10px] text-ink-muted bg-bg-sidebar px-1.5 py-0.5 rounded truncate max-w-[120px]">{item.materjal}</span>
            )}
            {item.kruvi && (
              <span className="text-[10px] text-ink-muted bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded truncate max-w-[140px]" title={item.kruvi}>
                🔩 {item.kruvi}
              </span>
            )}
            <span className="text-xs text-ink-muted ml-auto">{teethCount} hammast</span>
            <ToothBadges hambad={item.hambad} max={8} />
          </div>
        )
      })}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-medium text-ink-muted mb-0.5">{children}</p>
}

function Cell({ label, value, strong, mono }: {
  label: string; value: string; strong?: boolean; mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <p
        className={`truncate ${mono ? 'font-mono text-xs' : 'text-sm'} ${
          strong ? 'font-semibold text-ink' : 'text-ink-soft'
        }`}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={muted ? 'text-ink-faint' : 'text-ink-muted'}>{label}</span>
      <span className={muted ? 'text-ink-muted' : 'text-ink font-medium'}>{value}</span>
    </div>
  )
}

function Event({ ts, text, badge, meta, active, onClick }: {
  ts: string; text: string; badge?: string; meta?: string
  active?: boolean; onClick?: () => void
}) {
  const d = ts ? parseISO(ts) : null
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={`w-full flex items-start gap-2 text-xs text-left rounded px-1 -mx-1 py-0.5 transition-colors ${
          active ? 'bg-accent/10' : onClick ? 'hover:bg-bg-sidebar' : ''
        } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
          <Clock size={10} className="text-ink-faint" />
          <span className="text-ink-muted whitespace-nowrap tabular-nums">
            {d && isValid(d) ? format(d, 'dd.MM.yyyy HH:mm') : '—'}
          </span>
        </span>
        <span className="min-w-0 flex-1 flex items-center gap-1.5">
          {badge && (
            <span className="text-[10px] font-medium bg-violet-100 text-violet-700 rounded px-1.5 py-0.5 flex-shrink-0">
              {badge}
            </span>
          )}
          <span className="text-ink-soft truncate" title={text}>{text}</span>
          {meta && <span className="ml-auto text-[10px] text-ink-faint flex-shrink-0">{meta}</span>}
        </span>
      </button>
    </li>
  )
}
