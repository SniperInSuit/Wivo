import { useState } from 'react'
import { CalendarDays, Globe, Cpu, Pencil, Layers, ChevronUp, ChevronDown, Trash2, RotateCcw, Plus, User, Palette, CalendarClock, Euro, Building2, Type, ListChecks, Image as ImageIcon , KeyRound, Mail, ShieldCheck, AlertTriangle, Database, Languages, Handshake, ScrollText, Bell
} from 'lucide-react'
import { useSettings, THEMES, TEXT_SIZES } from '../stores/useSettings'
import { ThemeEditor } from './Settings/ThemeEditor'
import { overheadsMonthly } from '@shared/pricing/priceBook'
import type { OverheadPeriood } from '@shared/pricing/priceBook'
import type { ThemeKey } from '../stores/useSettings'
import { usePipeline } from '../context/PipelineContext'
import { useAuth, type Clinic } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useClinicSyncState } from './ClinicSettingsSync'
import { WORK_TYPE_PALETTE, sortedTiers, type WorkType, type PriceMode, type WorkTypeCost } from '../config/workTypes'
import { workTypeImage, slugifyWorkType } from '../lib/workTypeImages'
import { RepriceJobsSection } from './Settings/RepriceJobsSection'
import { supabase, updateProfile, displayIdentity } from '../lib/supabase'
import type { PipelineStage } from '../config/pipeline'
import { LicenseSection } from './Settings/LicenseSection'
import { UpdateSection } from './Settings/UpdateSection'
import { PublicServicesSection } from './Settings/PublicServicesSection'
import { EmailSection } from './Settings/EmailSection'
import { slugify } from '@shared/portal/publicService'
import { MigrationStatus } from './Settings/MigrationStatus'
import { PartnershipsSection } from './Settings/PartnershipsSection'
import { AuditLogSection } from './Settings/AuditLogSection'
import { StageTransitionsSection } from './Settings/StageTransitionsSection'
import { SoundSection } from './Settings/SoundSection'
import { SignOutOthersSection } from './Settings/SignOutOthersSection'
import { DeletedJobsSection } from './Settings/DeletedJobsSection'
import { t, lang, setLang, intlLocale, type Lang } from '../lib/i18n'

// Stage colour choices. Mid-tone on purpose: the pill tints the background to
// ~12% and uses the same hex for text, so very pale colours would be unreadable.
const STAGE_PALETTE = [
  '#6366F1', '#8B5CF6', '#A855F7', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#64748B', '#0E1116'
]

type GroupKey = 'profiil' | 'kliinik' | 'kasutajaliides' | 'etapid' | 'masinad' | 'hinnad' | 'kalender' | 'valikud' | 'litsents' | 'avalik' | 'epost' | 'andmebaas' | 'partnerlused' | 'auditilogi'

// Personal preferences vs clinic configuration.
//
// Profiil and Kasutajaliides are per-user, live in localStorage, and change
// nothing anyone else sees — so they must stay reachable by every worker.
// Text size in particular: it exists because the default is too small for some
// people, and gating it behind a clinic-settings permission would mean a worker
// who cannot read the price list also cannot make the app legible.
//
// Everything below the line is clinic configuration: shared, owner-controlled,
// and gated on settings.read (pipeline additionally on pipeline.write).
const PERSONAL_GROUPS: GroupKey[] = ['profiil', 'kasutajaliides']

