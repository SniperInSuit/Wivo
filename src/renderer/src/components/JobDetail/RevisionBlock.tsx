import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, Euro, Zap, Pencil, X as XIcon, Package, CalendarClock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { Revision, StageKey, WorkItem } from '../../types/job'
import {
  MATERIAL_SHADES, REVISION_REASONS, revisionReasons, revisionReasonLabel
} from '../../types/job'
import { OdontogramPicker } from './OdontogramPicker'
import { MultiOdontogramPicker } from './MultiOdontogramPicker'
import { RevisionEditFullscreen } from './RevisionEditFullscreen'
import { debugLog } from '../Workers/DebugConsole'
import { ShadePicker } from './ShadePicker'
import { usePipeline } from '../../context/PipelineContext'
import { useSettings } from '../../stores/useSettings'
import { stageChipStyle } from '../../config/pipeline'

interface RevisionBlockProps {
  value: Revision[]
  onChange: (revisions: Revision[]) => void
  disabled?: boolean
  autoExpandId?: string   // expand + scroll to this revision on mount
  autoEditId?: string | null  // auto-open this revision in edit mode
  onAutoEditDone?: () => void
}

const EMPTY_DRAFT = {
  note: '',
  reasons: [] as string[],
  hambad: '',
  work_items: [] as WorkItem[],
  varv: '' as string | null,
  materjal: '' as string,
  deadline: '',
  price: '' as string,
  kiirtoo: false,
  print_id: '',
  status: 'disain' as StageKey,
}

type Draft = typeof EMPTY_DRAFT

