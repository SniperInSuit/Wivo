import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Trash2, Euro, Check, Calendar, Save, Loader2, Cpu, Calculator, Pencil, Zap, UserRound
} from 'lucide-react'
import type { Job, JobInput, StageKey, Revision } from '../../types/job'
import { MATERIAL_SHADES } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { stageChipStyle } from '../../config/pipeline'
import { OdontogramPicker } from './OdontogramPicker'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { ShadePicker } from './ShadePicker'
import { RevisionBlock } from './RevisionBlock'
import { PatientPicker } from '../Patients/PatientPicker'
import { JobReadView } from './JobReadView'
import { JobTimeline } from './JobTimeline'
import { StatusPill } from '../ui/StatusPill'
import { useSettings, useWorkTypes, calcProduction, countSmallTeeth, countLargeTeeth, workTypePriceFor } from '../../stores/useSettings'

const toothCountOf = (h: string) => h.split(',').filter(t => t.trim()).length
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { useMarkJobsPaid, usePayments } from '../../hooks/useInvoices'
import { MarkPaidDialog } from './MarkPaidDialog'
import { workTypeImage } from '../../lib/workTypeImages'

interface JobDetailPanelProps {
  job: Job | null       // null = create mode
  onClose: () => void
  onSave: (input: JobInput) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  saving?: boolean
  position?: 'side' | 'bottom'  // default: side
  initialDate?: string           // pre-fill valmis_aeg for new jobs (ISO or datetime-local)
  highlightRevisionId?: string   // auto-expand + scroll to this revision on open
  highlightNoteId?: string       // scroll to + highlight this note on open
  onOpenPatient?: (patientId: string) => void
}

const EMPTY_FORM: JobInput = {
  status: 'disain',
  kuupaev: new Date().toISOString().split('T')[0],
  patsient: '',
  patient_id: null,
  too: '',
  kirjeldus: '',
  materjal: '',
  masina: '',
  print_id: '',
  disain_id: '',
  varv: '',
  hambad: '',
  work_items: [],
  valmis_aeg: '',
  valmis_kuupaev: null,
  kiirtoo: false,
  revisions: [],
  hind: null,
  disain_hind: null,
  makstud: false,
  makse_kuupaev: '',
  assigned_to: null,
  designed_by: null
}

