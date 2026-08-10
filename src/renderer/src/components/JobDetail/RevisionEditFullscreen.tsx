/**
 * Full-screen revision editor — same layout as job edit but dark themed.
 * Uses the same components (MultiOdontogramPicker, ShadePicker, etc).
 */
import { useState, useCallback } from 'react'
import { debugLog } from '../Workers/DebugConsole'
import { Save, Loader2, Zap, Euro, Cpu, Banknote, Check } from 'lucide-react'
import type { Revision, StageKey } from '../../types/job'
import { MATERIAL_SHADES, REVISION_REASONS, revisionReasons } from '../../types/job'
import { OdontogramPicker } from './OdontogramPicker'
import { WorkItemsField } from './WorkItemsField'
import { WorkerSelect } from './WorkerSelect'
import { ShadePicker } from './ShadePicker'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings, countSmallTeeth, countLargeTeeth } from '../../stores/useSettings'
import { stageChipStyle } from '../../config/pipeline'
import { MACHINE_OPTIONS } from '../../types/job'
import { jobMaterialCost } from '../../lib/finance'
import { pickRateFor, type WorkerRate } from '../../lib/earnings'
import { useWorkerRates } from '../../hooks/useWorkerPay'
import { resolveWorkType } from '../../config/workTypes'

interface RevisionEditFullscreenProps {
  revision: Revision
  onSave: (updated: Revision) => void
  onCancel: () => void
  saving?: boolean
}