export function RevisionBlock({ value, onChange, disabled, autoExpandId, autoEditId, onAutoEditDone }: RevisionBlockProps) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const targetRef = useRef<HTMLDivElement | null>(null)

  // Auto-edit a specific revision (triggered from "Muuda muudatust" button)
  useEffect(() => {
    if (!autoEditId) return
    const rev = value.find(r => r.id === autoEditId)
    if (rev) startEdit(rev)
    onAutoEditDone?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditId])

  // Auto-expand and scroll to a specific revision (e.g. opened from calendar)
  useEffect(() => {
    if (!autoExpandId) return
    setExpandedIds(prev => new Set([...prev, autoExpandId]))
    const t = setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => clearTimeout(t)
  }, [autoExpandId])

  function addRevision() {
    if (!draft.note.trim()) return
    const rev: Revision = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      note: draft.note.trim(),
      reasons: draft.reasons.length > 0 ? draft.reasons : undefined,
      work_items: draft.work_items.length > 0 ? draft.work_items : undefined,
      hambad: draft.work_items.length > 0
        ? [...new Set(draft.work_items.flatMap(i => i.hambad.split(',').filter(t => t.trim())))].join(',') || undefined
        : (draft.hambad || undefined),
      varv: draft.varv || undefined,
      materjal: draft.materjal || undefined,
      deadline: draft.deadline ? new Date(draft.deadline).toISOString() : undefined,
      price: draft.price !== '' ? parseFloat(draft.price) * (draft.kiirtoo ? 2 : 1) : undefined,
      kiirtoo: draft.kiirtoo || undefined,
      print_id: draft.print_id || undefined,
      status: draft.status || 'disain',
    }
    onChange([...value, rev])
    setDraft(EMPTY_DRAFT)
    setAdding(false)
  }

  function startEdit(rev: Revision) {
    setEditingId(rev.id)
    setEditDraft({
      note: rev.note,
      reasons: revisionReasons(rev),
      work_items: Array.isArray(rev.work_items) ? rev.work_items.map(i => ({ ...i })) : [],
      hambad: rev.hambad ? rev.hambad.split(',').map(t => t.trim()).filter(Boolean).join(',') : '',
      varv: rev.varv ?? null,
      materjal: rev.materjal ?? '',
      deadline: rev.deadline ? rev.deadline.replace('Z', '').slice(0, 16) : '',
      price: rev.price != null ? String(rev.price) : '',
      kiirtoo: rev.kiirtoo ?? false,
      print_id: rev.print_id ?? '',
      status: rev.status ?? 'disain',
    })
    // Make sure it's expanded
    setExpandedIds(prev => new Set([...prev, rev.id]))
  }

  function saveEdit(revId: string) {
    const d = editDraft
    onChange(value.map(r => r.id !== revId ? r : {
      ...r,
      note: d.note.trim() || r.note,
      reasons: d.reasons.length > 0 ? d.reasons : undefined,
      work_items: d.work_items.length > 0 ? d.work_items : undefined,
      hambad: d.work_items.length > 0
        ? [...new Set(d.work_items.flatMap(i => i.hambad.split(',').filter(t => t.trim())))].join(',') || undefined
        : (d.hambad || undefined),
      varv: d.varv || undefined,
      materjal: d.materjal || undefined,
      deadline: d.deadline ? new Date(d.deadline).toISOString() : undefined,
      price: d.price !== '' ? parseFloat(d.price) : undefined,
      kiirtoo: d.kiirtoo || undefined,
      print_id: d.print_id || undefined,
      status: d.status || r.status || 'disain',
    }))
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  function deleteRevision(id: string) {
    onChange(value.filter(r => r.id !== id))
  }

  function toggleExpand(id: string) {
    // Don't collapse while editing
    if (editingId === id) return
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Show newest first
  const sorted = [...value].sort((a, b) => b.ts.localeCompare(a.ts))

  return (
    <div className="rounded-xl overflow-hidden border border-slate-700/40">
      {/* ── Dark header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800">
        <span className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          Muudatused
          {value.length > 0 && (
            <span className="bg-slate-600 text-slate-200 rounded-full px-2 py-0.5 text-xs font-bold">
              {value.length}
            </span>
          )}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => { setAdding(a => !a); setDraft(EMPTY_DRAFT) }}
            className="flex items-center gap-1 text-xs text-slate-300 hover:text-white font-semibold transition-colors"
          >
            <Plus size={13} />
            Lisa muudatus
          </button>
        )}
      </div>

      {/* ── Add — fullscreen dark layout ── */}
      {adding && (
        <RevisionEditFullscreen
          revision={{ id: crypto.randomUUID(), ts: new Date().toISOString(), note: '', status: 'disain' }}
          onSave={rev => {
            if (!rev.note.trim()) return
            onChange([...value, rev])
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* ── Empty state ── */}
      {value.length === 0 && !adding && (
        <div className="px-4 py-4 text-xs text-slate-500 italic bg-slate-800/40">
          Muudatusi pole lisatud
        </div>
      )}

      {/* ── Revision list ── */}
      {sorted.map((rev, idx) => {
        const expanded = expandedIds.has(rev.id)
        const isEditing = editingId === rev.id
        const toothCount = rev.hambad ? rev.hambad.split(',').filter(t => t.trim()).length : 0

        return (
          <div
            key={rev.id}
            ref={rev.id === autoExpandId ? targetRef : null}
            className={`${idx > 0 ? 'border-t border-slate-700/50' : ''}`}
          >
            {/* ── Collapsed summary row ── */}
            <div
              className="flex items-start gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-900 cursor-pointer transition-colors"
              onClick={() => toggleExpand(rev.id)}
            >
              <div className="flex-1 min-w-0">
                {/* Top: timestamp + badges */}
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[10px] text-slate-300 font-mono tabular-nums">
                    #{sorted.length - idx} · {format(parseISO(rev.ts), 'dd.MM.yy HH:mm')}
                  </span>
                  {rev.kiirtoo && (
                    <span className="text-[10px] bg-orange-500/30 text-orange-200 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5">
                      <Zap size={8} /> 2×
                    </span>
                  )}
                  {rev.price != null && (
                    <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded font-bold">
                      {rev.price.toFixed(2)} €
                    </span>
                  )}
                  {rev.varv && (
                    <span className="text-[10px] bg-slate-500 text-white px-1.5 py-0.5 rounded font-medium">
                      {rev.varv}
                    </span>
                  )}
                  {toothCount > 0 && (
                    <span className="text-[10px] bg-slate-500 text-white px-1.5 py-0.5 rounded font-medium">
                      {toothCount}
                    </span>
                  )}
                  {rev.print_id && (
                    <span className="text-[10px] bg-slate-500 text-white px-1.5 py-0.5 rounded font-mono">
                      #{rev.print_id}
                    </span>
                  )}
                  {rev.materjal && (
                    <span className="text-[10px] bg-slate-500 text-white px-1.5 py-0.5 rounded font-medium">
                      {rev.materjal}
                    </span>
                  )}
                  {revisionReasonLabel(rev) && (
                    <span className="text-[10px] bg-pink-500/30 text-pink-200 px-1.5 py-0.5 rounded font-medium">
                      {revisionReasonLabel(rev)}
                    </span>
                  )}
                  {rev.deadline && (
                    <span className="text-[10px] text-slate-300 font-mono">
                      → {format(parseISO(rev.deadline), 'dd.MM.yy')}
                    </span>
                  )}
                </div>
                {/* Note */}
                <p className={`text-sm text-slate-100 leading-snug ${expanded ? '' : 'line-clamp-1'}`}>
                  {rev.note}
                </p>
              </div>

              <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                {expanded
                  ? <ChevronUp size={13} className="text-slate-400" />
                  : <ChevronDown size={13} className="text-slate-400" />
                }
                {!disabled && !isEditing && (
                  <>
                    <button
                      type="button"
                      title="Muuda"
                      onClick={e => { e.stopPropagation(); startEdit(rev) }}
                      className="p-1 text-slate-600 hover:text-accent transition-colors ml-0.5"
                    >
                      <Pencil size={12} />
                    </button>
                    {deleteConfirmId === rev.id ? (
                      <div
                        className="flex items-center gap-1 ml-0.5"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="text-[10px] text-red-400 font-medium whitespace-nowrap">Kustuta?</span>
                        <button
                          type="button"
                          onClick={() => { deleteRevision(rev.id); setDeleteConfirmId(null) }}
                          className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-semibold hover:bg-red-600 transition-colors"
                        >
                          Jah
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded transition-colors"
                        >
                          Ei
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setDeleteConfirmId(rev.id) }}
                        className="p-1 text-slate-600 hover:text-red-400 transition-colors ml-0.5"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </>
                )}
                {isEditing && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); cancelEdit() }}
                    className="p-1 text-slate-400 hover:text-white transition-colors ml-0.5"
                    title="Tühista muutmine"
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* ── Edit — fullscreen dark layout ── */}
            {isEditing && (
              <RevisionEditFullscreen
                revision={rev}
                onSave={updated => {
                  try {
                    debugLog('info', 'Revision save', { id: rev.id, mudel: updated.mudel, keys: Object.keys(updated) })
                    onChange(value.map(r => r.id === rev.id ? updated : r))
                    setEditingId(null)
                  } catch (err) {
                    debugLog('error', 'Revision save CRASHED', (err as Error)?.message ?? err)
                  }
                }}
                onCancel={cancelEdit}
              />
            )}

            {/* ── Expanded: read-only view ── */}
            {expanded && !isEditing && (
                <div className="px-4 pb-4 pt-3 space-y-3 bg-slate-900 border-t border-slate-700/40">
                  {rev.note.length > 60 && (
                    <p className="text-sm text-slate-200 leading-relaxed">{rev.note}</p>
                  )}
                  {rev.price != null && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Euro size={11} />
                      <span>Hind:</span>
                      <span className="font-bold text-accent">{rev.price.toFixed(2)} €</span>
                    </div>
                  )}
                  {rev.print_id && (
                    <div className="text-xs text-slate-400">
                      Print ID: <span className="font-mono font-semibold text-slate-200">{rev.print_id}</span>
                    </div>
                  )}
                  {rev.varv && (
                    <div className="text-xs text-slate-400">
                      Uus värv: <span className="font-semibold text-slate-200">{rev.varv}</span>
                    </div>
                  )}
                  {rev.deadline && (
                    <div className="text-xs text-slate-400">
                      Uus tähtaeg:{' '}
                      <span className="font-semibold text-slate-200">
                        {format(parseISO(rev.deadline), 'dd.MM.yy HH:mm')}
                      </span>
                    </div>
                  )}
                  {rev.hambad && (
                    <div className="rounded-xl p-2 bg-slate-800/60 mt-1">
                      <OdontogramPicker value={rev.hambad} onChange={() => {}} disabled />
                    </div>
                  )}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => startEdit(rev)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent transition-colors mt-1"
                    >
                      <Pencil size={11} /> Muuda
                    </button>
                  )}
                </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared form (used for both add and edit) ─────────────────────────────────
function RevisionForm({
  draft, setDraft, onSubmit, onCancel, submitLabel, isEdit = false,
}: {
  draft: { note: string; reasons: string[]; work_items: WorkItem[]; hambad: string; varv: string | null; materjal: string; deadline: string; price: string; kiirtoo: boolean; print_id: string; status: StageKey }
  setDraft: React.Dispatch<React.SetStateAction<typeof draft>>
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  isEdit?: boolean
}) {
  const { stages } = usePipeline()
  const { settings } = useSettings()
  const wt = settings.tooTuubid
  const [activeWorkItemId, setActiveWorkItemId] = useState<string | null>(null)
  // Auto-price: on for new revisions, or when editing a revision that has no price yet
  const [priceIsAuto, setPriceIsAuto] = useState(!isEdit || draft.price === '')

  useEffect(() => {
    if (!priceIsAuto) return
    const toothCount = (draft.hambad ?? '').split(',').filter(t => t.trim()).length
    if (toothCount === 0) return
    // €/tooth for a revision — Seaded → Hinnad
    setDraft(d => ({ ...d, price: (toothCount * settings.muudatusHambaHind).toFixed(2) }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.hambad, priceIsAuto, settings.muudatusHambaHind])

  return (
    <div className="px-6 py-5 space-y-3 bg-slate-900/80 border-b border-slate-700/50 max-w-3xl mx-auto">
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Kirjeldus *</label>
        <textarea
          value={draft.note}
          onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
          placeholder="Kirjelda vajalikud muudatused…"
          rows={2}
          autoFocus
          className="input resize-none bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent"
        />
      </div>

      {/* Reason */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Põhjus</label>
        <div className="flex flex-wrap gap-1.5">
          {REVISION_REASONS.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setDraft(d => ({
                ...d,
                // Multi-select: a remake often has more than one cause, and
                // making them exclusive threw away half the reason data.
                reasons: d.reasons.includes(r)
                  ? d.reasons.filter(x => x !== r)
                  : [...d.reasons, r],
              }))}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all duration-100 font-medium ${
                draft.reasons.includes(r)
                  ? 'bg-pink-500 text-white border-pink-500'
                  : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Staatus</label>
        <div className="flex flex-wrap gap-1.5">
          {stages.map(s => (
            <button
              key={s.key}
              type="button"
              onClick={() => setDraft(d => ({ ...d, status: s.key }))}
              // Selected pill coloured from stage.hex so a recoloured stage shows
              // its own colour here too
              style={draft.status === s.key ? stageChipStyle(s.hex) : undefined}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all duration-100 font-medium ${
                draft.status === s.key
                  ? 'border-current'
                  : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Price */}
      {/* Deadline sits high in the form on purpose: it used to be the last
          field, below the shade grid and the tooth picker, so people scrolled
          past it and reported that revisions had no deadline at all. */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
          <CalendarClock size={11} /> Uus tähtaeg
        </label>
        <div className="flex gap-2">
          <input
            type="date"
            value={(draft.deadline ?? '').split('T')[0] || ''}
            onChange={e => {
              const time = (draft.deadline ?? '').split('T')[1] || '12:00'
              setDraft(d => ({ ...d, deadline: e.target.value ? `${e.target.value}T${time}` : '' }))
            }}
            className="input flex-1 bg-slate-800 border-slate-600 text-slate-100 focus:border-accent"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM"
            maxLength={5}
            value={(draft.deadline ?? '').split('T')[1]?.slice(0, 5) || ''}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9:]/g, '')
              const date = (draft.deadline ?? '').split('T')[0]
              if (date) setDraft(d => ({ ...d, deadline: `${date}T${raw}` }))
            }}
            className="input w-24 bg-slate-800 border-slate-600 text-slate-100 focus:border-accent"
          />
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          Muudatusel on oma tähtaeg — kalendris on ta selle päeva peal, mitte
          originaaltöö oma peal.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
          <Euro size={10} /> Hind (€)
        </label>
        <div className="relative w-36">
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.price}
            onChange={e => { setPriceIsAuto(false); setDraft(d => ({ ...d, price: e.target.value })) }}
            placeholder="0.00"
            className="input pr-7 bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">€</span>
        </div>
      </div>

      {/* Kiirtöö toggle */}
      <button
        type="button"
        onClick={() => setDraft(d => ({ ...d, kiirtoo: !d.kiirtoo }))}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all ${
          draft.kiirtoo
            ? 'bg-orange-900/30 border-orange-500 text-orange-300'
            : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
        }`}
      >
        <Zap size={12} className={draft.kiirtoo ? 'text-orange-400 fill-orange-300' : ''} />
        {draft.kiirtoo ? 'Kiirtöö — hind 2×' : 'Kiirtöö'}
      </button>

      {/* Print ID */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Print ID</label>
        <input
          type="text"
          value={draft.print_id}
          onChange={e => setDraft(d => ({ ...d, print_id: e.target.value }))}
          placeholder="SprintRay töö number…"
          className="input bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-accent font-mono"
        />
      </div>

      {/* Material */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1">
          <Package size={10} /> Uus materjal
        </label>
        {(() => {
          const baseMat = [...settings.materjalid]
            .sort((a, b) => b.length - a.length)
            .find(m => draft.materjal === m || draft.materjal.startsWith(m + ' ')) ?? null
          const shades = baseMat ? MATERIAL_SHADES[baseMat] : undefined
          const currentShade = baseMat && draft.materjal !== baseMat
            ? draft.materjal.slice(baseMat.length + 1)
            : null
          return (
            <>
              <div className="flex gap-1.5 flex-wrap mb-1.5">
                {settings.materjalid.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraft(d => ({ ...d, materjal: d.materjal === m ? '' : m }))}
                    className={`text-xs px-2 py-1 rounded-lg border transition-all duration-100 font-medium ${
                      baseMat === m
                        ? 'bg-accent text-white border-accent'
                        : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {shades && (
                <div className="flex items-center gap-1 flex-wrap mb-1.5 pl-1">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Toon:</span>
                  {shades.map(shade => (
                    <button
                      key={shade}
                      type="button"
                      onClick={() => setDraft(d => ({ ...d, materjal: currentShade === shade ? baseMat! : `${baseMat} ${shade}` }))}
                      className={`text-xs px-2 py-0.5 rounded border transition-all duration-100 font-medium ${
                        currentShade === shade
                          ? 'bg-accent text-white border-accent'
                          : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
                      }`}
                    >
                      {shade}
                    </button>
                  ))}
                </div>
              )}
              {draft.materjal && (
                <button
                  type="button"
                  onClick={() => setDraft(d => ({ ...d, materjal: '' }))}
                  className="text-[10px] text-slate-500 hover:text-red-400 transition-colors"
                >
                  Tühjenda
                </button>
              )}
            </>
          )
        })()}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Uus värv</label>
        <ShadePicker value={draft.varv} onChange={v => setDraft(d => ({ ...d, varv: v }))} />
      </div>

      {/* Work type multi-select for revision */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1">Töötüüp ja hambad</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {wt.map(t => {
            const hasItem = draft.work_items.some(i => i.too === t.nimi)
            return (
              <button
                key={t.nimi}
                type="button"
                onClick={() => {
                  if (hasItem) {
                    const next = draft.work_items.filter(i => i.too !== t.nimi)
                    setDraft(d => ({ ...d, work_items: next }))
                  } else {
                    const isBridge = /sild|bridge/i.test(t.nimi)
                    const item = { id: crypto.randomUUID(), too: t.nimi, hambad: '', ...(isBridge ? { bridge: true } : {}) }
                    setDraft(d => ({ ...d, work_items: [...d.work_items, item] }))
                    setActiveWorkItemId(item.id)
                  }
                }}
                className={`text-xs px-2 py-1 rounded-lg border transition-all font-medium ${
                  hasItem
                    ? 'bg-accent text-white border-accent'
                    : 'bg-slate-800 text-slate-400 border-slate-600 hover:border-slate-400'
                }`}
              >
                {t.nimi}
              </button>
            )
          })}
        </div>

        {/* Selected type chips */}
        {draft.work_items.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {draft.work_items.map(item => {
              const hex = wt.find(t => t.nimi === item.too)?.hex ?? '#94A3B8'
              const isActive = item.id === activeWorkItemId
              const teethCount = item.hambad.split(',').filter(t => t.trim()).length
              return (
                <button key={item.id} type="button"
                  onClick={() => setActiveWorkItemId(isActive ? null : item.id)}
                  className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-all ${
                    isActive ? 'bg-accent/20 text-accent' : 'text-slate-400'
                  }`}
                  style={{ backgroundColor: isActive ? undefined : `${hex}20` }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
                  {item.too} {teethCount > 0 && `(${teethCount})`}
                </button>
              )
            })}
          </div>
        )}

        {/* Odontogram */}
        <div className="rounded-xl p-3 bg-slate-800/60">
          {draft.work_items.length > 0 ? (
            <MultiOdontogramPicker
              items={draft.work_items}
              activeItemId={activeWorkItemId}
              colorMap={Object.fromEntries(wt.map(t => [t.nimi, t.hex]))}
              onToggleTooth={tooth => {
                if (!activeWorkItemId) return
                const s = String(tooth)
                const otherOwner = draft.work_items.find(i => i.id !== activeWorkItemId && i.hambad.split(',').map(t => t.trim()).includes(s))
                if (otherOwner) return
                setDraft(d => ({
                  ...d,
                  work_items: d.work_items.map(item => {
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
              value={draft.hambad}
              onChange={v => setDraft(d => ({ ...d, hambad: v }))}
            />
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!draft.note.trim()}
          className="btn-primary text-xs py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          Tühista
        </button>
      </div>
    </div>
  )
}
