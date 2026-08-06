import { useMemo, useState } from 'react'
import { Layers, Plus, Star, X } from 'lucide-react'
import { useSettings } from '@/stores/useSettings'
import { SelectableCard } from '../ui/SelectableCard'
import { WizardField } from '../ui/WizardField'
import { WizardSearch } from '../ui/WizardSearch'
import { FOCUS_RING, WIZARD_HELP, WIZARD_INPUT, WIZARD_BTN } from '../wizardTheme'
import { pushRecentMaterial, readRecentMaterials } from './recentMaterials'

export interface MaterialPickerProps {
  /** state.materials. Order is meaningful: [0] is the priced one. */
  value: string[]
  onChange: (materials: string[]) => void
  /** Paints the group border red and is announced through describedBy. */
  invalid?: boolean
  /** id of the error element rendered by the step, for aria-describedby. */
  describedBy?: string
}

/** '15 € / hammas' or '15–22 € / hammas' — only when the lab actually priced it. */
function priceLabel(small: number, large: number): string | undefined {
  if (!small && !large) return undefined
  if (small === large) return `${small} € / hammas`
  return `${small}–${large} € / hammas`
}

/**
 * The material step's chip grid.
 *
 * Multi-select, but only materials[0] can ever be priced: quoteJob looks
 * materialPrices up by an EXACT string, so a second material has nowhere to go
 * in the quote. Rather than hide that, the picker names the primary one and
 * says in plain Estonian what happens to the rest — a technician who picks two
 * priced materials and then sees one price would otherwise assume a bug.
 */
export function MaterialPicker({ value, onChange, invalid, describedBy }: MaterialPickerProps) {
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
    return [...value.filter(m => !recentFirst.includes(m)), ...recentFirst]
  }, [settings.materjalid, recents, value])

  const q = query.trim().toLowerCase()
  const visible = q ? options.filter(m => m.toLowerCase().includes(q)) : options

  const toggle = (material: string) => {
    if (value.includes(material)) {
      onChange(value.filter(m => m !== material))
      return
    }
    pushRecentMaterial(material)
    onChange([...value, material])
  }

  const makePrimary = (material: string) => {
    onChange([material, ...value.filter(m => m !== material)])
  }

  const addCustom = () => {
    const name = custom.trim()
    if (!name || value.includes(name)) { setCustom(''); return }
    pushRecentMaterial(name)
    onChange([...value, name])
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
        aria-labelledby="wizard-materjal-label"
        aria-describedby={describedBy}
        className={`flex flex-wrap gap-3 rounded-xl ${invalid ? 'ring-2 ring-rose-400/60 p-2 -m-2' : ''}`}
      >
        {visible.map(m => {
          const pricing = settings.materialPrices[m]
          const isPrimary = value[0] === m
          return (
            <SelectableCard
              key={m}
              selected={value.includes(m)}
              onToggle={() => toggle(m)}
              label={m}
              sublabel={priceLabel(pricing?.small ?? 0, pricing?.large ?? 0)}
              badge={isPrimary && value.length > 1 ? 'Peamine' : undefined}
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

      {/* Selected list — the only place the priced/informational split is
          spelled out, and the only way to change which material is priced. */}
      {value.length > 0 && (
        <div className="rounded-xl border border-ink-faint/30 bg-bg-sidebar p-4 space-y-2">
          <p className="text-base font-semibold text-ink-soft">Valitud materjalid</p>
          <ul className="space-y-2">
            {value.map((m, i) => (
              <li key={m} className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink font-medium">{m}</span>
                {i === 0 ? (
                  <span className="text-base font-semibold text-accent">Hinna aluseks</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => makePrimary(m)}
                    className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 text-base font-medium text-ink-soft rounded-lg hover:bg-bg-card ${FOCUS_RING}`}
                  >
                    <Star className="w-4 h-4" aria-hidden="true" />
                    Tee peamiseks
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onChange(value.filter(x => x !== m))}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 text-base font-medium text-ink-muted rounded-lg hover:bg-bg-card hover:text-rose-500 ${FOCUS_RING}`}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                  <span>Eemalda<span className="sr-only"> materjal {m}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {value.length > 1 && (
            <p className={WIZARD_HELP}>
              Hind arvutatakse ainult peamise materjali järgi. Ülejäänud materjalid
              lisatakse töö kirjeldusse.
            </p>
          )}
        </div>
      )}

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