export function RevisionEditFullscreen({ revision, onSave, onCancel, saving }: RevisionEditFullscreenProps) {
  const { stages } = usePipeline()
  const { settings } = useSettings()
  const wt = settings.tooTuubid
  const { data: allRates = [] } = useWorkerRates()

  const [form, setForm] = useState({
    note: revision.note,
    reasons: revisionReasons(revision),
    // null = whoever is on the job. A remake is often picked up by someone else.
    assigned_to: revision.assigned_to ?? null as string | null,
    designed_by: revision.designed_by ?? null as string | null,
    work_items: Array.isArray(revision.work_items) ? revision.work_items.map(i => ({ ...i })) : [],
    hambad: revision.hambad ?? '',
    varv: revision.varv ?? null as string | null,
    materjal: revision.materjal ?? '',
    deadline: revision.deadline ? revision.deadline.replace('Z', '').slice(0, 16) : '',
    kiirtoo: revision.kiirtoo ?? false,
    mudel: revision.mudel ?? false,
    taspidev: revision.taspidev !== false,  // default true (billable)
    purunenud_hambad: revision.purunenud_hambad ?? '',
    extra_costs: Array.isArray(revision.extra_costs) && revision.extra_costs.length > 0
      ? revision.extra_costs.map(c => ({ ...c }))
      : [] as { nimi: string; summa: number }[],
    print_id: revision.print_id ?? '',
    disain_id: revision.disain_id ?? '',
    status: revision.status ?? 'disain' as StageKey,
  })

  const [showBreakageOdonto, setShowBreakageOdonto] = useState(false)

  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(
    form.work_items[0]?.id ?? null
  )

  const set = useCallback(<K extends keyof typeof form>(key: K, val: (typeof form)[K]) => {
    debugLog('info', `RevisionEdit set: ${String(key)}`, val)
    setForm(f => ({ ...f, [key]: val }))
  }, [])

  // Auto-computed revision cost: material + consumables
  const allHambad = form.work_items.length > 0
    ? form.work_items.map(i => i.hambad).filter(Boolean).join(',')
    : form.hambad
  // Auto cost: material + actual worker rate + extra costs
  const matCost = jobMaterialCost(
    { materjal: form.materjal, hambad: allHambad, masina: null },
    settings.materialCosts, settings.materialPrices
  ) ?? 0
  const teethCount = allHambad.split(',').filter(t => t.trim()).length
  const today = new Date().toISOString().slice(0, 10)
  const types = wt

  // Technician labour from their actual pay rules
  const techId = form.assigned_to
  const techRates = techId ? allRates.filter(r => r.profile_id === techId) : []
  const primaryToo = form.work_items[0]?.too ?? null
  const techRate = techId ? pickRateFor(techRates, primaryToo, today, types, 'muudatus')
    ?? pickRateFor(techRates, primaryToo, today, types, 'too')
    : null
  let techCost = 0
  let techLabel = ''
  if (techRate) {
    switch (techRate.kind) {
      case 'hammas': techCost = teethCount * techRate.amount; techLabel = `${teethCount} × ${techRate.amount} €/hammas`; break
      case 'too':    techCost = techRate.amount; techLabel = `${techRate.amount} €/töö`; break
      default:       break
    }
  }

  // Designer labour
  const designId = form.designed_by
  const designRates = designId ? allRates.filter(r => r.profile_id === designId) : []
  const designRate = designId ? pickRateFor(designRates, primaryToo, today, types, 'disain') : null
  let designCost = 0
  let designLabel = ''
  if (designRate) {
    switch (designRate.kind) {
      case 'hammas': designCost = teethCount * designRate.amount; designLabel = `${teethCount} × ${designRate.amount} €/hammas`; break
      case 'too':    designCost = designRate.amount; designLabel = `${designRate.amount} €/töö`; break
      default:       break
    }
  }

  const labourCost = form.taspidev ? Math.round((techCost + designCost) * 100) / 100 : 0
  const extraTotal = form.extra_costs.reduce((s, c) => s + (c.summa || 0), 0)
  const autoPrice = Math.round((matCost + labourCost + extraTotal) * (form.kiirtoo ? settings.kiirtooKordaja : 1) * 100) / 100

  function handleSubmit(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault()
    if (!form.note.trim()) return
    onSave({
      ...revision,
      note: form.note.trim(),
      reasons: form.reasons.length > 0 ? form.reasons : undefined,
      assigned_to: form.assigned_to ?? undefined,
      designed_by: form.designed_by ?? undefined,
      work_items: form.work_items.length > 0 ? form.work_items : undefined,
      hambad: form.work_items.length > 0
        ? [...new Set(form.work_items.flatMap(i => i.hambad.split(',').filter(t => t.trim())))].join(',') || undefined
        : (form.hambad || undefined),
      varv: form.varv || undefined,
      materjal: (form.work_items.length > 1
        ? form.work_items[0]?.materjal ?? form.materjal
        : form.materjal) || undefined,
      deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
      price: autoPrice > 0 ? autoPrice : undefined,
      extra_costs: form.extra_costs.filter(c => c.nimi.trim() && c.summa > 0).length > 0
        ? form.extra_costs.filter(c => c.nimi.trim() && c.summa > 0)
        : undefined,
      kiirtoo: form.kiirtoo || undefined,
      mudel: form.mudel || undefined,
      taspidev: form.taspidev ? undefined : false,
      purunenud_hambad: form.purunenud_hambad || undefined,
      print_id: form.print_id || undefined,
      disain_id: form.disain_id || undefined,
      status: form.status || 'disain',
    })
  }

  const colorMap = Object.fromEntries(wt.map(t => [t.nimi, t.hex]))

  return (
    <div className="fixed inset-0 bg-slate-900 z-[60] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-700/50 flex-shrink-0">
        <h2 className="text-base font-bold text-slate-100">Muuda muudatust</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
            Tühista
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !form.note.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvesta
          </button>
        </div>
      </div>

      {/* Form — 3 column layout like job edit */}
      <div className="flex-1 overflow-y-auto">
        {/* Two columns, not three. The third was empty and cost a quarter of
            the width, which pushed the odontogram far enough down the page to
            need scrolling on a laptop. */}
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] gap-x-6 items-start">

          {/* ── LEFT COLUMN ── */}
          <div className="space-y-5">
            {/* Status */}
            <div>
              <label className="label text-slate-400">Staatus</label>
              <div className="flex flex-wrap gap-1.5">
                {stages.map(s => (
                  <button key={s.key} type="button"
                    onClick={() => set('status', s.key as StageKey)}
                    style={form.status === s.key ? stageChipStyle(s.hex) : undefined}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                      form.status === s.key ? 'border-current' : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Kiirtöö + Mudel */}
            <div className="flex gap-2">
              <button type="button" onClick={() => set('kiirtoo', !form.kiirtoo)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                  form.kiirtoo ? 'bg-orange-900/30 border-orange-500 text-orange-300' : 'bg-slate-800 border-slate-600 text-slate-400'
                }`}
              >
                <Zap size={14} className={form.kiirtoo ? 'text-orange-400 fill-orange-300' : ''} />
                {form.kiirtoo ? `Kiirtöö — hind ${settings.kiirtooKordaja}×` : 'Kiirtöö'}
              </button>
              <button type="button" onClick={() => set('mudel', !form.mudel)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                  form.mudel ? 'bg-amber-900/30 border-amber-500 text-amber-300' : 'bg-slate-800 border-slate-600 text-slate-400'
                }`}
              >
                <Cpu size={14} className={form.mudel ? 'text-amber-400' : ''} />
                {form.mudel ? 'Mudel' : 'Mudel'}
              </button>
              <button type="button" onClick={() => set('taspidev', !form.taspidev)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                  form.taspidev ? 'bg-emerald-900/30 border-emerald-500 text-emerald-300' : 'bg-red-900/30 border-red-500 text-red-300'
                }`}
              >
                <Banknote size={14} className={form.taspidev ? 'text-emerald-400' : 'text-red-400'} />
                {form.taspidev ? 'Tasustatud' : 'Tasustamata'}
              </button>
            </div>

            {/* Kirjeldus (note) */}
            <div>
              <label className="label text-slate-400">Kirjeldus *</label>
              <textarea value={form.note} onChange={e => set('note', e.target.value)}
                placeholder="Kirjelda vajalikud muudatused…" rows={3} autoFocus
                className="input resize-none bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent"
              />
            </div>

            {/* Reasons */}
            <div className="relative">
              <label className="label text-slate-400">Põhjus</label>
              <div className="flex flex-wrap gap-1.5">
                {REVISION_REASONS.map(r => (
                  <button key={r} type="button"
                    onClick={() => {
                      const has = form.reasons.includes(r)
                      set('reasons', has ? form.reasons.filter(x => x !== r) : [...form.reasons, r])
                      if (r === 'Purunemine' && !has) setShowBreakageOdonto(true)
                      if (r === 'Purunemine' && has) set('purunenud_hambad', '')
                    }}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all font-medium ${
                      form.reasons.includes(r) ? 'bg-pink-500 text-white border-pink-500' : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Breakage teeth shown after popup is closed */}
              {form.reasons.includes('Purunemine') && form.purunenud_hambad && !showBreakageOdonto && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowBreakageOdonto(true)}
                    className="flex items-center gap-1.5 flex-wrap text-xs text-slate-300 hover:text-white transition-colors"
                  >
                    <span className="text-red-400 font-medium">Purunenud:</span>
                    {form.purunenud_hambad.split(',').filter(t => t.trim()).map(t => (
                      <span key={t} className="bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
                        {t.trim()}
                      </span>
                    ))}
                  </button>
                </div>
              )}

              {/* Breakage odontogram popup */}
              {showBreakageOdonto && (
                <div className="absolute z-50 left-0 right-0 mt-2 bg-slate-800 border border-slate-600 rounded-xl p-4 shadow-panel">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-red-400">Märgi purunenud hambad</label>
                    <button type="button" onClick={() => setShowBreakageOdonto(false)}
                      className="flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-lg bg-emerald-500/10 transition-colors"
                    >
                      <Check size={12} /> Valmis
                    </button>
                  </div>
                  <OdontogramPicker
                    value={form.purunenud_hambad}
                    onChange={v => set('purunenud_hambad', v)}
                  />
                </div>
              )}
            </div>

            {/* Materjal — per-work-item when multiple items exist */}
            <div>
              {(() => {
                const activeItem = form.work_items.find(i => i.id === activeWorkItemId)
                const hasItems = form.work_items.length > 1
                const currentMat = hasItems && activeItem ? (activeItem.materjal ?? '') : form.materjal
                const setMat = (val: string) => {
                  if (hasItems && activeItem) {
                    setForm(f => ({
                      ...f,
                      work_items: f.work_items.map(i => i.id === activeItem.id ? { ...i, materjal: val || undefined } : i),
                      materjal: f.work_items[0]?.id === activeItem.id ? val : f.materjal,
                    }))
                  } else {
                    set('materjal', val)
                  }
                }
                const sortedMats = [...settings.materjalid].sort((a, b) => b.length - a.length)
                const baseMat = sortedMats.find(m => currentMat === m || currentMat.startsWith(m + ' ')) ?? null
                const shades = baseMat ? MATERIAL_SHADES[baseMat] : undefined
                const currentShade = baseMat && currentMat !== baseMat ? currentMat.slice(baseMat.length + 1) : null
                return (
                  <>
                    <label className="label text-slate-400">
                      Materjal
                      {hasItems && activeItem && (
                        <span className="text-accent font-normal ml-1">— {activeItem.too}</span>
                      )}
                      {hasItems && !activeItem && (
                        <span className="text-slate-500 font-normal ml-1">— vali tööosa</span>
                      )}
                    </label>
                    <div className="flex gap-1.5 mb-2 flex-wrap">
                      {settings.materjalid.map(m => {
                        const active = baseMat === m
                        return (
                          <button key={m} type="button"
                            disabled={hasItems && !activeItem}
                            onClick={() => setMat(active ? '' : m)}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                              active
                                ? 'bg-accent/15 border-accent text-accent'
                                : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            {m}
                          </button>
                        )
                      })}
                    </div>
                    {shades && shades.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {shades.map(s => {
                          const full = `${baseMat} ${s}`
                          const active = currentMat === full || currentShade === s
                          return (
                            <button key={s} type="button"
                              onClick={() => setMat(active ? (baseMat ?? '') : full)}
                              className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all ${
                                active
                                  ? 'bg-accent/15 border-accent text-accent'
                                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400'
                              }`}
                            >
                              {s}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Who redid it — what the rework pay is calculated from. Empty
                means the people already on the job. */}
            <div className="grid grid-cols-2 gap-3">
              <WorkerSelect
                label="Teostaja"
                value={form.assigned_to}
                onChange={v => set('assigned_to', v)}
                emptyLabel="Sama mis tööl"
                showNone
                dark
              />
              <WorkerSelect
                label="Disainija"
                value={form.designed_by}
                onChange={v => set('designed_by', v)}
                emptyLabel="Sama mis tööl"
                showNone
                dark
              />
            </div>

            {/* Värv */}
            <div>
              <label className="label text-slate-400">Uus värv</label>
              <ShadePicker value={form.varv} onChange={v => set('varv', v)} />
            </div>

            {/* Print ID + Disain ID */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-slate-400">Print ID</label>
                <input type="text" value={form.print_id} onChange={e => set('print_id', e.target.value)}
                  placeholder="SprintRay töö nr…"
                  className="input bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent font-mono"
                />
              </div>
              <div>
                <label className="label text-slate-400">Disain ID</label>
                <input type="text" value={form.disain_id ?? ''} onChange={e => set('disain_id', e.target.value)}
                  placeholder="Disaini faili viide…"
                  className="input bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent font-mono"
                />
              </div>
            </div>

            {/* Deadline */}
            <div>
              <label className="label text-slate-400">Uus tähtaeg</label>
              <div className="flex gap-2">
                <input type="date"
                  value={(form.deadline ?? '').split('T')[0] || ''}
                  onChange={e => {
                    const time = (form.deadline ?? '').split('T')[1] || '12:00'
                    set('deadline', e.target.value ? `${e.target.value}T${time}` : '')
                  }}
                  className="input flex-1 bg-slate-800 border-slate-600 text-slate-100 focus:border-accent"
                />
                <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
                  value={(form.deadline ?? '').split('T')[1]?.slice(0, 5) || ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9:]/g, '')
                    const date = (form.deadline ?? '').split('T')[0]
                    if (date) set('deadline', `${date}T${raw}`)
                  }}
                  className="input w-24 bg-slate-800 border-slate-600 text-slate-100 focus:border-accent"
                />
              </div>
            </div>

            {/* Auto-computed cost */}
            <div>
              <label className="label text-slate-400 flex items-center gap-1"><Euro size={10} /> Ümbertegemise kulu</label>
              <p className="text-lg font-bold text-slate-100 tabular-nums">
                {autoPrice > 0 ? `${autoPrice.toFixed(2)} €` : '—'}
              </p>
              <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
                {techCost > 0 && <p>Tehnik: {techLabel} = {techCost.toFixed(2)} €</p>}
                {designCost > 0 && <p>Disain: {designLabel} = {designCost.toFixed(2)} €</p>}
                {!techId && !form.taspidev && <p className="text-slate-600">Tehnik määramata</p>}
                {techId && techCost === 0 && form.taspidev && <p className="text-slate-600">Tehnikul puudub muudatuse reegel</p>}
                {matCost > 0 && <p>Materjal: {matCost.toFixed(2)} €</p>}
                {extraTotal > 0 && <p>Lisakulud: {extraTotal.toFixed(2)} €</p>}
                {form.kiirtoo && <p>× {settings.kiirtooKordaja} (kiirtöö)</p>}
                {!form.taspidev && <p className="text-amber-400">Tasustamata — tööjõud ei arvestata</p>}
              </div>
            </div>

            {/* Lisakulud — exceptional costs like replacement screws */}
            <div>
              <label className="label text-slate-400">Lisakulud</label>
              <div className="space-y-1.5">
                {form.extra_costs.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={c.nimi}
                      onChange={e => {
                        const next = [...form.extra_costs]
                        next[i] = { ...next[i], nimi: e.target.value }
                        set('extra_costs', next)
                      }}
                      placeholder="Nimi (nt kruvi)"
                      className="input flex-1 bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent text-xs"
                    />
                    <div className="relative w-24">
                      <input type="number" min="0" step="0.01" value={c.summa || ''}
                        onChange={e => {
                          const next = [...form.extra_costs]
                          next[i] = { ...next[i], summa: parseFloat(e.target.value) || 0 }
                          set('extra_costs', next)
                        }}
                        placeholder="0.00"
                        className="input pr-6 bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent text-xs"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">€</span>
                    </div>
                    <button type="button" onClick={() => {
                      set('extra_costs', form.extra_costs.filter((_, j) => j !== i))
                    }} className="text-red-400 hover:text-red-300 text-xs px-1">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => {
                  set('extra_costs', [...form.extra_costs, { nimi: '', summa: 0 }])
                }} className="text-xs text-accent hover:text-accent/80 font-medium">
                  + Lisa kulu
                </button>
              </div>
            </div>
          </div>

          {/* ── CENTER COLUMN — work types + odontogram ── */}
          {/* The same field as the job page and the inline revision form. This
              used to be its own copy, and it was the copy that could not add a
              second item of one type — the chip strip here had no + and no ×. */}
          <div className="space-y-3 sticky top-0">
            <label className="label text-slate-400">Töötüüp ja hambad</label>
            <WorkItemsField
              value={form.work_items}
              onChange={items => set('work_items', items)}
              activeId={activeWorkItemId}
              onActiveChange={setActiveWorkItemId}
              looseTeeth={form.hambad}
              onLooseTeethChange={v => set('hambad', v)}
              dark
              typeColumns={6}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
