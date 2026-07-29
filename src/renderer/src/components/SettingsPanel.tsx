import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Cpu, Pencil, Layers, ChevronUp, ChevronDown, Trash2, RotateCcw, Plus } from 'lucide-react'
import { MATERIAL_OPTIONS, MACHINE_OPTIONS } from '../types/job'
import { useSettings } from '../stores/useSettings'
import { usePipeline } from '../context/PipelineContext'
import type { PipelineStage } from '../config/pipeline'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

function PriceInput({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="relative w-24">
      <input
        type="number"
        min="0"
        step="0.5"
        value={value || ''}
        placeholder="15"
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="input py-1.5 pr-7 text-right text-sm w-full"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">€</span>
    </div>
  )
}

// ─── Pipeline stage row ───────────────────────────────────────────────────────
function StageRow({
  stage, isFirst, isLast, canRemove,
  onRename, onRemove, onMove,
}: {
  stage: PipelineStage
  isFirst: boolean
  isLast: boolean
  canRemove: boolean
  onRename: (key: string, label: string) => void
  onRemove: (key: string) => void
  onMove: (key: string, dir: 'up' | 'down') => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stage.label)

  const commit = () => {
    if (draft.trim() && draft.trim() !== stage.label) onRename(stage.key, draft.trim())
    else setDraft(stage.label)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-sidebar group">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.hex }} />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(stage.label); setEditing(false) }
          }}
          className="flex-1 text-sm text-ink bg-transparent border-b border-accent outline-none py-0.5"
        />
      ) : (
        <span className="flex-1 text-sm text-ink">{stage.label}</span>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => { setDraft(stage.label); setEditing(true) }}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors"
          title="Nimeta ümber"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove(stage.key, 'up')}
          disabled={isFirst}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove(stage.key, 'down')}
          disabled={isLast}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronDown size={11} />
        </button>
        <button
          type="button"
          onClick={() => (!isLast && canRemove) && onRemove(stage.key)}
          disabled={isLast || !canRemove}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={isLast ? 'Viimast etappi ei saa kustutada' : undefined}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function AddStageRow({ onAdd }: { onAdd: (label: string) => void }) {
  const [label, setLabel] = useState('')
  const submit = () => {
    if (label.trim()) { onAdd(label.trim()); setLabel('') }
  }
  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder="Uus etapp…"
        className="input flex-1 text-sm py-1.5"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!label.trim()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        <Plus size={13} /> Lisa
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { settings, setMaterialPrice, setDesignFee, setDefaultMachine } = useSettings()
  const { stages, addStage, removeStage, renameStage, moveStage, resetToDefaults } = usePipeline()

  return (
    <AnimatePresence>
      {open && (
        <>
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
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-[480px] bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-ink-faint/20 flex-shrink-0">
              <h2 className="text-base font-semibold text-ink">Seaded</h2>
              <button type="button" onClick={onClose} className="btn-ghost p-2">
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

              {/* Machine default */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Cpu size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">Vaikimisi masin</h3>
                </div>
                <div className="flex gap-2 items-center">
                  {MACHINE_OPTIONS.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDefaultMachine(settings.defaultMachine === m ? '' : m)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all duration-100 ${
                        settings.defaultMachine === m
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                  {settings.defaultMachine && (
                    <button
                      type="button"
                      onClick={() => setDefaultMachine('')}
                      className="text-xs text-ink-faint hover:text-red-500 transition-colors px-2"
                    >
                      Tühjenda
                    </button>
                  )}
                </div>
              </section>

              {/* Design fee */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Pencil size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">Disaini hind (€/töö)</h3>
                </div>
                <div className="flex items-center gap-3">
                  <PriceInput
                    value={settings.designFee}
                    onChange={setDesignFee}
                  />
                  <p className="text-xs text-ink-faint leading-relaxed">
                    Lisa tööle, kui disain on tehtud kolmanda osapoole poolt või ise lisatav kulu.
                  </p>
                </div>
              </section>

              {/* Pipeline stages */}
              <section>
                <div className="flex items-center gap-2 mb-1">
                  <Layers size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">Töövoog</h3>
                </div>
                <p className="text-xs text-ink-faint mb-3">
                  Lisa, eemalda või nimeta ümber pipeline etappe. Viimane etapp on alati "valmis"-etapp ja seda ei saa kustutada.
                </p>

                <div className="space-y-0.5">
                  {stages.map((stage, idx) => (
                    <StageRow
                      key={stage.key}
                      stage={stage}
                      isFirst={idx === 0}
                      isLast={idx === stages.length - 1}
                      canRemove={stages.length > 2}
                      onRename={renameStage}
                      onRemove={removeStage}
                      onMove={moveStage}
                    />
                  ))}
                </div>

                <AddStageRow onAdd={addStage} />

                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
                >
                  <RotateCcw size={11} /> Lähtesta vaikimisi
                </button>
              </section>

              {/* Per-material pricing table */}
              <section>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-ink">Hind materjali järgi</h3>
                </div>
                <p className="text-xs text-ink-faint mb-4">
                  Väike hammas = positsioon 1–5 (lõikehambad, ümarik, väike purihambad).<br />
                  Suur hammas = positsioon 6–8 (suured purihambad).
                </p>

                {/* Table header */}
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 mb-2 px-1">
                  <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Materjal</span>
                  <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide w-24 text-center">Väike H</span>
                  <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide w-24 text-center">Suur H</span>
                </div>

                <div className="space-y-1.5">
                  {MATERIAL_OPTIONS.map(material => {
                    const p = settings.materialPrices[material] ?? { small: 0, large: 0 }
                    return (
                      <div
                        key={material}
                        className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center px-1 py-0.5"
                      >
                        <span className="text-sm text-ink truncate">{material}</span>
                        <PriceInput
                          value={p.small}
                          onChange={v => setMaterialPrice(material, 'small', v)}
                        />
                        <PriceInput
                          value={p.large}
                          onChange={v => setMaterialPrice(material, 'large', v)}
                        />
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Example */}
              <div className="p-3 bg-bg-sidebar rounded-xl text-xs text-ink-muted leading-relaxed">
                <span className="font-semibold text-ink block mb-1">Näide autoarvutusest:</span>
                OnX Tough 2 (väike 45€, suur 60€) + 3 väikest + 1 suur hammas + disain 20€<br />
                = 3×45 + 1×60 + 20 = <span className="font-semibold text-ink">215.00 €</span>
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-ink-faint/20 flex-shrink-0 bg-bg-card">
              <button type="button" onClick={onClose} className="btn-primary w-full">
                Valmis
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
