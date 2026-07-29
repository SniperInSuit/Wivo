import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Trash2, Euro, Check, Calendar, Save, Loader2, Cpu, Calculator, Pencil, Zap
} from 'lucide-react'
import type { Job, JobInput, StageKey, Revision } from '../../types/job'
import { MATERIAL_OPTIONS, MATERIAL_SHADES, MACHINE_OPTIONS } from '../../types/job'
import { usePipeline } from '../../context/PipelineContext'
import { OdontogramPicker } from './OdontogramPicker'
import { ShadePicker } from './ShadePicker'
import { RevisionBlock } from './RevisionBlock'
import { PatientPicker } from '../Patients/PatientPicker'
import { JobReadView } from './JobReadView'
import { StatusPill } from '../ui/StatusPill'
import { useSettings, calcProduction, countSmallTeeth, countLargeTeeth } from '../../stores/useSettings'

function getJobTypeBg(too: string | null | undefined): string {
  if (!too) return 'bg-slate-300'
  const t = too.toLowerCase()
  if (t.includes('kroon')  || t.includes('crown'))   return 'bg-blue-300'
  if (t.includes('sild')   || t.includes('bridge'))  return 'bg-violet-300'
  if (t.includes('viniir') || t.includes('veneer'))  return 'bg-emerald-300'
  if (t.includes('laminaat'))                         return 'bg-lime-300'
  if (t.includes('inlay'))                            return 'bg-amber-300'
  if (t.includes('onlay'))                            return 'bg-orange-300'
  if (t.includes('täidis') || t.includes('taidis'))  return 'bg-yellow-300'
  if (t.includes('proteez')|| t.includes('denture')) return 'bg-rose-300'
  if (t.includes('splint') || t.includes('splaad'))  return 'bg-cyan-300'
  if (t.includes('ibt'))                              return 'bg-indigo-300'
  if (t.includes('kirur')  || t.includes('surgic'))  return 'bg-teal-300'
  if (t.includes('allon')  || t.includes('all-on'))  return 'bg-pink-300'
  return 'bg-slate-300'
}

interface JobDetailPanelProps {
  job: Job | null       // null = create mode
  onClose: () => void
  onSave: (input: JobInput) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  saving?: boolean
  position?: 'side' | 'bottom'  // default: side
  initialDate?: string           // pre-fill valmis_aeg for new jobs (ISO or datetime-local)
  highlightRevisionId?: string   // auto-expand + scroll to this revision on open
}

const EMPTY_FORM: JobInput = {
  status: 'disain',
  kuupaev: new Date().toISOString().split('T')[0],
  patsient: '',
  patient_id: null,
  too: '',
  materjal: '',
  masina: '',
  print_id: '',
  varv: '',
  hambad: '',
  valmis_aeg: '',
  kiirtoo: false,
  revisions: [],
  hind: null,
  disain_hind: null,
  makstud: false,
  makse_kuupaev: ''
}