// Only real, working groups are listed. The rest of a typical settings sidebar
// (team, notifications, templates, integrations) has nothing behind it yet.
const NAV_GROUPS: { title: string; items: { key: GroupKey; label: string; icon: typeof User }[] }[] = [
  {
    title: t('settingsPage.myPreferences'),
    items: [
      { key: 'profiil', label: t('settingsPage.profile'), icon: User },
      { key: 'kasutajaliides', label: t('settingsPage.interface'), icon: Palette },
    ]
  },
  {
    title: t('settingsPage.clinic'),
    items: [
      { key: 'kliinik', label: t('settingsPage.clinic'), icon: Building2 },
      // Its own tab, NOT inside Hinnad. One list is what the lab charges the
      // clinic, the other is what the patient pays — the separation is the point.
      { key: 'avalik', label: t('settingsPage.patientPriceList'), icon: Globe },
      // Its own tab because the question it answers is not "how do we look" but
      // "what is this system allowed to do with our mailbox".
      { key: 'epost', label: t('settingsPage.email'), icon: Mail },
      { key: 'partnerlused', label: t('partners.partnerships'), icon: Handshake },
      { key: 'auditilogi', label: t('audit.auditLog'), icon: ScrollText },
      { key: 'litsents', label: t('settingsPage.licence'), icon: KeyRound },
      // Migrations are run by hand, so "did I run that one" is answered by
      // memory. Memory is wrong, and the way it is wrong is a feature that
      // quietly keeps its data on one computer.
      { key: 'andmebaas', label: t('settingsPage.database'), icon: Database },
    ]
  },
  {
    title: t('settingsPage.jobsAndProduction'),
    items: [
      { key: 'etapid', label: t('settingsPage.jobStages'), icon: Layers },
      { key: 'valikud', label: t('settingsPage.options'), icon: ListChecks },
      { key: 'masinad', label: t('settingsPage.machines'), icon: Cpu },
      { key: 'hinnad', label: t('settingsPage.prices'), icon: Pencil },
      { key: 'kalender', label: t('settingsPage.calendar'), icon: CalendarClock },
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

// ─── Editable option list ─────────────────────────────────────────────────────
// One component for machines, materials and work types: the three lists differ
// only in their labels, and three near-identical editors would drift apart.
function OptionListEditor({
  items, placeholder, emptyHint, onAdd, onRemove, onRename, onReset,
}: {
  items: string[]
  placeholder: string
  emptyHint: string
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  onRename: (from: string, to: string) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const duplicate = items.some(x => x.toLowerCase() === draft.trim().toLowerCase())

  const commitAdd = () => {
    if (!draft.trim() || duplicate) return
    onAdd(draft)
    setDraft('')
  }

  const commitRename = () => {
    if (editing) onRename(editing, editDraft)
    setEditing(null)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {items.length === 0 && (
          <p className="text-xs text-ink-faint">{emptyHint}</p>
        )}
        {items.map(item =>
          editing === item ? (
            <input
              key={item}
              autoFocus
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(null)
              }}
              className="input py-1 text-sm w-40"
            />
          ) : (
            <span
              key={item}
              className="group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg
                bg-bg-sidebar border border-ink-faint/25 text-sm text-ink"
            >
              {/* Click to rename — a typo'd entry is far more common than a
                  wrong one, and delete-and-retype loses the row's position. */}
              <button
                type="button"
                onClick={() => { setEditing(item); setEditDraft(item) }}
                className="hover:text-accent transition-colors"
                title={t('settingsPage.clickToRename')}
              >
                {item}
              </button>
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="text-ink-faint hover:text-red-500 transition-colors p-0.5 rounded"
                title={t('settingsPage.remove')}
              >
                <Trash2 size={11} />
              </button>
            </span>
          )
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd() } }}
          placeholder={placeholder}
          className="input py-1.5 text-sm w-52"
        />
        <button
          type="button"
          onClick={commitAdd}
          disabled={!draft.trim() || duplicate}
          className="btn-ghost border border-ink-faint/25 disabled:opacity-40"
        >
          <Plus size={13} /> {t('settingsPage.add')}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors ml-auto"
        >
          <RotateCcw size={11} /> {t('settingsPage.reset')}
        </button>
      </div>
      {duplicate && draft.trim() && (
        <p className="text-[10px] text-orange-500 mt-1.5">{t('settingsPage.isAlreadyInTheList', { draft: draft.trim() })}</p>
      )}
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
        title={t('settingsPage.changeColour')}
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
              {t('settingsPage.customColour')}
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
          title={t('settingsPage.rename')}
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
          title={isLast ? t('settingsPage.theLastStageCanTBe') : undefined}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── Work-type row ────────────────────────────────────────────────────────────
// Same shape as StageRow on purpose: both are an ordered, recolourable list, and
// a user who has learned one should not have to learn the other. Kept separate
// rather than generalised because the two disagree on what may be deleted — a
// pipeline needs its last stage, a work-type list can legitimately be empty.
function WorkTypeRow({
  type, isFirst, isLast, onRename, onRecolor, onRemove, onMove,
}: {
  type: WorkType
  isFirst: boolean
  isLast: boolean
  onRename: (nimi: string) => void
  onRecolor: (hex: string) => void
  onRemove: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(type.nimi)
  const [picking, setPicking] = useState(false)

  const commit = () => {
    if (draft.trim() && draft.trim() !== type.nimi) onRename(draft.trim())
    else setDraft(type.nimi)
    setEditing(false)
  }

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-sidebar group">
      <button
        type="button"
        onClick={() => setPicking(v => !v)}
        title={t('settingsPage.changeColour')}
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10 hover:scale-110 transition-transform"
        style={{ backgroundColor: type.hex }}
      />

      {picking && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
          <div className="absolute left-0 top-7 z-20 card p-2 w-[188px] space-y-2">
            <div className="grid grid-cols-6 gap-1.5">
              {WORK_TYPE_PALETTE.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => { onRecolor(hex); setPicking(false) }}
                  className={`w-6 h-6 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
                    hex.toLowerCase() === type.hex.toLowerCase() ? 'ring-2 ring-accent' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <input
                type="color"
                value={type.hex}
                onChange={e => onRecolor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              {t('settingsPage.customColour')}
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
            if (e.key === 'Escape') { setDraft(type.nimi); setEditing(false) }
          }}
          className="flex-1 text-sm text-ink bg-transparent border-b border-accent outline-none py-0.5"
        />
      ) : (
        <span className="flex-1 text-sm text-ink flex items-center gap-2">
          {type.nimi}
          {/* Synonyms are what make "Abutmendile kroon" resolve to Implantkroon;
              showing them stops a renamed built-in from looking broken. */}
          {(type.match?.length ?? 0) > 0 && (
            <span className="text-[10px] text-ink-faint truncate">
              {t('settingsPage.also')} {type.match!.join(', ')}
            </span>
          )}
          {/* Read-only here: priced in Hinnad, shown here so the type list is a
              complete picture of a type rather than half of one. */}
          {type.hind != null && (
            <span className="text-[10px] font-semibold text-accent ml-auto flex-shrink-0">
              {type.hind.toFixed(2)} {t('settingsPage.job')}
            </span>
          )}
        </span>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => { setDraft(type.nimi); setEditing(true) }}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors"
          title={t('settingsPage.rename')}
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove('up')}
          disabled={isFirst}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={t('settingsPage.moveUpMatchedEarlier')}
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          onClick={() => onMove('down')}
          disabled={isLast}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={t('settingsPage.moveDown')}
        >
          <ChevronDown size={11} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded hover:bg-bg-card text-ink-faint hover:text-red-500 transition-colors"
          title={t('settingsPage.remove')}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function AddWorkTypeRow({ onAdd }: { onAdd: (nimi: string, hex: string) => void }) {
  const [nimi, setNimi] = useState('')
  const [hex, setHex] = useState(WORK_TYPE_PALETTE[0])

  const commit = () => {
    if (!nimi.trim()) return
    onAdd(nimi.trim(), hex)
    setNimi('')
    // Step through the palette so two types added in a row are not the same
    // colour — which would defeat the point of colouring them at all.
    setHex(h => WORK_TYPE_PALETTE[(WORK_TYPE_PALETTE.indexOf(h) + 1) % WORK_TYPE_PALETTE.length])
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={e => setHex(e.target.value)}
        className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 p-0 flex-shrink-0"
        title={t('settingsPage.colourForTheNewType')}
      />
      <input
        value={nimi}
        onChange={e => setNimi(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        placeholder={t('settingsPage.eGImplantBridge')}
        className="input py-1.5 text-sm w-52"
      />
      <button
        type="button"
        onClick={commit}
        disabled={!nimi.trim()}
        className="btn-ghost border border-ink-faint/25 disabled:opacity-40"
      >
        <Plus size={13} /> {t('settingsPage.add')}
      </button>
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
        placeholder={t('settingsPage.newStage')}
        className="input flex-1 text-sm py-1.5"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!label.trim()}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        <Plus size={13} /> {t('settingsPage.add')}
      </button>
    </div>
  )
}

// ─── Material cost tabs (per machine) ─────────────────────────────────────────

function MaterialCostTabs({ materjalid, masinad, materialPrices, materialCosts, setMaterialPrice, setMaterialCost }: {
  materjalid: string[]
  masinad: string[]
  materialPrices: Record<string, import('../stores/useSettings').MaterialPricing>
  materialCosts: Record<string, import('../stores/useSettings').MaterialPricing>
  setMaterialPrice: (material: string, size: 'small' | 'large', value: number) => void
  setMaterialCost: (material: string, size: 'small' | 'large', value: number) => void
}) {
  const [costTab, setCostTab] = useState<string>('base')
  const tabs = ['base', ...masinad]

  // Cost key: "material" for base, "material|machine" for machine-specific
  const costKey = (material: string) =>
    costTab === 'base' ? material : `${material}|${costTab}`

  return (
    <>
      {/* Sell price header + rows (same for all machines) */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 mb-2 px-1 min-w-[340px]">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">{t('settingsPage.material')}</span>
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide text-center">{t('settingsPage.priceSmall')}</span>
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide text-center">{t('settingsPage.priceLarge')}</span>
        </div>
        <div className="space-y-1.5 mb-4">
          {materjalid.length === 0 && (
            <p className="text-xs text-ink-faint">{t('settingsPage.noMaterialsAddThemUnderSettings')}</p>
          )}
          {materjalid.map(material => {
            const p = materialPrices[material] ?? { small: 0, large: 0 }
            return (
              <div key={material} className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 items-center px-1 py-0.5 min-w-[340px]">
                <span className="text-sm text-ink truncate" title={material}>{material}</span>
                <PriceInput value={p.small} onChange={v => setMaterialPrice(material, 'small', v)} />
                <PriceInput value={p.large} onChange={v => setMaterialPrice(material, 'large', v)} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Cost section with machine tabs */}
      <div className="border-t border-ink-faint/15 pt-3">
        <p className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-2">
          {t('settingsPage.costMaterialCost')}
        </p>
        {masinad.length > 0 && (
          <div className="flex items-center gap-1 mb-3">
            {tabs.map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setCostTab(tab)}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  costTab === tab
                    ? 'bg-accent text-white'
                    : 'bg-bg-sidebar text-ink-muted hover:text-ink'
                }`}
              >
                {tab === 'base' ? t('settingsPage.default') : tab}
              </button>
            ))}
          </div>
        )}
        {costTab !== 'base' && (
          <p className="text-[10px] text-ink-faint mb-2">
            {t('settingsPage.costOnMachine')} <strong>{costTab}</strong>.{' '}
            {t('settingsPage.ifEmptyTheDefaultPriceIs')}
          </p>
        )}
        <div className="overflow-x-auto">
          <div className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 mb-2 px-1 min-w-[340px]">
            <span className="text-[10px] font-semibold text-accent uppercase tracking-wide">{t('settingsPage.material')}</span>
            <span className="text-[10px] font-semibold text-accent uppercase tracking-wide text-center">{t('settingsPage.costSmall')}</span>
            <span className="text-[10px] font-semibold text-accent uppercase tracking-wide text-center">{t('settingsPage.costLarge')}</span>
          </div>
          <div className="space-y-1.5">
            {materjalid.map(material => {
              const key = costKey(material)
              return (
                <div key={material} className="px-1 py-0.5 min-w-[340px]">
                  <div className="grid grid-cols-[minmax(140px,1fr)_80px_80px] gap-x-2 items-center">
                    <span className="text-sm text-ink truncate" title={material}>{material}</span>
                    <PriceInput
                      value={materialCosts[key]?.small ?? 0}
                      onChange={v => setMaterialCost(key, 'small', v)}
                    />
                    <PriceInput
                      value={materialCosts[key]?.large ?? 0}
                      onChange={v => setMaterialCost(key, 'large', v)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Profile settings sub-component ───────────────────────────────────────────

/** Per-user channel choice (spec: "the user picks the channels"). The bell always shows. */
function EmailNotificationsToggle({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [on, setOn] = useState<boolean>(auth.profile?.notify_email ?? true)
  return (
    <label className="mt-4 flex items-start gap-2 text-sm text-ink max-w-xl">
      <input type="checkbox" className="mt-0.5" checked={on}
        onChange={async e => {
          const next = e.target.checked
          setOn(next)
          const { error } = await supabase.rpc('set_notify_email', { p_on: next })
          if (error) setOn(!next)
          else void auth.refreshProfile()
        }} />
      <span>
        {t('notifications.emailMe')}
        <span className="block text-xs text-ink-muted">{t('notifications.emailHelp')}</span>
      </span>
    </label>
  )
}

function ProfileSection({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [name, setName] = useState(auth.profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = name.trim() !== (auth.profile?.full_name ?? '')

  async function handleSave() {
    if (!auth.user || !dirty) return
    setSaving(true)
    try {
      await updateProfile(auth.user.id, { full_name: name.trim() })
      await auth.refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <User size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('settingsPage.yourProfile')}</h3>
        {saved && <span className="text-[10px] text-emerald-600 font-medium">{t('settingsPage.saved')}</span>}
      </div>
      <label className="label" htmlFor="kasutaja-nimi">{t('settingsPage.nameShownAsNoteAuthor')}</label>
      <input
        id="kasutaja-nimi"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t('settingsPage.eGKevinTreial')}
        className="input py-1.5 text-sm max-w-xs"
      />
      <p className="text-xs text-ink-faint mt-2 leading-relaxed">
        {t('settingsPage.addedAsTheAuthorOfEvery')}
      </p>
      {auth.user?.email && (
        <p className="text-xs text-ink-muted mt-1">
          {/* Never show the synthetic @wivo.invalid address — it is an
              implementation detail and looks like a broken account. */}
          {auth.profile?.username ? t('settingsPage.username') : t('settingsPage.email')}:{' '}
          {displayIdentity(auth.user.email, auth.profile?.username)}
          {' · '}{t('settingsPage.role')}: {auth.profile?.role ?? '—'}
        </p>
      )}
      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary mt-3 disabled:opacity-50"
        >
          {saving ? t('settingsPage.saving') : t('settingsPage.save')}
        </button>
      )}
      <EmailNotificationsToggle auth={auth} />
    </section>
  )
}

// ─── Work type price card ─────────────────────────────────────────────────────
// A card rather than a table row because a price now carries several facts —
// how it is charged, a full and a discount figure, and a picture — and a row
// wide enough for all of them stops being readable.
function WorkTypePriceCard({ type, onPatch }: {
  type: WorkType
  onPatch: (patch: Partial<WorkType>) => void
}) {
  const [showFile, setShowFile] = useState(false)
  const img = workTypeImage(type.nimi, type.pilt)
  const mode: PriceMode = type.hinnaTyyp ?? 'too'
  const suffix = mode === 'hammas' ? t('settingsPage.tooth') : t('settingsPage.job')

  const kulud = type.kulud ?? []
  const patchCost = (i: number, patch: Partial<WorkTypeCost>) =>
    onPatch({ kulud: kulud.map((k, n) => (n === i ? { ...k, ...patch } : k)) })
  const removeCost = (i: number) => onPatch({ kulud: kulud.filter((_, n) => n !== i) })
  const addCost = () => onPatch({ kulud: [...kulud, { nimi: '', summa: 0, tyyp: 'too' }] })

  const perJob = kulud.filter(k => k.tyyp === 'too').reduce((s, k) => s + k.summa, 0)
  const perTooth = kulud.filter(k => k.tyyp === 'hammas').reduce((s, k) => s + k.summa, 0)
  const costTotalHint = kulud.length === 0 ? null : [
    perJob > 0 ? t('settingsPage.job2', { perJob: perJob.toFixed(2) }) : null,
    perTooth > 0 ? t('settingsPage.tooth2', { perTooth: perTooth.toFixed(2) }) : null,
  ].filter(Boolean).join(' + ')

  return (
    <div className="rounded-xl border border-ink-faint/20 overflow-hidden bg-bg-card">
      {/* Picture, or a tinted placeholder in the type's own colour so a missing
          file still reads as that type rather than as an error. */}
      <div
        className="h-24 flex items-center justify-center relative"
        style={{ backgroundColor: `${type.hex}1f` }}
      >
        {img ? (
          <img src={img} alt={type.nimi} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-center px-2">
            <ImageIcon size={16} style={{ color: type.hex }} />
            <span className="text-[9px] text-ink-faint leading-tight">
              {slugifyWorkType(type.nimi)}.png
            </span>
          </div>
        )}
        <span
          className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white/70"
          style={{ backgroundColor: type.hex }}
        />
      </div>

      <div className="p-2.5 space-y-2">
        <p className="text-sm font-semibold text-ink truncate" title={type.nimi}>{type.nimi}</p>

        {/* Charging mode */}
        <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5">
          {([
            { key: 'too', label: t('settingsPage.perJob') },
            { key: 'hammas', label: t('settingsPage.perTooth') },
          ] as const).map(m => (
            <button
              key={m.key}
              type="button"
              onClick={() => onPatch({ hinnaTyyp: m.key })}
              className={`flex-1 text-[10px] font-medium py-1 rounded-md transition-colors ${
                mode === m.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Named, because the card carries two kinds of number and the costs
            below are NOT added to these. Someone reading "400" next to "300"
            reasonably assumes the client is billed 700. They are billed 400. */}
        <p className="text-[10px] font-semibold text-ink-soft">{t('settingsPage.clientPrice')}</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-medium text-ink-muted mb-0.5">{t('settingsPage.fullPrice')}</label>
            <div className="relative">
              <input
                type="number" min="0" step="0.5"
                value={type.hind ?? ''}
                placeholder="0"
                onChange={e => onPatch({ hind: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0 })}
                className="input py-1 pr-5 text-sm text-right"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">€</span>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-accent mb-0.5">{t('settingsPage.discountPrice')}</label>
            <div className="relative">
              <input
                type="number" min="0" step="0.5"
                value={type.soodushind ?? ''}
                placeholder="—"
                onChange={e => onPatch({ soodushind: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0 })}
                className="input py-1 pr-5 text-sm text-right"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">€</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-ink-faint">{suffix}</p>

        {/* Volume tiers. The base price above is the price from one unit, so a
            tier only ever states an EXCEPTION to it — nothing here has to
            restate "1+". Flat, not progressive: six crowns at the 6+ rate means
            all six at that rate, which is how the price gets quoted on the
            phone and therefore the only way the form can be checked. */}
        <div className="pt-1.5 border-t border-ink-faint/15">
          <p className="text-[10px] font-semibold text-ink-soft">{t('settingsPage.volumePrice')}</p>
          <p className="text-[10px] text-ink-faint mb-1">
            {t('settingsPage.fromThisNumberOfTeethOn', { mode })}{' '}
            <strong className="text-ink-muted">{t('settingsPage.toTheWholeJob')}</strong>
            {t('settingsPage.notJustTheTeethAboveIt')}
          </p>

          {/* Edited against the RAW array, never the sorted-and-cleaned one.
              `sortedTiers` drops a tier whose price is 0 — so clearing the
              field to retype it would delete the row out from under the cursor,
              and renumbering mid-typing would make it jump. Order and junk are
              settled at READ time (`tierFor`) and on load, not while typing. */}
          {(type.astmed ?? []).map((tier, i) => (
            <div key={`${tier.alates}-${i}`} className="flex items-center gap-1 mb-1">
              <span className="text-[10px] text-ink-faint w-8 flex-shrink-0">{t('settingsPage.from')}</span>
              <input
                type="number" min="2" step="1"
                value={tier.alates}
                onChange={e => onPatch({
                  astmed: (type.astmed ?? []).map((x, j) =>
                    j === i ? { ...x, alates: Math.max(1, parseInt(e.target.value) || 1) } : x
                  ),
                })}
                className="input py-1 text-sm w-12 text-right"
              />
              <div className="relative flex-1 min-w-0">
                <input
                  type="number" min="0" step="0.5"
                  value={tier.hind}
                  onChange={e => onPatch({
                    astmed: (type.astmed ?? []).map((x, j) =>
                      j === i ? { ...x, hind: parseFloat(e.target.value) || 0 } : x
                    ),
                  })}
                  className="input py-1 pr-5 text-sm text-right"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint pointer-events-none">€</span>
              </div>
              <button
                type="button"
                title={t('settingsPage.removeTier')}
                onClick={() => onPatch({
                  astmed: (type.astmed ?? []).filter((_, j) => j !== i),
                })}
                className="p-1 rounded text-ink-faint hover:text-red-500 transition-colors flex-shrink-0"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              // Seeded FROM the cleaned view so the suggestion is sensible,
              // but written onto the raw array so nothing already typed is lost.
              const rows = sortedTiers(type)
              const raw = type.astmed ?? []
              // Seeded above the last one so a second click never lands on a
              // quantity that already has a tier — two rows at the same
              // `alates` would make which one wins a matter of luck.
              const nextFrom = rows.length > 0 ? rows[rows.length - 1].alates + 1 : 3
              const from = rows.length > 0 ? rows[rows.length - 1].hind : (type.hind ?? 0)
              onPatch({ astmed: [...raw, { alates: nextFrom, hind: from }] })
            }}
            className="text-[10px] font-medium text-accent hover:underline"
          >
            {t('settingsPage.addVolumePrice')}
          </button>
        </div>

        {/* Consumables — a cost, not a price. Never reaches an invoice. */}
        <div className="pt-1.5 border-t border-ink-faint/15">
          <p className="text-[10px] font-semibold text-ink-soft">{t('settingsPage.ourCost')}</p>
          <p className="text-[10px] text-ink-faint mb-1">
            {t('settingsPage.suppliesThisJobAlwaysNeeds')}{' '}
            <strong className="text-ink-muted">{t('settingsPage.notAddedToTheClientPrice')}</strong>{' '}
            {t('settingsPage.takenOffTheMargin')}
          </p>
          {(type.kulud ?? []).map((k, i) => (
            <div key={`${k.nimi}-${i}`} className="flex items-center gap-1 mb-1">
              <input
                value={k.nimi}
                onChange={e => patchCost(i, { nimi: e.target.value })}
                placeholder={t('settingsPage.screw')}
                className="input py-0.5 text-[11px] flex-1 min-w-0"
              />
              <input
                type="number" min="0" step="0.5" value={k.summa}
                onChange={e => patchCost(i, { summa: parseFloat(e.target.value) || 0 })}
                className="input py-0.5 text-[11px] w-14 text-right"
              />
              <button
                type="button"
                onClick={() => patchCost(i, { tyyp: k.tyyp === 'hammas' ? 'too' : 'hammas' })}
                title={t('settingsPage.perJobPerTooth')}
                className="text-[9px] px-1 py-0.5 rounded bg-bg-sidebar text-ink-muted hover:text-accent transition-colors flex-shrink-0"
              >
                {k.tyyp === 'hammas' ? t('settingsPage.tooth3') : t('settingsPage.job3')}
              </button>
              <button
                type="button"
                onClick={() => removeCost(i)}
                className="p-0.5 rounded text-ink-faint hover:text-red-500 transition-colors flex-shrink-0"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addCost}
            className="text-[10px] text-accent hover:underline"
          >
            {t('settingsPage.addCost')}
          </button>
          {costTotalHint && (
            <p className="text-[9px] text-ink-faint mt-0.5">{costTotalHint}</p>
          )}
        </div>

        {showFile ? (
          <input
            autoFocus
            value={type.pilt ?? ''}
            onChange={e => onPatch({ pilt: e.target.value || undefined })}
            onBlur={() => setShowFile(false)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setShowFile(false) }}
            placeholder={`${slugifyWorkType(type.nimi)}.png`}
            className="input py-1 text-[11px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowFile(true)}
            className="text-[10px] text-ink-faint hover:text-accent transition-colors"
          >
            {type.pilt ? t('settingsPage.image', { pilt: type.pilt }) : t('settingsPage.setImageFile')}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Clinic sync banner ───────────────────────────────────────────────────────
// These settings are shared by the whole clinic, and until 1.7.15 they were not
// — they were per-machine. The banner says which of the two is true right now,
// because "my prices look wrong" is impossible to diagnose otherwise.
function ClinicSyncBanner({ canEdit }: { canEdit: boolean }) {
  const sync = useClinicSyncState()
  const auth = useAuth()

  // Three different situations used to collapse into one "Kliinik puudub":
  // no clinic at all, a clinic whose details failed to load, and a clinic that
  // is fine. They need different actions, so they get different messages.
  if (!auth.clinicId) {
    return (
      <div className="flex items-start gap-2 text-xs rounded-xl border border-orange-200 bg-orange-50 text-orange-800 px-3 py-2">
        <Building2 size={13} className="flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>{t('settingsPage.yourAccountHasNoClinic')}</strong>{' '}
          {t('settingsPage.untilItDoesSettingsApplyOnly')}
          {auth.role === 'owner'
            ? t('settingsPage.signOutAndBackInThe')
            : t('settingsPage.askTheOwnerToAddYou')}
        </p>
      </div>
    )
  }

  if (!auth.clinic) {
    return (
      <div className="flex items-start gap-2 text-xs rounded-xl border border-orange-200 bg-orange-50 text-orange-800 px-3 py-2">
        <Building2 size={13} className="flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {t('settingsPage.theClinicExistsButItsDetails')}
        </p>
      </div>
    )
  }

  /**
   * WHICH migration adds the column PostgREST is complaining about.
   *
   * This used to always say `sql/019_clinic_settings.sql`, whatever was
   * missing. `public_services` comes from 047 and `broneering` from 061, so the
   * banner sent people to run a file that would not have fixed anything — and
   * running it and seeing no change is worse than no advice at all.
   */
  function migrationFor(reason: string): string {
    const byColumn: [string, string][] = [
      ['public_services', 'sql/047_public_services.sql'],
      ['broneering',      'sql/061_visit_request_payment.sql'],
      ['email',           'sql/051_email_settings.sql'],
      ['ui_prefs',        'sql/055_profile_ui_prefs.sql'],
    ]
    for (const [column, file] of byColumn) {
      if (reason.includes(`'${column}'`) || reason.includes(` ${column} `)) return file
    }
    // The table itself is missing, not one column — that IS 019.
    return 'sql/019_clinic_settings.sql'
  }

  const [tone, text] = ((): [string, string] => {
    if (sync.status === 'loading') {
      return ['text-ink-muted bg-bg-sidebar border-ink-faint/20', t('settingsPage.loadingClinicSettings')]
    }
    if (sync.status === 'local') {
      return [
        'text-orange-700 bg-orange-50 border-orange-200',
        t('settingsPage.changesStayOnThisComputerOnly', { reason: sync.reason, reason2: migrationFor(sync.reason) }),
      ]
    }
    if (sync.status === 'synced') {
      const when = sync.at ? new Date(sync.at).toLocaleString(intlLocale) : null
      return [
        'text-emerald-700 bg-emerald-50 border-emerald-200',
        canEdit
          ? t('settingsPage.theseSettingsApplyToTheWhole', { when })
          : t('settingsPage.theseAreTheClinicSShared', { when })
      ]
    }
    return ['text-ink-muted bg-bg-sidebar border-ink-faint/20', t('settingsPage.noClinicSettingsApplyOnlyOn')]
  })()

  return (
    <div className={`flex items-start gap-2 text-xs rounded-xl border px-3 py-2 ${tone}`}>
      <Building2 size={13} className="flex-shrink-0 mt-0.5" />
      <p className="leading-relaxed">{text}</p>
    </div>
  )
}

// ─── Clinic settings sub-component ────────────────────────────────────────────

function ClinicSettingsSection({ clinic, onUpdate, isOwner }: {
  clinic: Clinic; onUpdate: () => Promise<void>; isOwner: boolean
}) {
  const [form, setForm] = useState({
    name: clinic.name ?? '',
    address: clinic.address ?? '',
    city: clinic.city ?? '',
    postal_code: clinic.postal_code ?? '',
    phone: clinic.phone ?? '',
    email: clinic.email ?? '',
    reg_code: clinic.reg_code ?? '',
    vat_number: clinic.vat_number ?? '',
    bank_name: clinic.bank_name ?? '',
    bank_account: clinic.bank_account ?? '',
    public_slug: clinic.public_slug ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = Object.entries(form).some(([k, v]) => v !== (clinic[k as keyof Clinic] ?? ''))

  async function handleSave() {
    if (!isOwner || !dirty) return
    setSaving(true)
    setError(null)
    try {
      const updates: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(form)) {
        updates[k] = v.trim() || null
      }
      updates.updated_at = new Date().toISOString()
      const { error: err } = await supabase.from('clinics').update(updates).eq('id', clinic.id)
      if (err) throw err
      await onUpdate()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      setError((err as Error)?.message ?? t('settingsPage.savingFailed'))
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  const Field = ({ label, field, placeholder, colSpan }: {
    label: string; field: string; placeholder: string; colSpan?: boolean
  }) => (
    <div className={colSpan ? 'col-span-2' : ''}>
      <label className="label">{label}</label>
      <input
        value={form[field as keyof typeof form]}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="input py-1.5 text-sm"
        disabled={!isOwner}
      />
    </div>
  )

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Building2 size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('settingsPage.clinicDetails')}</h3>
        {saved && <span className="text-[10px] text-emerald-600 font-medium">{t('settingsPage.saved')}</span>}
      </div>
      {!isOwner && (
        <p className="text-xs text-ink-faint">{t('settingsPage.onlyTheClinicOwnerCanChange')}</p>
      )}
      <div className="grid grid-cols-2 gap-3 max-w-lg">
        <Field label={t('settingsPage.clinicName')} field="name" placeholder={t('settingsPage.name')} colSpan />
        <Field label={t('settingsPage.address')} field="address" placeholder={t('settingsPage.streetNumber')} colSpan />
        <Field label={t('settingsPage.city')} field="city" placeholder="Tallinn" />
        <Field label={t('settingsPage.postcode')} field="postal_code" placeholder="10111" />
        <Field label={t('settingsPage.phone')} field="phone" placeholder="+372 5123 4567" />
        <Field label={t('settingsPage.email')} field="email" placeholder={t('settingsPage.infoClinicCom')} />
        <Field label={t('settingsPage.registryCode')} field="reg_code" placeholder="12345678" />
        <Field label={t('settingsPage.vATNumber')} field="vat_number" placeholder="EE123456789" />
        <Field label={t('settingsPage.bank')} field="bank_name" placeholder="LHV, SEB…" />
        <Field label="IBAN" field="bank_account" placeholder="EE00 1234 5678 9012 3456" />
      </div>

      {/* The public site's URL key. Its own block because it is the one field
          here that is not a company detail — it decides whether the clinic has
          a public booking page at all. */}
      <div className="max-w-lg pt-3 border-t border-ink-faint/15">
        <label className="label flex items-center gap-1.5">
          <Globe size={11} /> {t('settingsPage.websiteID')}
        </label>
        <input
          value={form.public_slug}
          onChange={e => set('public_slug', e.target.value)}
          onBlur={e => set('public_slug', slugify(e.target.value))}
          placeholder="fullgevity"
          className="input py-1.5 text-sm font-mono"
          disabled={!isOwner}
        />
        <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
          {t('settingsPage.aShortNameTheWebsiteUses')}
        </p>
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      {isOwner && dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? t('settingsPage.saving') : t('settingsPage.save')}
        </button>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each language is named IN ITSELF, never translated: someone who landed in
 * the wrong one is looking for the word they can read.
 */
const LANGUAGES: { key: Lang; label: string }[] = [
  { key: 'et', label: 'Eesti' },
  { key: 'en', label: 'English' },
]

function LanguageSection() {
  const auth = useAuth()
  const isAdmin = auth.profile?.role === 'owner' || auth.profile?.org_role === 'admin'
  const [orgLang, setOrgLang] = useState<Lang | undefined>(auth.clinic?.default_language)

  // Saved to the PROFILE first, so the choice follows the person to any
  // computer (LanguageSync applies it at sign-in); then this window reloads.
  async function choose(next: Lang) {
    if (auth.user) await supabase.from('profiles').update({ language: next }).eq('id', auth.user.id)
    setLang(next)
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Languages size={14} className="text-accent" />
        {/* Both words, whichever is active — this heading is the signpost. */}
        <h3 className="text-sm font-semibold text-ink">Keel · Language</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3">
        {t('settingsPage.yourOwnLanguage')}
      </p>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map(l => (
          <button
            key={l.key}
            type="button"
            onClick={() => void choose(l.key)}
            aria-pressed={lang === l.key}
            className={`px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-all duration-100 ${
              lang === l.key
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      {isAdmin && auth.clinic && (
        <label className="mt-4 block text-xs text-ink-muted max-w-md">
          {t('settingsPage.organisationDefaultLanguage')}
          <select className="input mt-1 w-48" value={orgLang ?? 'et'}
            onChange={async e => {
              const next = e.target.value as Lang
              setOrgLang(next)
              const { error } = await supabase.from('clinics').update({ default_language: next }).eq('id', auth.clinic!.id)
              if (error) setOrgLang(auth.clinic?.default_language)
            }}>
            {LANGUAGES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <span className="block mt-1">{t('settingsPage.organisationDefaultHelp')}</span>
        </label>
      )}
    </section>
  )
}

export function SettingsPage() {
  const {
    settings, setMaterialPrice, setMaterialCost, setDesignFee, setDefaultMachine, setTeema, setNumber, setFlag, setYldkulud, setKapslimasinad,
    setTekstiSuurus, setFixedCosts, setLisateenused, setPaneeliSuund, addOption, removeOption, renameOption, resetOptions,
    addWorkType, removeWorkType, updateWorkType, moveWorkType, resetWorkTypes,
    addVisitType, removeVisitType, updateVisitType, moveVisitType, resetVisitTypes,
  } = useSettings()
  const { stages, addStage, removeStage, renameStage, recolorStage, moveStage, setStageNotify, resetToDefaults } = usePipeline()
  const auth = useAuth()
  const { can } = usePermissions()

  const [group, setGroup] = useState<GroupKey>('profiil')

  // Töö etapid is the one clinic group that is not merely readable — every
  // control on it writes — so it takes pipeline.write rather than settings.read.
  const groupAllowed = (k: GroupKey): boolean =>
    PERSONAL_GROUPS.includes(k) ? true
      : k === 'etapid' ? can('pipeline.write')
        : can('settings.read')

  const visibleGroups = NAV_GROUPS
    .map(section => ({ ...section, items: section.items.filter(i => groupAllowed(i.key)) }))
    .filter(section => section.items.length > 0)

  // A worker without the permission would otherwise be left staring at a group
  // that renders nothing at all.
  const activeGroup: GroupKey = groupAllowed(group) ? group : 'profiil'

  const isClinicGroup = !PERSONAL_GROUPS.includes(activeGroup)
  const canEditClinic = auth.role === 'owner'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-page-ink">{t('settingsPage.settings')}</h1>
          <p className="text-sm text-page-muted">
            {t('settingsPage.manageYourWorkshopSDetailsPreferences')}
          </p>
        </div>

        <div className="flex items-start gap-5">
          {/* Section nav — only groups that actually exist; a nav item that led
              nowhere would be the same dead-UI problem as an empty panel. */}
          <nav className="w-[210px] flex-shrink-0 card p-2 space-y-3">
            {visibleGroups.map(section => (
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
                      activeGroup === key
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
          <div className="flex-1 min-w-0 space-y-3">
          {isClinicGroup && <ClinicSyncBanner canEdit={canEditClinic} />}
          {/* Read-only for everyone but the owner. Not merely cosmetic: without
              it a worker's edit would save to their own machine and never reach
              the clinic, which is the exact per-machine drift this page moved to
              the database to end. The RLS policy is the real enforcement. */}
          <div
            className={`grid grid-cols-1 2xl:grid-cols-2 gap-4 items-start [&>section]:card [&>section]:p-4 ${
              isClinicGroup && !canEditClinic ? 'pointer-events-none opacity-60 select-none' : ''
            }`}
          >

        {/* Kalender */}
        {activeGroup === 'kalender' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.workingDayAndTimelines')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label={t('settingsPage.weekViewStart')} suffix="h" min={0} max={23}
                value={settings.nadalAlgus}
                onChange={v => setNumber('nadalAlgus', v)}
                hint={t('settingsPage.theFirstHourOfTheVertical')}
              />
              <NumField
                label={t('settingsPage.weekViewEnd')} suffix="h" min={1} max={24}
                value={settings.nadalLopp}
                onChange={v => setNumber('nadalLopp', v)}
                hint={t('settingsPage.visitsOutsideTheRangeArePushed')}
              />
              <NumField
                label={t('settingsPage.timelineStart')} suffix="h" min={0} max={23}
                value={settings.ajajoonAlgus}
                onChange={v => setNumber('ajajoonAlgus', v)}
                hint={t('settingsPage.theHorizontalTrackInOverviewAnd')}
              />
              <NumField
                label={t('settingsPage.timelineEnd')} suffix="h" min={1} max={24}
                value={settings.ajajoonLopp}
                onChange={v => setNumber('ajajoonLopp', v)}
              />
              <NumField
                label={t('settingsPage.dragStep')} suffix="min" min={5} max={60} step={5}
                value={settings.ajaSamm}
                onChange={v => setNumber('ajaSamm', v)}
                hint={t('settingsPage.whenYouDragAVisitIn')}
              />
              {settings.kliinilineRezhiim && (
                <NumField
                  label={t('settingsPage.defaultVisitLength')} suffix="min" min={5} max={600} step={5}
                  value={settings.visiidiKestus}
                  onChange={v => setNumber('visiidiKestus', v)}
                />
              )}
            </div>

            {/* The switch that decides which product this is. Placed here
                rather than hidden in an advanced pane: someone who wants the
                patient record back must be able to find it. */}
            <div className="mt-6 pt-5 border-t border-ink-faint/15">
              <h4 className="text-sm font-semibold text-ink mb-1">{t('settingsPage.mode')}</h4>
              <p className="text-xs text-ink-muted leading-relaxed mb-3 max-w-xl">
                {t('settingsPage.whichSideOfTheAppIs')}
                <br />
                <strong>{t('settingsPage.theClinicalSide')}</strong>{' '}
                {t('settingsPage.patientRecordTreatmentChartVisitsIs')}
              </p>
              {/* Three buttons, not two checkboxes: two checkboxes can both be
                  unticked, and an app with neither half is a blank window. */}
              <div className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-0.5 w-fit">
                {([
                  { key: 'lab',    label: 'WivoLab',    lab: true,  clin: false },
                  { key: 'dental', label: 'WivoDental', lab: false, clin: true  },
                  { key: 'x',      label: 'WivoX',      lab: true,  clin: true  },
                ]).map(o => {
                  const active = settings.laboriRezhiim === o.lab
                    && settings.kliinilineRezhiim === o.clin
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => {
                        setFlag('laboriRezhiim', o.lab)
                        setFlag('kliinilineRezhiim', o.clin)
                      }}
                      className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                        active ? 'chip-active' : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
                <strong>WivoLab</strong> — {t('settingsPage.labJobsBoardClientsInvoices')}{' '}
                <strong>WivoDental</strong> — {t('settingsPage.clinicPatientsVisitsInvoices')}{' '}
                <strong>WivoX</strong> — {t('settingsPage.bothAClinicWithItsOwn')}
              </p>
            </div>
          </section>
        )}

        {activeGroup === 'partnerlused' && <PartnershipsSection />}
        {activeGroup === 'auditilogi' && <AuditLogSection />}
        {activeGroup === 'auditilogi' && <DeletedJobsSection />}

        {activeGroup === 'litsents' && <LicenseSection />}
        {activeGroup === 'litsents' && <UpdateSection />}

        {activeGroup === 'andmebaas' && <MigrationStatus />}

        {activeGroup === 'epost' && <EmailSection />}

        {/* Only where a public site exists at all. */}
        {activeGroup === 'avalik' && settings.kliinilineRezhiim && <PublicServicesSection />}
        {activeGroup === 'avalik' && !settings.kliinilineRezhiim && (
          <section>
            <p className="text-sm text-ink-muted max-w-xl leading-relaxed">
              {t('settingsPage.thePatientPriceListIsFor')}
            </p>
          </section>
        )}

        {/* Language. First in the tab because it is the one setting someone
            who cannot read the rest of the page has to be able to find. */}
        {activeGroup === 'kasutajaliides' && <LanguageSection />}

        {activeGroup === 'kasutajaliides' && <SoundSection />}

        {/* Teema */}
        {activeGroup === 'kasutajaliides' && (
          <section>
          <div className="flex items-center gap-2 mb-3">
            <Palette size={14} className="text-accent" />
            <h3 className="text-sm font-semibold text-ink">{t('settingsPage.theme')}</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map(theme => {
              // The custom tile shows the person's OWN colours. A fixed swatch
              // on this one would be the only tile in the row that lies about
              // what picking it does.
              const preview = theme.key === 'oma' && settings.omaTeema
                ? {
                  bg: settings.omaTeema['app-bg'] ?? theme.preview.bg,
                  card: settings.omaTeema['bg-card'] ?? theme.preview.card,
                }
                : theme.preview
              return (
              <button
                key={theme.key}
                type="button"
                onClick={() => setTeema(theme.key)}
                className={`text-left rounded-xl border-2 overflow-hidden transition-all ${
                  settings.teema === theme.key
                    ? 'border-accent shadow-card'
                    : 'border-ink-faint/25 hover:border-accent/40'
                }`}
              >
                {/* Live-ish preview: page background with a card floating on it */}
                <span className="block h-16 relative" style={{ background: preview.bg }}>
                  <span
                    className="absolute left-2 top-2 right-6 bottom-5 rounded-md"
                    style={{ background: preview.card, boxShadow: '0 1px 4px rgba(0,0,0,.18)' }}
                  />
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block text-xs font-semibold text-ink">{theme.label}</span>
                  <span className="block text-[10px] text-ink-muted leading-tight">{theme.hint}</span>
                </span>
              </button>
              )
            })}
          </div>
        </section>
          )}

          {/* The editor for the last of those tiles. Its own section rather
              than a popup inside the tile: picking colours means looking at the
              app while you do it, and a dialog covering the app defeats that. */}
          {activeGroup === 'kasutajaliides' && <ThemeEditor />}

          {/* Text size */}
          {activeGroup === 'kasutajaliides' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Type size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.textSize')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.scalesTheWholeInterfaceEvenlyText')}
            </p>

            <div className="flex flex-wrap gap-2">
              {TEXT_SIZES.map(size => {
                const active = Math.abs(settings.tekstiSuurus - size.value) < 0.001
                return (
                  <button
                    key={size.key}
                    type="button"
                    onClick={() => setTekstiSuurus(size.value)}
                    className={`px-3 py-2 rounded-xl border-2 transition-all duration-100 text-left ${
                      active
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                    }`}
                  >
                    {/* The label previews its own scale — 90% vs 110% is hard to
                        judge from a number alone. */}
                    <span
                      className="block font-semibold leading-tight"
                      style={{ fontSize: `${13 * size.value}px` }}
                    >
                      {size.label}
                    </span>
                    <span className={`block text-[10px] ${active ? 'text-white/70' : 'text-ink-faint'}`}>
                      {size.hint}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <input
                type="range"
                min={0.8}
                max={1.6}
                step={0.05}
                value={settings.tekstiSuurus}
                onChange={e => setTekstiSuurus(parseFloat(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="text-xs font-semibold text-ink tabular-nums w-12 text-right">
                {Math.round(settings.tekstiSuurus * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setTekstiSuurus(1)}
                className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
              >
                <RotateCcw size={11} /> 100%
              </button>
            </div>
          </section>
          )}

          {activeGroup === 'kasutajaliides' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Layers size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.panelDirection')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.howTheJobAndVisitDetail')}
            </p>
            <div className="flex gap-2">
              {([
                { key: 'fullscreen' as const, label: t('settingsPage.fullScreen'), desc: t('settingsPage.toothChartInTheMiddleDetails') },
                { key: 'side' as const, label: t('settingsPage.sidePanel'), desc: t('settingsPage.opensFromTheRight') },
                { key: 'bottom' as const, label: t('settingsPage.bottomPanel'), desc: t('settingsPage.opensFromTheBottom') },
              ]).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPaneeliSuund(opt.key)}
                  className={`flex-1 text-left rounded-xl border-2 p-3 transition-all ${
                    settings.paneeliSuund === opt.key
                      ? 'border-accent bg-accent/5'
                      : 'border-ink-faint/25 hover:border-accent/40'
                  }`}
                >
                  <p className={`text-sm font-medium ${settings.paneeliSuund === opt.key ? 'text-accent' : 'text-ink'}`}>
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-ink-muted">{opt.desc}</p>
                </button>
              ))}
            </div>
          </section>
          )}

          {/* Your name — stamped as the author on every patient note */}
          {activeGroup === 'profiil' && (
          <>
            <ProfileSection auth={auth} />
            <SignOutOthersSection />
          </>
          )}

          {/* Clinic settings — owner only */}
          {activeGroup === 'kliinik' && (
            auth.clinic ? (
              <ClinicSettingsSection clinic={auth.clinic} onUpdate={auth.refreshProfile} isOwner={auth.role === 'owner'} />
            ) : (
              // Previously this rendered NOTHING when the clinic was missing,
              // which is how a broken clinic looked identical to an empty page.
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">{t('settingsPage.clinic')}</h3>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {t('settingsPage.theClinicSDetailsHaveNot')}
                </p>
              </section>
            )
          )}

          {/* Machine default */}
          {activeGroup === 'masinad' && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.defaultMachine')}</h3>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              {settings.masinad.length === 0 && (
                <p className="text-xs text-ink-faint">{t('settingsPage.noMachinesAdded')}</p>
              )}
              {settings.masinad.map(m => (
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
                  {t('settingsPage.clear')}
                </button>
              )}
            </div>
          </section>
          )}

          {/* Machine list */}
          {activeGroup === 'masinad' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.machines')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.theseButtonsSitUnderTheMachine')}
            </p>
            <OptionListEditor
              items={settings.masinad}
              placeholder={t('settingsPage.eGPro95S')}
              emptyHint={t('settingsPage.noMachinesTheJobFormShows')}
              onAdd={v => addOption('masinad', v)}
              onRemove={v => removeOption('masinad', v)}
              onRename={(a, b) => renameOption('masinad', a, b)}
              onReset={() => resetOptions('masinad')}
            />
          </section>
          )}

          {/* Which printers work from capsules. A property of the MACHINE, not
              of the material: the same resin is a cartridge on one and a bottle
              on the next, and keying it off the material made the job form
              demand a capsule count on a Pro2 and refuse to save. */}
          {activeGroup === 'masinad' && settings.masinad.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.capsuleMachines')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3 max-w-xl leading-relaxed">
              {t('settingsPage.markTheMachinesThatPrintFrom')}
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              {settings.masinad.map(m => {
                const on = settings.kapslimasinad.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setKapslimasinad(
                      on ? settings.kapslimasinad.filter(x => x !== m) : [...settings.kapslimasinad, m]
                    )}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all duration-100 ${
                      on
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg-sidebar text-ink-muted border-ink-faint/30 hover:border-accent/40'
                    }`}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
            {settings.kapslimasinad.length === 0 && (
              <p className="text-[11px] text-ink-faint mt-2">
                {t('settingsPage.noneMarkedTheCapsuleCountIs')}
              </p>
            )}
          </section>
          )}

          {/* Materials */}
          {activeGroup === 'valikud' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <ListChecks size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.materials')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.buttonsOnTheJobAndRevision')}
            </p>
            <OptionListEditor
              items={settings.materjalid}
              placeholder={t('settingsPage.eGZirconiaA2')}
              emptyHint={t('settingsPage.noMaterialsYouCanStillType')}
              onAdd={v => addOption('materjalid', v)}
              onRemove={v => removeOption('materjalid', v)}
              onRename={(a, b) => renameOption('materjalid', a, b)}
              onReset={() => resetOptions('materjalid')}
            />
          </section>
          )}

          {/* Work types */}
          {activeGroup === 'valikud' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Layers size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.workTypes')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-1">
              {t('settingsPage.suggestionsUnderTheJobFieldOn')}
            </p>
            <p className="text-xs text-ink-faint mb-3">
              <strong className="text-ink-muted">{t('settingsPage.colour')}</strong>{' '}
              {t('settingsPage.isTheOneTheCalendarUses')}
            </p>

            <div className="space-y-0.5 mb-3">
              {settings.tooTuubid.length === 0 && (
                <p className="text-xs text-ink-faint">
                  {t('settingsPage.noWorkTypesAllJobsAre')}
                </p>
              )}
              {settings.tooTuubid.map((workType, idx) => (
                <WorkTypeRow
                  key={workType.nimi}
                  type={workType}
                  isFirst={idx === 0}
                  isLast={idx === settings.tooTuubid.length - 1}
                  onRename={nimi => updateWorkType(workType.nimi, { nimi })}
                  onRecolor={hex => updateWorkType(workType.nimi, { hex })}
                  onRemove={() => removeWorkType(workType.nimi)}
                  onMove={dir => moveWorkType(workType.nimi, dir)}
                />
              ))}
            </div>

            <AddWorkTypeRow onAdd={addWorkType} />

            {/* Visit types — only in a mode that books patients. */}
            {settings.kliinilineRezhiim && (
              <div className="mt-8 pt-5 border-t border-ink-faint/15">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays size={14} className="text-accent" />
                  <h3 className="text-sm font-semibold text-ink">{t('settingsPage.visitTypes')}</h3>
                </div>
                <p className="text-xs text-ink-faint mb-1">
                  {t('settingsPage.whyThePatientIsComingCheck')}
                </p>
                <p className="text-xs text-ink-faint mb-3">
                  <strong className="text-ink-muted">{t('settingsPage.colour')}</strong>{' '}
                  {t('settingsPage.fillsTheVisitCardInThe')}{' '}
                  <em>{t('settingsPage.status')}</em>{' '}
                  {t('settingsPage.plannedArrivedCancelledColoursTheCard')}
                </p>

                <div className="space-y-0.5 mb-3">
                  {settings.visiidiTyybid.length === 0 && (
                    <p className="text-xs text-ink-faint">
                      {t('settingsPage.noVisitTypesAllVisitsAre')}
                    </p>
                  )}
                  {settings.visiidiTyybid.map((visitType, idx) => (
                    <WorkTypeRow
                      key={visitType.nimi}
                      type={visitType}
                      isFirst={idx === 0}
                      isLast={idx === settings.visiidiTyybid.length - 1}
                      onRename={nimi => updateVisitType(visitType.nimi, { nimi })}
                      onRecolor={hex => updateVisitType(visitType.nimi, { hex })}
                      onRemove={() => removeVisitType(visitType.nimi)}
                      onMove={dir => moveVisitType(visitType.nimi, dir)}
                    />
                  ))}
                </div>

                <AddWorkTypeRow onAdd={addVisitType} />

                <button
                  type="button"
                  onClick={resetVisitTypes}
                  className="mt-3 text-xs text-ink-muted hover:text-ink underline"
                >
                  {t('settingsPage.restoreDefaultTypes')}
                </button>
                <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
                  {t('settingsPage.renamingATypeDoesnTChange')}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={resetWorkTypes}
              className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500 transition-colors"
            >
              <RotateCcw size={11} /> {t('settingsPage.resetToDefaults')}
            </button>
          </section>
          )}





          {/* Hinnad is laid out by hand rather than flowing through the generic
              grid: the price list is the work, and the rest is reference. Two
              columns keep the reprice tool and the type cards together on the
              left instead of scattering five cards across the width. */}
          {activeGroup === 'hinnad' && (
            <div className="col-span-full space-y-8">

              {/* Two groups, because this tab holds two kinds of number and a
                  work-type card shows both side by side: 400 € the client pays
                  and a 300 € abutment that does NOT reach the invoice. Reading
                  them as one list is how "so we bill 700" happens. */}
              <div>
                <h2 className="text-base font-semibold text-ink mb-1">{t('settingsPage.clientPrices')}</h2>
                <p className="text-xs text-ink-faint mb-3 max-w-2xl leading-relaxed">
                  {t('settingsPage.whatTheClientPaysTheWork')}
                </p>
            <div className="col-span-full grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start [&_section]:card [&_section]:p-4">
              <div className="space-y-4 min-w-0">
          {/* Bulk reprice — owner only: it rewrites financial fields on rows that
              already exist, and only the owner can change the price list it
              reads from in the first place. */}
          {canEditClinic && <RepriceJobsSection />}
          {/* Per-job prices by work type */}
                    <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.jobPrices')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-4">
              {t('settingsPage.eachWorkTypeIsPricedEither')}{' '}
              <strong className="text-ink-muted">{t('settingsPage.perJob2')}</strong> {t('settingsPage.or')}{' '}
              <strong className="text-ink-muted">{t('settingsPage.perTooth2')}</strong>{' '}
              {t('settingsPage.bridgesAndDesignArePerTooth')}
              <br />
              {t('settingsPage.theListIsTheSameAs')}{' '}
              <strong className="text-ink-muted">{t('settingsPage.optionsWorkTypes')}</strong>{' '}
              {t('settingsPage.addAndRemoveTypesThereImages')}{' '}
              <code className="px-1 rounded bg-bg-sidebar">src/renderer/src/assets/worktypes/</code>,{' '}
              {t('settingsPage.fileNameTheTypeNameIn')}{' '}
              <code className="px-1 rounded bg-bg-sidebar">kroon.png</code>).{' '}
              {t('settingsPage.seeTheFolderSREADME')}
            </p>

            {settings.tooTuubid.length === 0 ? (
              <p className="text-xs text-ink-faint">
                {t('settingsPage.noWorkTypesAddThemUnder')}
              </p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {settings.tooTuubid.map(workType => (
                  <WorkTypePriceCard
                    key={workType.nimi}
                    type={workType}
                    onPatch={patch => updateWorkType(workType.nimi, patch)}
                  />
                ))}
              </div>
            )}
          </section>
              </div>
              <div className="space-y-4 min-w-0">
          {/* Design fee */}
                    <section>
            <div className="flex items-center gap-2 mb-3">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.automaticPricing')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label={t('settingsPage.defaultPricePerTooth')} suffix="€" min={0} max={500} step={0.5}
                value={settings.hambaHind}
                onChange={v => setNumber('hambaHind', v)}
                hint={t('settingsPage.usedWhenTheMaterialHasNo')}
              />
              <NumField
                label={t('settingsPage.revisionPricePerTooth')} suffix="€" min={0} max={500} step={0.5}
                value={settings.muudatusHambaHind}
                onChange={v => setNumber('muudatusHambaHind', v)}
                hint={t('settingsPage.aNewRevisionIsPricedFrom')}
              />
              <NumField
                label={t('settingsPage.rushMultiplier')} suffix="×" min={1} max={5} step={0.1}
                value={settings.kiirtooKordaja}
                onChange={v => setNumber('kiirtooKordaja', v)}
                hint={t('settingsPage.forARushJobTheCalculated')}
              />
              <NumField
                label={t('settingsPage.modelPrice')} suffix="€" min={0} max={500} step={5}
                value={settings.mudeliHind}
                onChange={v => setNumber('mudeliHind', v)}
                hint={t('settingsPage.addedToThePriceWhenModel')}
              />
              <NumField
                label={t('settingsPage.vATRate')} suffix="%" min={0} max={30} step={0.5}
                value={settings.kmMaar}
                onChange={v => setNumber('kmMaar', v)}
                hint={t('settingsPage.theDefaultRateForANew')}
              />
              <NumField
                label={t('settingsPage.paymentTerms')} suffix={t('settingsPage.d')} min={0} max={180}
                value={settings.makseTahtaegPaevades}
                onChange={v => setNumber('makseTahtaegPaevades', v)}
                hint={t('settingsPage.daysFromTheInvoiceDateTo')}
              />
              <NumField
                label={t('settingsPage.employerTaxes')} suffix="%" min={0} max={100} step={0.1}
                value={settings.tooandjaMaksudProtsent}
                onChange={v => setNumber('tooandjaMaksudProtsent', v)}
                hint={t('settingsPage.addedToGrossPayToShow')}
              />
              {/* The employee side. Needed only when someone's pay is entered
                  NET — then bruto, and with it the clinic's real cost, has to
                  be computed backwards from take-home pay. Left at 0 they do
                  nothing, and Töötasud says so rather than quietly showing a
                  gross equal to the net. */}
              <NumField
                label={t('settingsPage.incomeTax')} suffix="%" min={0} max={100} step={0.1}
                value={settings.tulumaksProtsent}
                onChange={v => setNumber('tulumaksProtsent', v)}
                hint={t('settingsPage.incomeTaxWithheldFromTheEmployee')}
              />
              <NumField
                label={t('settingsPage.taxFreeAllowance')} suffix={t('settingsPage.month')} min={0} max={5000} step={10}
                value={settings.maksuvabaTuluKuus}
                onChange={v => setNumber('maksuvabaTuluKuus', v)}
                hint={t('settingsPage.theClinicDefaultItCanBe')}
              />
              <NumField
                label={t('settingsPage.employeeUnemploymentInsurance')} suffix="%" min={0} max={10} step={0.1}
                value={settings.tootajaTootuskindlustusProtsent}
                onChange={v => setNumber('tootajaTootuskindlustusProtsent', v)}
                hint={t('settingsPage.theShareWithheldFromGrossPay')}
              />
              <NumField
                label={t('settingsPage.fundedPensionIIPillar')} suffix="%" min={0} max={20} step={1}
                value={settings.kogumispensionProtsent}
                onChange={v => setNumber('kogumispensionProtsent', v)}
                hint={t('settingsPage.theDefaultRateItIsEach')}
              />
            </div>
          </section>
                  <section>
            <div className="flex items-center gap-2 mb-3">
              <Pencil size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.designPriceJob')}</h3>
            </div>
            <div className="flex items-center gap-3">
              <PriceInput
                value={settings.designFee}
                onChange={setDesignFee}
              />
              <p className="text-xs text-ink-faint leading-relaxed">
                {t('settingsPage.addToAJobWhenThe')}
              </p>
            </div>
          </section>
          {/* Per-material pricing table */}
                    <section>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.priceByMaterial')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-4">
              {t('settingsPage.smallToothPositions15Incisors')}<br />
              {t('settingsPage.largeToothPositions68Molars')}<br />
              <strong className="text-ink-muted">{t('settingsPage.cost')}</strong>{' '}
              {t('settingsPage.isWhatTheMaterialCostsYou')}
            </p>

            {/* Machine tab for cost pricing */}
            <MaterialCostTabs
              materjalid={settings.materjalid}
              masinad={settings.masinad}
              materialPrices={settings.materialPrices}
              materialCosts={settings.materialCosts}
              setMaterialPrice={setMaterialPrice}
              setMaterialCost={setMaterialCost}
            />



          {/* Extra services price list */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.extraServicesPriceListOptions')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.servicesThatCanBeAddedTo')}
            </p>
            <div className="space-y-1.5 mb-2">
              {settings.lisateenused.map((svc, idx) => (
                <div key={svc.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={svc.nimi}
                    onChange={e => {
                      const next = settings.lisateenused.map((s, i) => i === idx ? { ...s, nimi: e.target.value } : s)
                      setLisateenused(next)
                    }}
                    placeholder={t('settingsPage.serviceName')}
                    className="input py-1.5 text-sm flex-1"
                  />
                  <div className="relative w-24">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={svc.hind}
                      onChange={e => {
                        const next = settings.lisateenused.map((s, i) => i === idx ? { ...s, hind: parseFloat(e.target.value) || 0 } : s)
                        setLisateenused(next)
                      }}
                      className="input py-1.5 text-sm pr-7 text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">€</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLisateenused(settings.lisateenused.filter((_, i) => i !== idx))}
                    className="p-1 text-ink-faint hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLisateenused([...settings.lisateenused, { id: crypto.randomUUID(), nimi: '', hind: 0 }])}
              className="text-xs text-accent font-medium hover:underline"
            >
              {t('settingsPage.addService')}
            </button>
          </section>

          {/* Example */}
          <div className="p-3 bg-bg-sidebar rounded-xl text-xs text-ink-muted leading-relaxed">
            <span className="font-semibold text-ink block mb-1">{t('settingsPage.automaticPricingExample')}</span>
            {t('settingsPage.onXTough2Small45Large')}<br />
            = 3×45 + 1×60 + 20 = <span className="font-semibold text-ink">215.00 €</span>
          </div>
          </section>
              </div>
            </div>
              </div>

              <div>
                <h2 className="text-base font-semibold text-ink mb-1">{t('settingsPage.clinicCosts')}</h2>
                <p className="text-xs text-ink-faint mb-3 max-w-2xl leading-relaxed">
                  {t('settingsPage.whatTheWorkCostsUsNone')}
                </p>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start [&_section]:card [&_section]:p-4">
          {/* Monthly overheads — what makes the margin a profit */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.overheads')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3 max-w-xl leading-relaxed">
              {t('settingsPage.rentLeasesSoftwarePhoneFoodCosts')}
            </p>
            <div className="space-y-1.5 mb-2">
              {settings.yldkulud.map((o, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={o.nimi}
                    onChange={e => {
                      const next = [...settings.yldkulud]
                      next[idx] = { ...next[idx], nimi: e.target.value }
                      setYldkulud(next)
                    }}
                    placeholder={t('settingsPage.eGRent')}
                    className="input py-1.5 text-sm flex-1"
                  />
                  <div className="relative w-28">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={o.summa}
                      onChange={e => {
                        const next = [...settings.yldkulud]
                        next[idx] = { ...next[idx], summa: parseFloat(e.target.value) || 0 }
                        setYldkulud(next)
                      }}
                      className="input py-1.5 text-sm pr-7 text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">€</span>
                  </div>
                  {/* How often it falls due. Everything is converted to a
                      month before it reaches Rahandus — this only says how it
                      was TYPED, which is how the person actually knows it. */}
                  <select
                    value={o.periood ?? 'kuu'}
                    onChange={e => {
                      const next = [...settings.yldkulud]
                      next[idx] = { ...next[idx], periood: e.target.value as OverheadPeriood }
                      setYldkulud(next)
                    }}
                    className="input py-1.5 text-xs w-24"
                  >
                    <option value="paev">{t('settingsPage.workingDay')}</option>
                    <option value="nadal">{t('settingsPage.week')}</option>
                    <option value="kuu">{t('settingsPage.month2')}</option>
                    <option value="aasta">{t('settingsPage.year')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setYldkulud(settings.yldkulud.filter((_, i) => i !== idx))}
                    className="p-1 text-ink-faint hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            {/* Only asked for once a per-day cost exists. A lab entering rent
                and nothing else never needs to answer it, and an unexplained
                number in a costs card is a number people distrust. */}
            {settings.yldkulud.some(o => o.periood === 'paev') && (
              <div className="flex items-center gap-2 mb-2 rounded-lg bg-bg-sidebar/60 px-2.5 py-2">
                <span className="text-xs text-ink-muted">{t('settingsPage.workingDaysPerWeek')}</span>
                <input
                  type="number" min={1} max={7} step={1}
                  value={settings.toopaevadNadalas}
                  onChange={e => setNumber('toopaevadNadalas',
                    Math.min(7, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                  className="input py-1 text-sm w-16 text-right"
                />
                <span className="text-[11px] text-ink-faint">
                  {t('settingsPage.onlyForWorkingDayRowsDays', { value: (52 / 12 * settings.toopaevadNadalas).toFixed(1) })}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setYldkulud([...settings.yldkulud, { nimi: '', summa: 0, periood: 'kuu' }])}
              className="btn-ghost text-xs border border-ink-faint/25"
            >
              <Plus size={12} /> {t('settingsPage.addOverhead')}
            </button>
            {settings.yldkulud.length > 0 && (
              <p className="text-xs text-ink-muted mt-2">
                {t('settingsPage.total')}{' '}
                <strong className="text-ink tabular-nums">
                  {/* The SAME function Rahandus uses. A total computed
                      separately here would be a second implementation of the
                      conversion, and the two would drift. */}
                  {overheadsMonthly(settings.yldkulud, settings.toopaevadNadalas).toFixed(2)} €
                </strong>{' '}
                {t('settingsPage.aMonth')}
                {settings.yldkulud.some(o => (o.periood ?? 'kuu') !== 'kuu') && (
                  <span className="text-ink-faint">{t('settingsPage.allConvertedToAMonth')}</span>
                )}
              </p>
            )}
          </section>

          {/* Fixed costs per job */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Euro size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.fixedCostsPerJob')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.addedAutomaticallyToEveryJobS')}
            </p>
            <div className="space-y-1.5 mb-2">
              {settings.fixedCostsPerJob.map((cost, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={cost.nimi}
                    onChange={e => {
                      const next = [...settings.fixedCostsPerJob]
                      next[idx] = { ...next[idx], nimi: e.target.value }
                      setFixedCosts(next)
                    }}
                    placeholder={t('settingsPage.costName')}
                    className="input py-1.5 text-sm flex-1"
                  />
                  <div className="relative w-24">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cost.summa}
                      onChange={e => {
                        const next = [...settings.fixedCostsPerJob]
                        next[idx] = { ...next[idx], summa: parseFloat(e.target.value) || 0 }
                        setFixedCosts(next)
                      }}
                      className="input py-1.5 text-sm pr-7 text-right"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">€</span>
                  </div>
                  <span className="text-xs text-ink-faint">{t('settingsPage.job3')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = settings.fixedCostsPerJob.filter((_, i) => i !== idx)
                      setFixedCosts(next)
                    }}
                    className="p-1 text-ink-faint hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const next = [...settings.fixedCostsPerJob, { nimi: '', summa: 0 }]
                setFixedCosts(next)
              }}
              className="text-xs text-accent font-medium hover:underline"
            >
              {t('settingsPage.addCost')}
            </button>
            {settings.fixedCostsPerJob.length > 0 && (
              <p className="text-xs text-ink-muted mt-2">
                {t('settingsPage.total2')} <strong className="tabular-nums">{settings.fixedCostsPerJob.reduce((s, c) => s + c.summa, 0).toFixed(2)} €</strong> {t('settingsPage.job4')}
              </p>
            )}
          </section>
                </div>
              </div>

            </div>
          )}

          {/* Pipeline stages */}
          {activeGroup === 'etapid' && <StageTransitionsSection />}

          {activeGroup === 'etapid' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Layers size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.workflow')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              {t('settingsPage.addRemoveOrRenamePipelineStages')}
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
              <RotateCcw size={11} /> {t('settingsPage.resetToDefaults')}
            </button>
          </section>
          )}

          {activeGroup === 'etapid' && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Bell size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-ink">{t('settingsPage.stageNotifications')}</h3>
            </div>
            <p className="text-xs text-ink-faint mb-3">{t('settingsPage.stageNotificationsHelp')}</p>
            <table className="text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="py-1.5 pr-6">{t('settingsPage.stage')}</th>
                  <th className="py-1.5 pr-6 text-center">{t('settingsPage.notifyTechnician')}</th>
                  <th className="py-1.5 text-center">{t('settingsPage.notifyDesigner')}</th>
                </tr>
              </thead>
              <tbody>
                {stages.map(stage => (
                  <tr key={stage.key} className="border-t border-ink-faint/15">
                    <td className="py-1.5 pr-6">
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ backgroundColor: stage.hex }} />
                      {stage.label}
                    </td>
                    {(['notifyTechnician', 'notifyDesigner'] as const).map(who => (
                      <td key={who} className="py-1.5 pr-6 text-center">
                        <input type="checkbox" checked={stage[who] !== false}
                          aria-label={`${stage.label}: ${who === 'notifyTechnician' ? t('settingsPage.notifyTechnician') : t('settingsPage.notifyDesigner')}`}
                          onChange={e => setStageNotify(stage.key, who, e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          )}

          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
