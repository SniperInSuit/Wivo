import { useState } from 'react'
import { Cpu, Pencil, Layers, ChevronUp, ChevronDown, Trash2, RotateCcw, Plus, User, Palette, CalendarClock, Euro } from 'lucide-react'
import { MATERIAL_OPTIONS, MACHINE_OPTIONS } from '../types/job'
import { useSettings, THEMES } from '../stores/useSettings'
import type { ThemeKey } from '../stores/useSettings'
import { usePipeline } from '../context/PipelineContext'
import type { PipelineStage } from '../config/pipeline'

// Stage colour choices. Mid-tone on purpose: the pill tints the background to
// ~12% and uses the same hex for text, so very pale colours would be unreadable.
const STAGE_PALETTE = [
  '#6366F1', '#8B5CF6', '#A855F7', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#64748B', '#0E1116'
]

type GroupKey = 'profiil' | 'kasutajaliides' | 'etapid' | 'masinad' | 'hinnad' | 'kalender'

// Only real, working groups are listed. The rest of a typical settings sidebar
// (team, notifications, templates, integrations) has nothing behind it yet.
const NAV_GROUPS: { title: string; items: { key: GroupKey; label: string; icon: typeof User }[] }[] = [
  {
    title: 'Üldine',
    items: [
      { key: 'profiil', label: 'Profiil', icon: User },
      { key: 'kasutajaliides', label: 'Kasutajaliides', icon: Palette },
    ]
  },
  {
    title: 'Töö ja tootmine',
    items: [
      { key: 'etapid', label: 'Töö etapid', icon: Layers },
      { key: 'masinad', label: 'Masinad', icon: Cpu },
      { key: 'hinnad', label: 'Hinnad', icon: Pencil },
      { key: 'kalender', label: 'Kalender', icon: CalendarClock },
    ]
  }
]