// ─── Pricing sub-component (shared between side + bottom layouts) ─────────────
function PricingBlock({ form, set, settings, smallCount, largeCount, prodPrice, hasCalc, onHindChange }: {
  form: JobInput
  set: <K extends keyof JobInput>(key: K, val: JobInput[K]) => void
  settings: ReturnType<typeof useSettings>['settings']
  smallCount: number
  largeCount: number
  prodPrice: number
  hasCalc: boolean
  onHindChange: (v: number | null) => void
}) {
  return (
    <div className="border border-ink-faint/20 rounded-xl p-4 space-y-4">
      <p className="text-sm font-semibold text-ink flex items-center gap-2">
        <Euro size={15} className="text-accent" />
        Hind ja maksmine
      </p>

      {hasCalc && (
        <div className="bg-bg-sidebar rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-ink-muted mb-2">Autoarvutus</p>
          {prodPrice > 0 && form.materjal && (
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
            const total = form.kiirtoo ? base * 2 : base
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
          onClick={() => set('makstud', !form.makstud)}
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

export function JobDetailPanel({ job, onClose, onSave, onDelete, saving, position = 'side', initialDate, highlightRevisionId }: JobDetailPanelProps) {
  const isBottom = position === 'bottom'
  const { settings } = useSettings()
  const { stages } = usePipeline()
  const [form, setForm] = useState<JobInput>(EMPTY_FORM)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  // Opening an existing job shows it, it does not offer to change it. A new job
  // has nothing to look at, so it starts in the form.
  const [editing, setEditing] = useState(job == null)
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
        materjal: job.materjal ?? '',
        masina: job.masina ?? '',
        print_id: job.print_id ?? '',
        varv: job.varv ?? '',
        hambad: job.hambad ?? '',
        valmis_aeg: job.valmis_aeg ? job.valmis_aeg.replace('Z', '').slice(0, 16) : '',
        kiirtoo: job.kiirtoo ?? false,
        revisions,
        hind: job.hind,
        disain_hind: job.disain_hind ?? null,
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
  }, [job])

  const set = useCallback(<K extends keyof JobInput>(key: K, val: JobInput[K]) => {
    setForm(f => ({ ...f, [key]: val }))
  }, [])

  // Live auto-price: fires when teeth, material, or kiirtöö change (new jobs only)
  useEffect(() => {
    if (!hindAutoRef.current) return
    const h = form.hambad ?? ''
    const toothCount = h.split(',').filter(Boolean).length
    if (toothCount === 0) return
    const p = form.materjal
      ? calcProduction(h, form.materjal, settings.materialPrices)
      : 0
    const base = p > 0 ? p : toothCount * 15
    const total = form.kiirtoo ? base * 2 : base
    set('hind', parseFloat(total.toFixed(2)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.hambad, form.materjal, form.kiirtoo])

  // Auto-calculate: small teeth + large teeth from settings, plus design fee
  const hambad = form.hambad ?? ''
  const smallCount = countSmallTeeth(hambad)
  const largeCount = countLargeTeeth(hambad)
  const prodPrice = form.materjal
    ? calcProduction(hambad, form.materjal, settings.materialPrices)
    : 0
  const hasCalc = prodPrice > 0 || settings.designFee > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    const cleaned: JobInput = {
      ...form,
      too: form.too || null,
      materjal: form.materjal || null,
      masina: form.masina || null,
      print_id: form.print_id || null,
      varv: form.varv || null,
      hambad: form.hambad || null,
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
            ? 'fixed left-0 right-0 bottom-0 h-[70vh] bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-ink-faint/15'
            : 'fixed right-0 top-0 bottom-0 w-[540px] bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden'
        }
        onClick={e => e.stopPropagation()}
      >
        {/* Work-type color strip — bottom panel only */}
        {isBottom && (
          <div className={`h-1.5 flex-shrink-0 rounded-t-2xl ${getJobTypeBg(job?.too ?? form.too)}`} />
        )}

        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-faint/20 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-ink">
              {!job ? 'Uus töö' : editing ? 'Muuda tööd' : (job.too || 'Töö')}
            </h2>
            {job && <StatusPill status={job.status} />}
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
          <div className="flex-1 overflow-y-auto">
            <JobReadView job={job} isBottom={isBottom} highlightRevisionId={highlightRevisionId} />
          </div>
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
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all duration-100 ${
                        form.status === s.key
                          ? `${s.bg} ${s.color} border-current`
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

              {/* Töö */}
              <div>
                <label className="label">Töö</label>
                <input
                  type="text"
                  value={form.too ?? ''}
                  onChange={e => set('too', e.target.value)}
                  placeholder="Kroon, sild, viniir…"
                  list="too-suggestions"
                  className="input"
                />
                <datalist id="too-suggestions">
                  {['Kroon', 'Abutmendile kroon', 'Implantkroon', 'Sild', 'Viniir', 'Laminaat', 'Inlay', 'Onlay', 'Täidis', 'Proteez', 'Allon4', 'Allon5', 'Allon6', 'Nightguard', 'Retainer', 'Splint'].map(v => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                {/* Jaw picker — shown when work type starts with Allon */}
                {/^allon/i.test(form.too ?? '') && (() => {
                  const base = (form.too ?? '').replace(/\s+(ülemine|alumine)$/i, '').trim()
                  const jaw = /ülemine/i.test(form.too ?? '') ? 'ülemine'
                    : /alumine/i.test(form.too ?? '') ? 'alumine' : null
                  return (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-ink-muted">Lõug:</span>
                      {(['Ülemine', 'Alumine'] as const).map(j => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => set('too', jaw?.toLowerCase() === j.toLowerCase() ? base : `${base} ${j.toLowerCase()}`)}
                          className={`text-xs px-3 py-1 rounded-lg border-2 font-semibold transition-all ${
                            jaw?.toLowerCase() === j.toLowerCase()
                              ? 'bg-accent text-white border-accent'
                              : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                          }`}
                        >
                          {j}
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>

              {/* Materjal */}
              <div>
                <label className="label">Materjal</label>
                {(() => {
                  // Sort longest-first so "Ceramic Crown HT" always wins over "Ceramic Crown"
                  const baseMat = ([...MATERIAL_OPTIONS] as string[])
                    .sort((a, b) => b.length - a.length)
                    .find(m => form.materjal === m || (form.materjal ?? '').startsWith(m + ' ')) ?? null
                  const shades = baseMat ? MATERIAL_SHADES[baseMat] : undefined
                  const currentShade = baseMat && form.materjal !== baseMat
                    ? (form.materjal ?? '').slice(baseMat.length + 1)
                    : null
                  return (
                    <>
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {MATERIAL_OPTIONS.map(m => {
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
                <div className="flex gap-2">
                  {MACHINE_OPTIONS.map(m => (
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

              {/* Print ID */}
              <div>
                <label className="label">Print ID</label>
                <input
                  type="text"
                  value={form.print_id ?? ''}
                  onChange={e => set('print_id', e.target.value)}
                  placeholder="SprintRay töö number…"
                  className="input"
                />
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
              {/* Hambad */}
              <div>
                <label className="label">Hambad (FDI)</label>
                <div className="bg-bg-sidebar rounded-xl p-3">
                  <OdontogramPicker
                    value={form.hambad ?? ''}
                    onChange={v => set('hambad', v)}
                  />
                </div>
              </div>

              {/* Pricing block — after teeth in both modes */}
              <PricingBlock
                form={form} set={set} settings={settings}
                smallCount={smallCount} largeCount={largeCount}
                prodPrice={prodPrice} hasCalc={hasCalc}
                onHindChange={v => { hindAutoRef.current = false; set('hind', v) }}
              />

              {/* Muudatused */}
              <RevisionBlock
                value={form.revisions}
                autoExpandId={highlightRevisionId}
                onChange={revs => set('revisions', revs)}
              />
            </div>

          </div>
        </form>
        )}

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-ink-faint/20 flex-shrink-0 bg-bg-card">
          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>
          )}
          <div className="flex items-center justify-between">
            {job && !editing ? (
              <>
                <button type="button" onClick={onClose} className="btn-ghost">
                  Sulge
                </button>
                <button type="button" onClick={() => setEditing(true)} className="btn-primary">
                  <Pencil size={14} />
                  Muuda
                </button>
              </>
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
    </AnimatePresence>
  )
}
