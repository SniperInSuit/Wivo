import { useMemo, useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { useSettings } from '@/stores/useSettings'
import { SelectableCard } from '../ui/SelectableCard'
import { WizardField } from '../ui/WizardField'
import { WizardSearch } from '../ui/WizardSearch'
import { WIZARD_INPUT, WIZARD_BTN } from '../wizardTheme'
import { pushRecentMaterial, readRecentMaterials } from './recentMaterials'

export interface MaterialPickerProps {
  /** The material assigned to ONE piece of work. */
  value: string | null
  onChange: (material: string | null) => void
  /** Paints the group border red and is announced through describedBy. */
  invalid?: boolean
  /** id of the error element rendered by the step, for aria-describedby. */
  describedBy?: string
  /** id of the label this group is named by. */
  labelledBy?: string
}

/** '15 € / hammas' or '15–22 € / hammas' — only when the lab actually priced it. */
function priceLabel(small: number, large: number): string | undefined {
  if (!small && !large) return undefined
  if (small === large) return `${small} € / hammas`
  return `${small}–${large} € / hammas`
}

/**
 * One material for one piece of work.
 *
 * Single-select, and that is the fix rather than a restriction: it used to be a
 * multi-select where only the first entry could ever be priced and the rest
 * became a line in the description, because `quoteJob` took one job-level
 * material. A lab that makes the crowns in Ceramic Crown and the bridges in OnX
 * Tough 2 had no way to say so, and got the whole case quoted at the first
 * material's rate. Materials now belong to work items, which is where the
 * difference actually lives — see `materialByType` in shared/wizard/types.
 */
export function MaterialPicker({
  value, onChange, invalid, describedBy, labelledBy,
}: MaterialPickerProps) {
  const { settings } = useSettings()
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState('')

  // Read once per mount: recents reordering under the user's cursor mid-step
  // would move the card they were about to click.
  const [recents] = useState(readRecentMaterials)

  const options = useMemo(() => {
    const known = settings.materjalid
    const recentFirst = [
      ...recents.filter(m => known.includes(m)),
      ...known.filter(m => !recents.includes(m)),
    ]
    // Anything already chosen must stay visible even if it is a free-text
    // material that was never in Seaded, or was deleted from it since.
    return value && !recentFirst.includes(value) ? [value, ...recentFirst] : recentFirst
  }, [settings.materjalid, recents, value])

  const q = query.trim().toLowerCase()
  const visible = q ? options.filter(m => m.toLowerCase().includes(q)) : options

  // Clicking the chosen one clears it, so a wrong pick is one click to undo
  // rather than a state you cannot leave.
  const pick = (material: string) => {
    if (value === material) { onChange(null); return }
    pushRecentMaterial(material)
    onChange(material)
  }

  const addCustom = () => {
    const name = custom.trim()
    if (!name) return
    pushRecentMaterial(name)
    onChange(name)
    setCustom('')
  }

  return (
    <div className="space-y-4">
      {settings.materjalid.length > 8 && (
        <WizardSearch
          value={query}
          onChange={setQuery}
          placeholder="Otsi materjali…"
          ariaLabel="Otsi materjali"
          resultLabel={q ? `${visible.length} vastet` : undefined}
        />
      )}

      {/* A labelled group rather than a WizardField: the control here is a set
          of buttons, and WizardField's aria wiring targets a single input. */}
      <div
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={`flex flex-wrap gap-3 rounded-xl ${invalid ? 'ring-2 ring-rose-400/60 p-2 -m-2' : ''}`}
      >
        {visible.map(m => {
          const pricing = settings.materialPrices[m]
          return (
            <SelectableCard
              key={m}
              selected={value === m}
              onToggle={() => pick(m)}
              label={m}
              sublabel={priceLabel(pricing?.small ?? 0, pricing?.large ?? 0)}
              icon={<Layers className="w-5 h-5 text-ink-muted" aria-hidden="true" />}
            />
          )
        })}
        {visible.length === 0 && (
          <p className="text-base text-ink-muted py-4">
            Ühtegi materjali ei leitud. Lisa oma materjal allpool.
          </p>
        )}
      </div>

      <WizardField
        label="Lisa oma materjal"
        htmlFor="wizard-materjal-custom"
        help="Kui materjali nimekirjas pole, kirjuta see siia ja vajuta Lisa."
      >
        <div className="flex gap-2">
          <input
            id="wizard-materjal-custom"
            type="text"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
            placeholder="Nt Zirkoon 1200 MPa"
            className={WIZARD_INPUT}
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={custom.trim() === ''}
            className={`${WIZARD_BTN} shrink-0 inline-flex items-center gap-2 border border-ink-faint/40 bg-bg-card text-ink-soft disabled:opacity-40`}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Lisa
          </button>
        </div>
      </WizardField>
    </div>
  )
}