// Small numeric field used by the calendar + pricing sections
function NumField({ label, hint, value, onChange, min, max, step = 1, suffix }: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative w-28">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => {
            const n = parseFloat(e.target.value)
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
          }}
          className="input py-1.5 pr-10 text-right text-sm"
        />
        {suffix && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-ink-faint mt-1 max-w-[280px] leading-relaxed">{hint}</p>}
    </div>
  )
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
  onRename, onRecolor, onRemove, onMove,
}: {
  stage: PipelineStage
  isFirst: boolean
  isLast: boolean
  canRemove: boolean
  onRename: (key: string, label: string) => void
  onRecolor: (key: string, hex: string) => void
  onRemove: (key: string) => void
  onMove: (key: string, dir: 'up' | 'down') => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stage.label)
  const [picking, setPicking] = useState(false)

  const commit = () => {
    if (draft.trim() && draft.trim() !== stage.label) onRename(stage.key, draft.trim())
    else setDraft(stage.label)
    setEditing(false)
  }

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-sidebar group">
      {/* Colour swatch doubles as the picker trigger */}
      <button
        type="button"
        onClick={() => setPicking(v => !v)}
        title="Muuda värvi"
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10 hover:scale-110 transition-transform"
        style={{ backgroundColor: stage.hex }}
      />

      {picking && (
        <>
          {/* Click-away layer — cheaper than a document listener for a popover
              that only exists while open */}
          <span className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
          <div className="absolute left-0 top-7 z-20 card p-2 w-[188px] space-y-2">
            <div className="grid grid-cols-6 gap-1.5">
              {STAGE_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => { onRecolor(stage.key, hex); setPicking(false) }}
                  className={`w-6 h-6 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
                    hex.toLowerCase() === stage.hex.toLowerCase() ? 'ring-2 ring-accent' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <input
                type="color"
                value={stage.hex}
                onChange={e => onRecolor(stage.key, e.target.value)}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              Oma värv
            </label>
          </div>
        </>
      )}

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

export function SettingsPage() {
  const { settings, setMaterialPrice, setDesignFee, setDefaultMachine, setKasutajaNimi, setTeema, setNumber } = useSettings()
  const { stages, addStage, removeStage, renameStage, recolorStage, moveStage, resetToDefaults } = usePipeline()

  const [group, setGroup] = useState<GroupKey>('profiil')

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink">Seaded</h1>
          <p className="text-sm text-ink-muted">
            Halda oma töökoja andmeid, eelistusi ja süsteemi seadeid.
          </p>
        </div>

        <div className="flex items-start gap-5">
          {/* Section nav — only groups that actually exist; a nav item that led
              nowhere would be the same dead-UI problem as an empty panel. */}
          <nav className="w-[210px] flex-shrink-0 card p-2 space-y-3">
            {NAV_GROUPS.map(section => (
              <div key={section.title}>
                <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider px-2 pt-1 pb-1.5">
                  {section.title}
                </p>
                {section.items.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setGroup(key)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      group === key
                        ? 'bg-accent/10 text-accent'
                        : 'text-ink-muted hover:text-ink hover:bg-bg-sidebar'
                    }`}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Cards for the active group. Two columns where there is room —
              the settings body is short items, not long forms. */}
          <div className="flex-1 min-w-0 grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start [&>section]:card [&>section]:p-4">

        {/* Kalender */}
        {group === 'kalender' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">Tööpäev ja ajajooned</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label="Nädalavaate algus" suffix="h" min={0} max={23}
                value={settings.nadalAlgus}
                onChange={v => setNumber('nadalAlgus', v)}
                hint="Vertikaalse nädalaruudustiku esimene tund."
              />
              <NumField
                label="Nädalavaate lõpp" suffix="h" min={1} max={24}
                value={settings.nadalLopp}
                onChange={v => setNumber('nadalLopp', v)}
                hint="Väljaspool vahemikku olevad visiidid surutakse serva, mitte ei kao ära."
              />
              <NumField
                label="Ajajoone algus" suffix="h" min={0} max={23}
                value={settings.ajajoonAlgus}
                onChange={v => setNumber('ajajoonAlgus', v)}
                hint="Horisontaalne rööbas Ülevaates ja Kombineeritud vaates."
              />
              <NumField
                label="Ajajoone lõpp" suffix="h" min={1} max={24}
                value={settings.ajajoonLopp}
                onChange={v => setNumber('ajajoonLopp', v)}
              />
              <NumField
                label="Lohistamise samm" suffix="min" min={5} max={60} step={5}
                value={settings.ajaSamm}
                onChange={v => setNumber('ajaSamm', v)}
                hint="Nädalavaates visiiti lohistades klapsub algusaeg selle sammu peale."
              />
              <NumField
                label="Visiidi vaikimisi kestus" suffix="min" min={5} max={600} step={5}
                value={settings.visiidiKestus}
                onChange={v => setNumber('visiidiKestus', v)}
              />
            </div>
          </section>
        )}

        {/* Teema */}
        {group === 'kasutajaliides' && (
          <section>
          <div className="flex items-center gap-2 mb-3">
            <Palette size={14} className="text-accent" />
            <h3 className="text-sm font-semibold text-ink">Teema</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTeema(t.key)}
                className={`text-left rounded-xl border-2 overflow-hidden transition-all ${
                  settings.teema === t.key
                    ? 'border-accent shadow-card'
                    : 'border-ink-faint/25 hover:border-accent/40'
                }`}
              >
                {/* Live-ish preview: page background with a card floating on it */}
                <span className="block h-16 relative" style={{ background: t.preview.bg }}>
                  <span
                    className="absolute left-2 top-2 right-6 bottom-5 rounded-md"
                    style={{ background: t.preview.card, boxShadow: '0 1px 4px rgba(0,0,0,.18)' }}
                  />
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block text-xs font-semibold text-ink">{t.label}</span>
                  <span className="block text-[10px] text-ink-muted leading-tight">{t.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
          )}


          {/* Your name — stamped as the author on every patient note */}
          {group === 'profiil' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <User size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">Sinu nimi</h3>
            </div>
            <label className="label" htmlFor="kasutaja-nimi">Nimi märkuste autorina</label>
            <input
              id="kasutaja-nimi"
              value={settings.kasutajaNimi}
              onChange={e => setKasutajaNimi(e.target.value)}
              placeholder="nt Kevin Treial"
              className="input py-1.5 text-sm max-w-xs"
            />
            <p className="text-xs text-ink-faint mt-2 leading-relaxed">
              Lisatakse autorina iga patsiendi märkuse juurde. Kui väli on tühi, kuvatakse "Tundmatu".
            </p>
          </section>
          )}

          {/* Machine default */}
          {group === 'masinad' && (
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
          )}

          {/* Design fee */}
          {group === 'hinnad' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">Automaatarvutus</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label="Vaikimisi hind hamba kohta" suffix="€" min={0} max={500} step={0.5}
                value={settings.hambaHind}
                onChange={v => setNumber('hambaHind', v)}
                hint="Kasutatakse siis, kui materjalil ei ole hinda määratud."
              />
              <NumField
                label="Muudatuse hind hamba kohta" suffix="€" min={0} max={500} step={0.5}
                value={settings.muudatusHambaHind}
                onChange={v => setNumber('muudatusHambaHind', v)}
                hint="Uue muudatuse hind arvutatakse selle järgi."
              />
              <NumField
                label="Kiirtöö kordaja" suffix="×" min={1} max={5} step={0.1}
                value={settings.kiirtooKordaja}
                onChange={v => setNumber('kiirtooKordaja', v)}
                hint="Kiirtöö puhul korrutatakse arvutatud hind selle arvuga."
              />
            </div>
          </section>
        )}

        {group === 'hinnad' && (
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
          )}

          {/* Pipeline stages */}
          {group === 'etapid' && (
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
                  onRecolor={recolorStage}
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
          )}

          {/* Per-material pricing table */}
          {group === 'hinnad' && (
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
          

          {/* Example */}
          <div className="p-3 bg-bg-sidebar rounded-xl text-xs text-ink-muted leading-relaxed">
            <span className="font-semibold text-ink block mb-1">Näide autoarvutusest:</span>
            OnX Tough 2 (väike 45€, suur 60€) + 3 väikest + 1 suur hammas + disain 20€<br />
            = 3×45 + 1×60 + 20 = <span className="font-semibold text-ink">215.00 €</span>
          </div>
          </section>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
