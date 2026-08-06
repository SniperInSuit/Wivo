/**
 * Which work type the next tooth click belongs to.
 *
 * This row is NOT optional decoration. MultiOdontogramPicker turns every tooth
 * click into a silent no-op when activeItemId is null, so a job with two tooth
 * types and nothing active looks broken — you click, nothing happens, no
 * message. Step 2 therefore always keeps exactly one chip active, and this row
 * is how the user sees which one.
 */
import { AlertCircle, Check, Link2 } from 'lucide-react'
import { FOCUS_RING, WIZARD_HIT_MIN } from '../wizardTheme'

export interface WorkTypeTab {
  /** WorkType.nimi verbatim — the key into selectedTeeth and colorMap. */
  nimi: string
  hex: string
  /** How many teeth this type currently owns. */
  count: number
  /** Draws the bridge marker; bridges also carry the consecutiveness rule. */
  isBridge: boolean
  /** Estonian blocking message for this type, or null. Shown as an icon here;
   *  the full sentence lives in the WizardErrors list under the odontogram. */
  error?: string | null
}

export interface WorkTypeTabsProps {
  tabs: WorkTypeTab[]
  activeType: string | null
  onSelect: (nimi: string) => void
  disabled?: boolean
}

/** Estonian counts the singular on 1 and the partitive on everything else. */
export const teethCountLabel = (n: number): string => (n === 1 ? '1 hammas' : `${n} hammast`)

export function WorkTypeTabs({ tabs, activeType, onSelect, disabled }: WorkTypeTabsProps) {
  if (tabs.length === 0) return null

  return (
    <div
      role="radiogroup"
      aria-label="Millisele tööle hambaid märgid"
      className="flex flex-wrap gap-2"
    >
      {tabs.map(t => {
        const active = t.nimi === activeType
        return (
          <button
            key={t.nimi}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(t.nimi)}
            className={[
              WIZARD_HIT_MIN,
              FOCUS_RING,
              'flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-base transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              // Selected state is carried by the tick, the border COLOUR, the
              // weight and the "Valitud" label — never by the tint alone. The
              // border stays border-2 in both states so the row does not reflow
              // by a pixel every time the active chip changes.
              'border-2',
              active
                ? 'border-accent bg-accent/10 font-semibold text-ink'
                : 'border-ink-faint/40 bg-bg-card font-medium text-ink-soft hover:text-ink',
            ].join(' ')}
          >
            {active && <span className="sr-only">Valitud. </span>}
            {active && <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
            <span
              // ring-ink-faint and not ring-black: a black hairline disappears
              // on the navy card of 'cloudy-navy', taking the darkest dots'
              // outlines with it.
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-ink-faint/50"
              style={{ background: t.hex }}
              aria-hidden="true"
            />
            <span>{t.nimi}</span>
            {t.isBridge && (
              <span
                className="flex items-center gap-1 rounded-md bg-bg-sidebar px-2 py-0.5 text-sm font-medium text-ink-muted"
                title="Silla hambad peavad olema järjestikused"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                Sild
              </span>
            )}
            <span className="text-base text-ink-muted">{teethCountLabel(t.count)}</span>
            {t.error && (
              <>
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
                <span className="sr-only">Puudulik: {t.error}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
