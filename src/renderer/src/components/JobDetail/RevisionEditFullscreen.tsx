/**
 * Full-screen revision editor — same layout as job edit but dark themed.
 * Uses the same components (MultiOdontogramPicker, ShadePicker, etc).
 */
import { useState, useEffect, useCallback } from 'react'
import { X, Save, Loader2, Zap, Euro, Cpu } from 'lucide-react'
import type { Revision, StageKey, WorkItem } from '../../types/job'
import { MATERIAL_SHADES, REVISION_REASONS, revisionReasons } from '../../types/job'
import { OdontogramPicker } from './OdontogramPicker'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { ShadePicker } from './ShadePicker'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings } from '../../stores/useSettings'
import { stageChipStyle } from '../../config/pipeline'
import { MACHINE_OPTIONS } from '../../types/job'

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

  const [form, setForm] = useState({
    note: revision.note,
    reasons: revisionReasons(revision),
    work_items: Array.isArray(revision.work_items) ? revision.work_items.map(i => ({ ...i })) : [],
    hambad: revision.hambad ?? '',
    varv: revision.varv ?? null as string | null,
    materjal: revision.materjal ?? '',
    deadline: revision.deadline ? revision.deadline.replace('Z', '').slice(0, 16) : '',
    price: revision.price != null ? String(revision.price) : '',
    kiirtoo: revision.kiirtoo ?? false,
    print_id: revision.print_id ?? '',
    status: revision.status ?? 'disain' as StageKey,
  })

  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(
    form.work_items[0]?.id ?? null
  )

  const set = useCallback(<K extends keyof typeof form>(key: K, val: (typeof form)[K]) => {
    setForm(f => ({ ...f, [key]: val }))
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.note.trim()) return
    onSave({
      ...revision,
      note: form.note.trim(),
      reasons: form.reasons.length > 0 ? form.reasons : undefined,
      work_items: form.work_items.length > 0 ? form.work_items : undefined,
      hambad: form.work_items.length > 0
        ? [...new Set(form.work_items.flatMap(i => i.hambad.split(',').filter(t => t.trim())))].join(',') || undefined
        : (form.hambad || undefined),
      varv: form.varv || undefined,
      materjal: form.materjal || undefined,
      deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
      price: form.price !== '' ? parseFloat(form.price) * (form.kiirtoo ? 2 : 1) : undefined,
      kiirtoo: form.kiirtoo || undefined,
      print_id: form.print_id || undefined,
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
            type="submit"
            form="rev-edit-form"
            disabled={saving || !form.note.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvesta
          </button>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white p-1.5 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Form — 3 column layout like job edit */}
      <form id="rev-edit-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-[1fr_minmax(400px,2fr)_1fr] gap-x-6 items-start">

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

            {/* Kiirtöö */}
            <button type="button" onClick={() => set('kiirtoo', !form.kiirtoo)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                form.kiirtoo ? 'bg-orange-900/30 border-orange-500 text-orange-300' : 'bg-slate-800 border-slate-600 text-slate-400'
              }`}
            >
              <Zap size={14} className={form.kiirtoo ? 'text-orange-400 fill-orange-300' : ''} />
              {form.kiirtoo ? 'Kiirtöö — hind 2×' : 'Kiirtöö'}
            </button>

            {/* Kirjeldus (note) */}
            <div>
              <label className="label text-slate-400">Kirjeldus *</label>
              <textarea value={form.note} onChange={e => set('note', e.target.value)}
                placeholder="Kirjelda vajalikud muudatused…" rows={3} autoFocus
                className="input resize-none bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent"
              />
            </div>

            {/* Reasons */}
            <div>
              <label className="label text-slate-400">Põhjus</label>
              <div className="flex flex-wrap gap-1.5">
                {REVISION_REASONS.map(r => (
                  <button key={r} type="button"
                    onClick={() => set('reasons', form.reasons.includes(r) ? form.reasons.filter(x => x !== r) : [...form.reasons, r])}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all font-medium ${
                      form.reasons.includes(r) ? 'bg-pink-500 text-white border-pink-500' : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Materjal */}
            <div>
              <label className="label text-slate-400">Materjal</label>
              <input type="text" value={form.materjal} onChange={e => set('materjal', e.target.value)}
                placeholder="Uus materjal…"
                className="input bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent"
              />
            </div>

            {/* Värv */}
            <div>
              <label className="label text-slate-400">Uus värv</label>
              <ShadePicker value={form.varv} onChange={v => set('varv', v)} />
            </div>

            {/* Print ID */}
            <div>
              <label className="label text-slate-400">Print ID</label>
              <input type="text" value={form.print_id} onChange={e => set('print_id', e.target.value)}
                placeholder="SprintRay töö nr…"
                className="input bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent font-mono"
              />
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

            {/* Price */}
            <div>
              <label className="label text-slate-400 flex items-center gap-1"><Euro size={10} /> Hind (€)</label>
              <div className="relative w-36">
                <input type="number" min="0" step="0.01" value={form.price}
                  onChange={e => set('price', e.target.value)}
                  placeholder="0.00"
                  className="input pr-7 bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">€</span>
              </div>
            </div>
          </div>

          {/* ── CENTER COLUMN — work types + odontogram ── */}
          <div className="space-y-3 sticky top-0">
            {/* Work type grid */}
            <div>
              <label className="label text-slate-400">Töötüüp (vali üks või mitu)</label>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {wt.map(t => {
                  const hasItem = form.work_items.some(i => i.too === t.nimi)
                  return (
                    <button key={t.nimi} type="button"
                      onClick={() => {
                        if (hasItem) {
                          const next = form.work_items.filter(i => i.too !== t.nimi)
                          set('work_items', next)
                        } else {
                          const isBridge = /sild|bridge/i.test(t.nimi)
                          const item: WorkItem = { id: crypto.randomUUID(), too: t.nimi, hambad: '', ...(isBridge ? { bridge: true } : {}) }
                          const next = [...form.work_items, item]
                          set('work_items', next)
                          setActiveWorkItemId(item.id)
                        }
                      }}
                      className={`text-xs px-2 py-1.5 rounded-lg border-2 font-medium transition-all ${
                        hasItem ? 'border-accent bg-accent/10 text-accent' : 'border-slate-600 text-slate-400 hover:border-slate-400'
                      }`}
                    >
                      {t.nimi}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Chips */}
            {form.work_items.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {form.work_items.map(item => {
                  const hex = colorMap[item.too] ?? '#94A3B8'
                  const isActive = item.id === activeWorkItemId
                  const teethCount = item.hambad.split(',').filter(t => t.trim()).length
                  return (
                    <button key={item.id} type="button"
                      onClick={() => setActiveWorkItemId(isActive ? null : item.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border-2 transition-all ${
                        isActive ? 'border-accent bg-accent/10' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: isActive ? undefined : `${hex}20` }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: hex }} />
                      <span style={{ color: isActive ? '#0AB6C4' : hex }}>{item.too}</span>
                      {teethCount > 0 && <span className="text-[10px] text-slate-500">{teethCount}</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Odontogram */}
            <div className="bg-slate-800/60 rounded-xl p-4">
              {form.work_items.length > 0 ? (
                <MultiOdontogramPicker
                  items={form.work_items}
                  activeItemId={activeWorkItemId}
                  colorMap={colorMap}
                  onToggleTooth={tooth => {
                    if (!activeWorkItemId) return
                    const s = String(tooth)
                    const otherOwner = form.work_items.find(i => i.id !== activeWorkItemId && i.hambad.split(',').map(t => t.trim()).includes(s))
                    if (otherOwner) return
                    setForm(f => ({
                      ...f,
                      work_items: f.work_items.map(item => {
                        if (item.id !== activeWorkItemId) return item
                        const teeth = new Set(item.hambad.split(',').map(t => t.trim()).filter(Boolean))
                        teeth.has(s) ? teeth.delete(s) : teeth.add(s)
                        return { ...item, hambad: [...teeth].join(',') }
                      })
                    }))
                  }}
                />
              ) : (
                <OdontogramPicker
                  value={form.hambad}
                  onChange={v => set('hambad', v)}
                />
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN — empty for now, can add extras later ── */}
          <div />
        </div>
      </form>
    </div>
  )
}