// ─── Worker select ────────────────────────────────────────────────────────────
// Reads the clinic's profiles. Empty is a real answer — plenty of work is done
// by someone who is not in the system, or outsourced, and forcing a name would
// put fictional people on payroll reports.
function WorkerSelect({ label, value, onChange }: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
}) {
  const { data: workers = [] } = useClinicProfiles()
  return (
    <div>
      <label className="label flex items-center gap-1.5">
        <UserRound size={11} /> {label}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="input"
      >
        <option value="">—</option>
        {workers.map(w => (
          <option key={w.id} value={w.id}>{w.full_name || 'Nimeta'}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Pricing sub-component (shared between side + bottom layouts) ─────────────
function PricingBlock({ form, set, settings, smallCount, largeCount, prodPrice, hasCalc, onHindChange, useDiscount, onDiscountChange, onRequestMarkPaid, paidSoFar }: {
  form: JobInput
  set: <K extends keyof JobInput>(key: K, val: JobInput[K]) => void
  settings: ReturnType<typeof useSettings>['settings']
  smallCount: number
  largeCount: number
  prodPrice: number
  hasCalc: boolean
  onHindChange: (v: number | null) => void
  useDiscount: boolean
  onDiscountChange: (v: boolean) => void
  onRequestMarkPaid?: () => void
  paidSoFar: number
}) {
  // Recomputed here rather than threaded in: this block is rendered by two
  // layouts, and a prop the two callers could set differently is a way for the
  // side panel and the bottom panel to disagree about the same job's price.
  const teeth = toothCountOf(form.hambad ?? '')
  const info = workTypePriceFor(form.too, settings.tooTuubid, teeth, useDiscount)
  const typePrice = info?.amount ?? null

  return (
    <div className="border border-ink-faint/20 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold text-ink flex items-center gap-2">
        <Euro size={15} className="text-accent" />
        Hind ja maksmine
      </p>

      {hasCalc && (
        <div className="bg-bg-sidebar rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-ink-muted mb-2">Autoarvutus</p>
          {/* A work-type price replaces the per-tooth rows rather than adding to
              them — showing both would read as if they were summed. */}
          {typePrice != null && info ? (
            <>
              <div className="flex justify-between text-xs text-ink-muted">
                <span>
                  {info.mode === 'hammas'
                    ? `${teeth} × ${info.unit.toFixed(2)} € / hammas`
                    : `1 × ${form.too?.trim() || 'töö'} (hind töö kohta)`}
                </span>
                <span className="font-medium text-ink">{typePrice.toFixed(2)} €</span>
              </div>
              {info.hasDiscount && (
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onDiscountChange(false)}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                      !useDiscount ? 'bg-accent text-white' : 'bg-ink-faint/20 text-ink-muted hover:text-ink'
                    }`}
                  >
                    Täishind
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscountChange(true)}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                      useDiscount ? 'bg-accent text-white' : 'bg-ink-faint/20 text-ink-muted hover:text-ink'
                    }`}
                  >
                    Soodushind
                  </button>
                </div>
              )}
            </>
          ) : prodPrice > 0 && form.materjal && (
            <>
              {smallCount > 0 && (
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>{smallCount} × väike hammas</span>
                  <span className="font-medium text-ink">
                    {(smallCount * (settings.materialPrices[form.materjal]?.small ?? 0)).toFixed(2)} €
                  </span>
                </div>
              )}
              {largeCount > 0 && (
                <div className="flex justify-between text-xs text-ink-muted">
                  <span>{largeCount} × suur hammas</span>
                  <span className="font-medium text-ink">
                    {(largeCount * (settings.materialPrices[form.materjal]?.large ?? 0)).toFixed(2)} €
                  </span>
                </div>
              )}
            </>
          )}
          {settings.designFee > 0 && (
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="flex items-center gap-1"><Pencil size={10} /> Disain</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{settings.designFee.toFixed(2)} €</span>
                <button
                  type="button"
                  onClick={() => set('disain_hind', form.disain_hind != null ? null : settings.designFee)}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                    form.disain_hind != null
                      ? 'bg-accent text-white'
                      : 'bg-ink-faint/20 text-ink-muted hover:bg-accent/20 hover:text-accent'
                  }`}
                >
                  {form.disain_hind != null ? 'Lisatud ✓' : 'Lisa'}
                </button>
              </div>
            </div>
          )}
          {(prodPrice > 0 || form.disain_hind != null) && (() => {
            const base = prodPrice + (form.disain_hind ?? 0)
            const total = form.kiirtoo ? base * settings.kiirtooKordaja : base
            return (
              <>
                <div className="border-t border-ink-faint/20 pt-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink flex items-center gap-1">
                    Kokku
                    {form.kiirtoo && (
                      <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">2×</span>
                    )}
                  </span>
                  <span className="text-sm font-bold text-accent">{total.toFixed(2)} €</span>
                </div>
                <button
                  type="button"
                  onClick={() => set('hind', total)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-accent hover:text-accent-dark font-semibold mt-1 py-1 rounded-lg hover:bg-accent/5 transition-colors"
                >
                  <Calculator size={11} />
                  Kanna hinna väljale
                </button>
              </>
            )
          })()}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Hind kokku (€)</label>
          <input
            type="number" step="0.01" min="0"
            value={form.hind ?? ''}
            onChange={e => {
              onHindChange(e.target.value === '' ? null : parseFloat(e.target.value))
            }}
            placeholder="0.00" className="input"
          />
        </div>
        <div>
          <label className="label flex items-center gap-1">
            <Pencil size={10} /> Disain hind (€)
          </label>
          <input
            type="number" step="0.01" min="0"
            value={form.disain_hind ?? ''}
            onChange={e => set('disain_hind', e.target.value === '' ? null : parseFloat(e.target.value))}
            placeholder="0.00" className="input"
          />
        </div>
      </div>

      <div className="flex flex-col">
        <label className="label">Makstud</label>
        <button
          type="button"
          onClick={() => {
            // Turning it ON asks for the method; turning it OFF is just a
            // correction and needs nothing.
            if (form.makstud) { set('makstud', false); set('makse_kuupaev', '') }
            else onRequestMarkPaid?.()
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all duration-150 ${
            form.makstud
              ? 'bg-green-50 border-green-400 text-green-700'
              : 'bg-bg-sidebar border-ink-faint/30 text-ink-muted hover:border-ink-faint/60'
          }`}
        >
          <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
            form.makstud ? 'bg-green-500 border-green-500' : 'border-ink-faint'
          }`}>
            {form.makstud && <Check size={10} className="text-white" />}
          </span>
          {form.makstud ? 'Makstud' : 'Maksmata'}
        </button>
        {/* A job can be unpaid by the flag and still have money against it. */}
        {paidSoFar > 0 && !form.makstud && (
          <p className="text-[11px] text-amber-600 mt-1 leading-relaxed">
            Osaliselt makstud: laekunud {paidSoFar.toFixed(2)} €
          </p>
        )}
      </div>

      {form.makstud && (
        <div>
          <label className="label flex items-center gap-1">
            <Calendar size={11} /> Makse kuupäev
          </label>
          <input
            type="date"
            value={form.makse_kuupaev ?? ''}
            onChange={e => set('makse_kuupaev', e.target.value)}
            className="input"
          />
        </div>
      )}
    </div>
  )
}

export function JobDetailPanel({ job, onClose, onSave, onDelete, saving, position = 'side', initialDate, highlightRevisionId, highlightNoteId, onOpenPatient }: JobDetailPanelProps) {
  const isBottom = position === 'bottom'
  const { settings } = useSettings()
  const wt = useWorkTypes()
  // Full price vs the type's discount price. Per job, not a setting: the person
  // filling the form is the one who knows whether this case is discounted.
  const [useDiscount, setUseDiscount] = useState(false)
  // Marking paid always asks HOW — see MarkPaidDialog.
  const [paidDialog, setPaidDialog] = useState(false)
  const markPaid = useMarkJobsPaid()
  const { data: jobPayments = [] } = usePayments()
  const { stages } = usePipeline()
  const [form, setForm] = useState<JobInput>(EMPTY_FORM)
  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  // Opening an existing job shows it, it does not offer to change it. A new job
  // has nothing to look at, so it starts in the form.
  const [editing, setEditing] = useState(job == null)
  // Which variant the read view is showing: null = the original job, otherwise a
  // revision id. Seeded from the row that was clicked, so opening a "-M1" line
  // from the patient history lands on that revision instead of the original.
  const [activeRevId, setActiveRevId] = useState<string | null>(highlightRevisionId ?? null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Auto-price mode: on for new jobs OR existing jobs with no price set
  const hindAutoRef = useRef(false)

  // Populate form when job changes
  useEffect(() => {
    hindAutoRef.current = job ? job.hind == null : true  // auto on if no price exists yet
    if (job) {
      // Migrate legacy single-revision fields into revisions array
      let revisions: Revision[] = job.revisions ?? []
      if (revisions.length === 0 && job.muudatused) {
        revisions = [{
          id: crypto.randomUUID(),
          ts: job.updated_at,
          note: job.muudatused,
          hambad: job.rev_hambad ?? undefined,
          varv: job.rev_varv ?? undefined,
          deadline: job.uus_valmis ?? undefined,
        }]
      }

      setForm({
        status: job.status,
        kuupaev: job.kuupaev,
        patsient: job.patsient,
        patient_id: job.patient_id ?? null,
        too: job.too ?? '',
        kirjeldus: job.kirjeldus ?? '',
        materjal: job.materjal ?? '',
        masina: job.masina ?? '',
        print_id: job.print_id ?? '',
        disain_id: job.disain_id ?? '',
        varv: job.varv ?? '',
        hambad: job.hambad ?? '',
        work_items: Array.isArray(job.work_items) ? job.work_items.map(i => ({ ...i })) : [],
        valmis_aeg: job.valmis_aeg ? job.valmis_aeg.replace('Z', '').slice(0, 16) : '',
        valmis_kuupaev: job.valmis_kuupaev ?? null,
        kiirtoo: job.kiirtoo ?? false,
        revisions,
        hind: job.hind,
        disain_hind: job.disain_hind ?? null,
        assigned_to: job.assigned_to ?? null,
        designed_by: job.designed_by ?? null,
        makstud: job.makstud,
        makse_kuupaev: job.makse_kuupaev ?? ''
      })
    } else {
      setForm({
        ...EMPTY_FORM,
        masina: settings.defaultMachine ?? '',
        valmis_aeg: initialDate ?? '',
      })
    }
    setDeleteConfirm(false)
    setEditing(job == null)
    setActiveRevId(highlightRevisionId ?? null)
  // Keyed on the job ID, not the object: adding a note refetches `jobs` and hands
  // us a new object for the same job. Re-running on that would reset the variant
  // selection and, mid-edit, overwrite the form with server values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, highlightRevisionId])

  const set = useCallback(<K extends keyof JobInput>(key: K, val: JobInput[K]) => {
    setForm(f => ({ ...f, [key]: val }))
  }, [])

  // Live auto-price: fires when work type, teeth, material, or kiirtöö change
  // (new jobs only)
  useEffect(() => {
    if (!hindAutoRef.current) return
    // A work-type price is per job, so it applies even before any tooth is
    // picked — that is the whole point of quoting a case rather than a tooth.
    const h = form.hambad ?? ''
    const toothCount = h.split(',').filter(Boolean).length
    const typePrice = workTypePriceFor(form.too, settings.tooTuubid, toothCount, useDiscount)?.amount ?? null
    if (typePrice == null && toothCount === 0) return
    const p = form.materjal
      ? calcProduction(h, form.materjal, settings.materialPrices)
      : 0
    // Fallback €/tooth when the material has no price set — Seaded → Hinnad
    const base = typePrice ?? (p > 0 ? p : toothCount * settings.hambaHind)
    const total = form.kiirtoo ? base * settings.kiirtooKordaja : base
    set('hind', parseFloat(total.toFixed(2)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.too, form.hambad, form.materjal, form.kiirtoo, useDiscount])

  // Auto-calculate: small teeth + large teeth from settings, plus design fee
  // The revision currently being viewed, if any — drives both the timeline and
  // the read view so they never disagree about what is on screen.
  const activeRev = job && activeRevId
    ? (job.revisions ?? []).find(r => r.id === activeRevId) ?? null
    : null

  const hambad = form.hambad ?? ''
  const smallCount = countSmallTeeth(hambad)
  const largeCount = countLargeTeeth(hambad)
  const typePriceInfo = workTypePriceFor(form.too, settings.tooTuubid, toothCountOf(hambad), useDiscount)
  const prodPrice = typePriceInfo?.amount ?? (form.materjal
    ? calcProduction(hambad, form.materjal, settings.materialPrices)
    : 0)
  const hasCalc = prodPrice > 0 || settings.designFee > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    const cleaned: JobInput = {
      ...form,
      // Sync denormalized too/hambad from work_items if items exist
      too: form.work_items.length > 0
        ? form.work_items[0].too
        : (form.too || null),
      hambad: form.work_items.length > 0
        ? [...new Set(form.work_items.flatMap(i => i.hambad.split(',').filter(t => t.trim())))].join(',') || null
        : (form.hambad || null),
      work_items: form.work_items,
      kirjeldus: form.kirjeldus || null,
      materjal: form.materjal || null,
      masina: form.masina || null,
      print_id: form.print_id || null,
      disain_id: form.disain_id || null,
      varv: form.varv || null,
      valmis_aeg: form.valmis_aeg ? new Date(form.valmis_aeg).toISOString() : null,
      disain_hind: form.disain_hind,
      // Clear legacy fields on save
      muudatused: null,
      rev_hambad: null,
      rev_varv: null,
      uus_valmis: null,
      makse_kuupaev: form.makse_kuupaev || null
    } as JobInput
    try {
      await onSave(cleaned)
    } catch (err: unknown) {
      setSaveError((err as Error)?.message ?? 'Salvestamine ebaõnnestus')
    }
  }

  async function handleDelete() {
    if (!job || !onDelete) return
    await onDelete(job.id)
    onClose()
  }

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        key="panel"
        initial={isBottom ? { y: '100%' } : { x: '100%' }}
        animate={isBottom ? { y: 0 } : { x: 0 }}
        exit={isBottom ? { y: '100%' } : { x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className={
          isBottom
            ? 'fixed left-0 right-0 bottom-0 h-panel bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-ink-faint/15'
            : 'fixed right-0 top-0 bottom-0 w-[540px] bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden'
        }
        onClick={e => e.stopPropagation()}
      >
        {/* Work-type colour strip — bottom panel only. Colour comes from
            Seaded → Valikud, same source as the calendar and the legend. */}
        {isBottom && (
          <div
            className="h-1.5 flex-shrink-0 rounded-t-2xl"
            style={{ backgroundColor: wt.hex(job?.too ?? form.too) }}
          />
        )}

        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-faint/20 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="text-base font-semibold text-ink truncate">
                {!job ? 'Uus töö' : editing ? 'Muuda tööd' : (job.too || 'Töö')}
                {job && !editing && !activeRev && job.print_id && (
                  <span className="text-ink-muted font-normal"> · {job.print_id}</span>
                )}
                {activeRev && !editing && (
                  <span className="text-accent font-normal">
                    {' '}· muudatus {(job?.revisions ?? []).findIndex(r => r.id === activeRev.id) + 1}
                  </span>
                )}
              </h2>
              {job && <StatusPill status={activeRev?.status ?? job.status} />}
            </div>
            {/* Identity line: who, what, when — the three things you check first */}
            {job && !editing && (
              <div className="flex items-center gap-3 mt-1 text-xs text-ink-muted min-w-0">
                <span className="truncate">{job.patsient}</span>
                {(() => {
                  const t = (activeRev ? activeRev.hambad : job.hambad) ?? ''
                  const n = t.split(',').filter(x => x.trim()).length
                  return n > 0 ? <span className="whitespace-nowrap">{n} hammast</span> : null
                })()}
                <span className="whitespace-nowrap">
                  {activeRev
                    ? (activeRev.ts ?? '').slice(0, 10).split('-').reverse().join('.')
                    : (job.kuupaev ? job.kuupaev.split('-').reverse().join('.') : '')}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {job && onDelete && (
              deleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">Kustutada?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600 transition-colors"
                  >
                    Jah
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    className="text-xs text-ink-muted hover:text-ink px-2 py-1 rounded-lg transition-colors"
                  >
                    Ei
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="btn-ghost text-red-400 hover:text-red-600 hover:bg-red-50 p-2"
                >
                  <Trash2 size={15} />
                </button>
              )
            )}
            {job && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="btn-ghost">
                <Pencil size={14} />
                Muuda
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost p-2">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Read-only view of an existing job — the form is one click away */}
        {job && !editing ? (
          <>
            <div className="flex-1 overflow-y-auto bg-nav-bg">
              <JobTimeline
                job={job}
                status={activeRev?.status ?? job.status}
                finishedAt={activeRev ? (activeRev.deadline ?? null) : undefined}
              />
              <JobReadView
                job={job}
                isBottom={isBottom}
                activeRevisionId={activeRevId}
                onSelectVariant={setActiveRevId}
                highlightNoteId={highlightNoteId}
                onOpenPatient={onOpenPatient}
                onMarkPaid={() => setPaidDialog(true)}
              />
            </div>
          </>
        ) : (
        /* Scrollable form body — grid-cols-1 (side) or grid-cols-2 (bottom) */
        <form id="job-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className={
            isBottom
              ? 'px-6 py-5 grid grid-cols-2 gap-x-8 items-start'
              : 'px-6 py-5 space-y-5'
          }>

            {/* ── LEFT / SINGLE COLUMN ── metadata fields */}
            <div className="space-y-5">

              {/* Status */}
              <div>
                <label className="label">Staatus</label>
                <div className="flex flex-wrap gap-1.5">
                  {stages.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => set('status', s.key as StageKey)}
                      // Selected state comes from the stage's hex, so a recoloured
                      // stage reads the same here as on the board and in the pills.
                      style={form.status === s.key ? stageChipStyle(s.hex) : undefined}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all duration-100 ${
                        form.status === s.key
                          ? 'border-current'
                          : 'bg-bg-sidebar text-ink-muted border-transparent hover:border-ink-faint/40'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Kiirtöö toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => set('kiirtoo', !form.kiirtoo)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all duration-150 ${
                    form.kiirtoo
                      ? 'bg-orange-50 border-orange-400 text-orange-700'
                      : 'bg-bg-sidebar border-ink-faint/30 text-ink-muted hover:border-ink-faint/60'
                  }`}
                >
                  <Zap size={14} className={form.kiirtoo ? 'text-orange-500 fill-orange-400' : ''} />
                  {form.kiirtoo ? 'Kiirtöö — hind 2×' : 'Kiirtöö'}
                </button>
              </div>

              {/* Kuupäev + Patsient */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Kuupäev</label>
                  <input
                    type="date"
                    value={form.kuupaev}
                    onChange={e => set('kuupaev', e.target.value)}
                    required
                    className="input"
                  />
                </div>
                <PatientPicker
                  name={form.patsient}
                  patientId={form.patient_id}
                  onChange={(nimi, pid) => setForm(f => ({ ...f, patsient: nimi, patient_id: pid }))}
                  required
                />
              </div>

              {/* Töö — multi-select grid + shared odontogram */}
              <div>
                <label className="label">Töö tüüp (vali üks või mitu)</label>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {settings.tooTuubid.map(t => {
                    const hasItem = form.work_items.some(i => i.too === t.nimi)
                    const img = workTypeImage(t.nimi, t.pilt)
                    return (
                      <button
                        key={t.nimi}
                        type="button"
                        onClick={() => {
                          if (hasItem) {
                            // Remove this type
                            const next = form.work_items.filter(i => i.too !== t.nimi)
                            setForm(f => ({ ...f, work_items: next, too: next[0]?.too ?? '' }))
                          } else {
                            // Add this type
                            const item = { id: crypto.randomUUID(), too: t.nimi, hambad: '' }
                            const next = [...form.work_items, item]
                            setForm(f => ({ ...f, work_items: next, too: next[0]?.too ?? t.nimi }))
                          }
                        }}
                        title={t.hind != null
                          ? `${t.hind.toFixed(2)} € ${t.hinnaTyyp === 'hammas' ? '/ hammas' : '/ töö'}`
                          : t.nimi}
                        className={`relative rounded-lg border-2 overflow-hidden text-left transition-all duration-100 ${
                          hasItem ? 'border-accent shadow-card' : 'border-ink-faint/25 hover:border-accent/40'
                        }`}
                      >
                        <span
                          className="flex h-10 items-center justify-center"
                          style={{ backgroundColor: `${t.hex}${hasItem ? '30' : '1f'}` }}
                        >
                          {img
                            ? <img src={img} alt="" className="h-full w-full object-cover" />
                            : <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.hex }} />}
                        </span>
                        <span className={`block px-1.5 py-1 text-[11px] font-medium truncate ${
                          hasItem ? 'text-accent' : 'text-ink'
                        }`}>
                          {t.nimi}
                        </span>
                        {t.hind != null && (
                          <span className="absolute top-0.5 right-0.5 text-[9px] font-bold px-1 rounded bg-bg-card/90 text-ink-muted tabular-nums">
                            {t.hind.toFixed(0)}€{t.hinnaTyyp === 'hammas' ? '/h' : ''}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Selected types as chips — click to activate, + to duplicate */}
                {form.work_items.length > 0 && (() => {
                  // Count instances per type for numbering (Sild 1, Sild 2)
                  const typeCountMap = new Map<string, number>()
                  form.work_items.forEach(i => typeCountMap.set(i.too, (typeCountMap.get(i.too) ?? 0) + 1))
                  const typeSeenMap = new Map<string, number>()

                  return (
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    {form.work_items.map(item => {
                      const hex = settings.tooTuubid.find(t => t.nimi === item.too)?.hex ?? '#94A3B8'
                      const isActive = item.id === activeWorkItemId
                      const teethCount = item.hambad.split(',').filter(t => t.trim()).length
                      const typeTotal = typeCountMap.get(item.too) ?? 1
                      const seen = (typeSeenMap.get(item.too) ?? 0) + 1
                      typeSeenMap.set(item.too, seen)
                      const label = typeTotal > 1 ? `${item.too} ${seen}` : item.too

                      return (
                        <div key={item.id} className="flex items-center gap-0">
                          <button
                            type="button"
                            onClick={() => setActiveWorkItemId(isActive ? null : item.id)}
                            className={`flex items-center gap-1.5 text-xs font-medium pl-2.5 pr-1.5 py-1.5 rounded-l-lg border-2 border-r-0 transition-all ${
                              isActive
                                ? 'border-accent bg-accent/10'
                                : 'border-transparent hover:border-ink-faint/30'
                            }`}
                            style={{ backgroundColor: isActive ? undefined : `${hex}15` }}
                          >
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                            <span style={{ color: isActive ? '#0AB6C4' : hex }}>{label}</span>
                            {teethCount > 0 && (
                              <span className="text-[10px] text-ink-faint">{teethCount}</span>
                            )}
                            {/* Bridge toggle */}
                            <span
                              role="button"
                              onClick={e => {
                                e.stopPropagation()
                                setForm(f => ({
                                  ...f,
                                  work_items: f.work_items.map(i => i.id === item.id ? { ...i, bridge: !i.bridge } : i)
                                }))
                              }}
                              title={item.bridge ? 'Eemalda silla märge' : 'Märgi sillaks'}
                              className={`text-[10px] px-1 py-0.5 rounded transition-colors ${
                                item.bridge ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink-muted'
                              }`}
                            >
                              {item.bridge ? '⛓ sild' : '⛓'}
                            </span>
                          </button>
                          {/* + add another / × remove */}
                          <button
                            type="button"
                            title={`Lisa veel üks ${item.too}`}
                            onClick={e => {
                              e.stopPropagation()
                              const newItem = { id: crypto.randomUUID(), too: item.too, hambad: '' }
                              setForm(f => {
                                const idx = f.work_items.findIndex(i => i.id === item.id)
                                const next = [...f.work_items]
                                next.splice(idx + 1, 0, newItem)
                                return { ...f, work_items: next }
                              })
                              setActiveWorkItemId(newItem.id)
                            }}
                            className={`text-[10px] font-bold px-1 py-1.5 border-2 border-l-0 transition-colors ${
                              isActive
                                ? 'border-accent bg-accent/5 text-accent hover:bg-accent/15'
                                : 'border-transparent text-ink-faint hover:text-ink-muted'
                            }`}
                            style={{ backgroundColor: isActive ? undefined : `${hex}08` }}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            title="Eemalda"
                            onClick={e => {
                              e.stopPropagation()
                              setForm(f => {
                                const next = f.work_items.filter(i => i.id !== item.id)
                                return { ...f, work_items: next, too: next[0]?.too ?? '' }
                              })
                              if (activeWorkItemId === item.id) setActiveWorkItemId(null)
                            }}
                            className={`text-[10px] font-bold px-1 py-1.5 rounded-r-lg border-2 border-l-0 transition-colors ${
                              isActive
                                ? 'border-accent bg-accent/5 text-red-400 hover:text-red-500 hover:bg-red-50'
                                : 'border-transparent text-ink-faint hover:text-red-400'
                            }`}
                            style={{ backgroundColor: isActive ? undefined : `${hex}08` }}
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                    <p className="text-[10px] text-ink-faint">
                      {activeWorkItemId ? 'Klõpsa hammastel' : 'Vali tüüp, et hambaid märkida'}
                    </p>
                  </div>
                  )
                })()}

                {/* Shared odontogram for all work items */}
                {form.work_items.length > 0 && (
                  <div className="bg-bg-sidebar rounded-xl p-3">
                    <MultiOdontogramPicker
                      items={form.work_items}
                      activeItemId={activeWorkItemId}
                      colorMap={Object.fromEntries(settings.tooTuubid.map(t => [t.nimi, t.hex]))}
                      onToggleTooth={tooth => {
                        if (!activeWorkItemId) return
                        const s = String(tooth)
                        setForm(f => ({
                          ...f,
                          work_items: f.work_items.map(item => {
                            if (item.id === activeWorkItemId) {
                              const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
                              teeth.has(s) ? teeth.delete(s) : teeth.add(s)
                              return { ...item, hambad: [...teeth].join(',') }
                            }
                            // Remove from other items (tooth can only be in one)
                            const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
                            if (teeth.has(s)) { teeth.delete(s); return { ...item, hambad: [...teeth].join(',') } }
                            return item
                          })
                        }))
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Kirjeldus */}
              <div>
                <label className="label">Kirjeldus</label>
                <textarea
                  value={form.kirjeldus ?? ''}
                  onChange={e => set('kirjeldus', e.target.value)}
                  placeholder="Töö kirjeldus…"
                  rows={2}
                  className="input resize-none"
                />
              </div>

              {/* Materjal */}
              <div>
                <label className="label">Materjal</label>
                {(() => {
                  // Sort longest-first so "Ceramic Crown HT" always wins over "Ceramic Crown"
                  const baseMat = [...settings.materjalid]
                    .sort((a, b) => b.length - a.length)
                    .find(m => form.materjal === m || (form.materjal ?? '').startsWith(m + ' ')) ?? null
                  const shades = baseMat ? MATERIAL_SHADES[baseMat] : undefined
                  const currentShade = baseMat && form.materjal !== baseMat
                    ? (form.materjal ?? '').slice(baseMat.length + 1)
                    : null
                  return (
                    <>
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {settings.materjalid.map(m => {
                          const active = baseMat === m
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => set('materjal', active ? '' : m)}
                              className={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-100 font-medium ${
                                active
                                  ? 'bg-accent text-white border-accent'
                                  : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                              }`}
                            >
                              {m}
                            </button>
                          )
                        })}
                      </div>
                      {/* Shade sub-selector */}
                      {shades && (
                        <div className="flex items-center gap-1.5 flex-wrap mb-2 pl-1">
                          <span className="text-[10px] text-ink-faint font-semibold uppercase tracking-wide">Toon:</span>
                          {shades.map(shade => (
                            <button
                              key={shade}
                              type="button"
                              onClick={() => set('materjal', currentShade === shade ? baseMat! : `${baseMat} ${shade}`)}
                              className={`text-xs px-2 py-0.5 rounded border transition-all duration-100 font-medium ${
                                currentShade === shade
                                  ? 'bg-accent text-white border-accent'
                                  : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                              }`}
                            >
                              {shade}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()}
                <input
                  type="text"
                  value={form.materjal ?? ''}
                  onChange={e => set('materjal', e.target.value)}
                  placeholder="Või sisesta vabalt…"
                  className="input"
                />
              </div>

              {/* Masin */}
              <div>
                <label className="label flex items-center gap-1.5">
                  <Cpu size={11} /> Masin
                </label>
                <div className="flex gap-2 flex-wrap">
                  {settings.masinad.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => set('masina', form.masina === m ? '' : m)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all duration-100 ${
                        form.masina === m
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Teostaja + Disainija — what worker pay is calculated from.
                  Two fields because design is compensated separately: often the
                  same person, sometimes not, sometimes outsourced (leave empty). */}
              <div className="grid grid-cols-2 gap-4">
                <WorkerSelect
                  label="Teostaja"
                  value={form.assigned_to}
                  onChange={v => set('assigned_to', v)}
                />
                <WorkerSelect
                  label="Disainija"
                  value={form.designed_by}
                  onChange={v => set('designed_by', v)}
                />
              </div>

              {/* Print ID + Disain ID */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Print ID</label>
                  <input
                    type="text"
                    value={form.print_id ?? ''}
                    onChange={e => set('print_id', e.target.value)}
                    placeholder="SprintRay töö nr…"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Disain ID</label>
                  <input
                    type="text"
                    value={form.disain_id ?? ''}
                    onChange={e => set('disain_id', e.target.value)}
                    placeholder="Disaini viide…"
                    className="input"
                  />
                </div>
              </div>

              {/* Värv */}
              <div>
                <label className="label">Värv (VITA)</label>
                <ShadePicker value={form.varv ?? null} onChange={v => set('varv', v)} />
              </div>

              {/* Valmis aeg */}
              <div>
                <label className="label">Valmis aeg (tähtaeg)</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={(form.valmis_aeg ?? '').split('T')[0] || ''}
                    onChange={e => {
                      const time = (form.valmis_aeg ?? '').split('T')[1] || '12:00'
                      set('valmis_aeg', e.target.value ? `${e.target.value}T${time}` : '')
                    }}
                    className="input flex-1"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="HH:MM"
                    maxLength={5}
                    value={(form.valmis_aeg ?? '').split('T')[1]?.slice(0, 5) || ''}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9:]/g, '')
                      const date = (form.valmis_aeg ?? '').split('T')[0]
                      if (date) set('valmis_aeg', `${date}T${raw}`)
                    }}
                    className="input w-24"
                  />
                </div>
              </div>

            </div>

            {/* ── RIGHT COLUMN (bottom mode) / continuation (side mode) ── */}
            <div className="space-y-5">
              {/* No work type selected — hint to pick one first */}
              {form.work_items.length === 0 && (
              <div className="bg-bg-sidebar rounded-xl p-4 text-center">
                <p className="text-xs text-ink-faint">Vali ülalt töötüüp, et hambaid märkida</p>
              </div>
              )}

              {/* Pricing block — after teeth in both modes */}
              <PricingBlock
                form={form} set={set} settings={settings}
                smallCount={smallCount} largeCount={largeCount}
                prodPrice={prodPrice} hasCalc={hasCalc}
                onHindChange={v => { hindAutoRef.current = false; set('hind', v) }}
                useDiscount={useDiscount} onDiscountChange={setUseDiscount}
                onRequestMarkPaid={job ? () => setPaidDialog(true) : undefined}
                paidSoFar={job ? jobPayments.filter(p => p.job_id === job.id)
                  .reduce((s, p) => s + Number(p.amount), 0) : 0}
              />

              {/* Muudatused */}
              <RevisionBlock
                value={form.revisions}
                // Whichever variant was on screen in view mode — so pressing
                // Muuda while looking at a revision opens that revision expanded.
                autoExpandId={activeRevId ?? highlightRevisionId}
                onChange={revs => set('revisions', revs)}
              />
            </div>

          </div>
        </form>
        )}

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-nav/10 flex-shrink-0 bg-nav-bg">
          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>
          )}
          <div className="flex items-center justify-between">
            {job && !editing ? (
              <button type="button" onClick={onClose} className="text-nav-muted hover:text-nav font-medium px-3 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm ml-auto">
                Sulge
              </button>
            ) : (
              <>
                <button
                  type="button"
                  // Editing an existing job returns to its view; a new job has
                  // nothing to return to, so it closes the panel.
                  onClick={() => (job ? setEditing(false) : onClose())}
                  className="btn-ghost"
                >
                  Tühista
                </button>
                <button
                  type="submit"
                  form="job-form"
                  disabled={saving || !form.patsient}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {job ? 'Salvesta' : 'Loo töö'}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Marking paid always records HOW — never a bare boolean flip. */}
      {paidDialog && job && (() => {
        const total = Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
          + (job.revisions ?? []).reduce((s, r) => s + Number(r.price ?? 0), 0)
        const already = jobPayments
          .filter(p => p.job_id === job.id)
          .reduce((s, p) => s + Number(p.amount), 0)
        return (
          <MarkPaidDialog
            title={`Märgi makstuks · ${job.too ?? 'Töö'}`}
            amount={total}
            alreadyPaid={already}
            busy={markPaid.isPending}
            onClose={() => setPaidDialog(false)}
            onConfirm={async details => {
              const paying = details.amount ?? Math.max(0, total - already)
              await markPaid.mutateAsync({
                jobs: [{ id: job.id, amount: paying, total: Math.max(0, total - already) }],
                method: details.method,
                paid_at: details.paid_at,
                reference: details.reference,
              })
              if (paying >= Math.max(0, total - already) - 0.005) {
                set('makstud', true)
                set('makse_kuupaev', details.paid_at)
              }
              setPaidDialog(false)
            }}
            onConfirmMulti={async detailsList => {
              const owed = Math.max(0, total - already)
              let totalPaying = 0
              for (const details of detailsList) {
                const paying = details.amount ?? 0
                totalPaying += paying
                await markPaid.mutateAsync({
                  jobs: [{ id: job.id, amount: paying, total: owed }],
                  method: details.method,
                  paid_at: details.paid_at,
                  reference: details.reference,
                })
              }
              if (totalPaying >= owed - 0.005) {
                set('makstud', true)
                set('makse_kuupaev', detailsList[0]?.paid_at ?? '')
              }
              setPaidDialog(false)
            }}
          />
        )
      })()}
    </AnimatePresence>
  )
}
