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
  /** Unique key — may include §2 suffix for duplicates. */
  key?: string
  /** Display name (may include number: "Sild 2"). */
  nimi: string
  hex: string
  count: number
  isBridge: boolean
  error?: string | null
}

export interface WorkTypeTabsProps {
  tabs: WorkTypeTab[]
  activeType: string | null
  onSelect: (key: string) => void
  onDuplicate?: (key: string) => void
  onRemove?: (key: string) => void
  disabled?: boolean
}

/** Estonian counts the singular on 1 and the partitive on everything else. */
export const teethCountLabel = (n: number): string => (n === 1 ? '1 hammas' : `${n} hammast`)

export function WorkTypeTabs({ tabs, activeType, onSelect, onDuplicate, onRemove, disabled }: WorkTypeTabsProps) {
  if (tabs.length === 0) return null

  return (
    <div
      role="radiogroup"
      aria-label="Millisele tööle hambaid märgid"
      className="flex flex-wrap gap-2"
    >
      {tabs.map(t => {
        const tabKey = t.key ?? t.nimi
        const active = tabKey === activeType
        return (
          <div key={tabKey} className="flex items-center gap-0">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onSelect(tabKey)}
              className={[
                WIZARD_HIT_MIN,
                FOCUS_RING,
                'flex items-center gap-2 rounded-l-xl px-3 py-2 text-sm transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'border-2 border-r-0',
                active
                  ? 'border-accent bg-accent/10 font-semibold text-ink'
                  : 'border-ink-faint/40 bg-bg-card font-medium text-ink-soft hover:text-ink',
              ].join(' ')}
            >
              {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
              <span
                className="h-3 w-3 shrink-0 rounded-full ring-1 ring-ink-faint/50"
                style={{ background: t.hex }}
                aria-hidden="true"
              />
              <span>{t.nimi}</span>
              {t.isBridge && (
                <Link2 className="h-3 w-3 shrink-0 text-ink-muted" aria-hidden="true" />
              )}
              <span className="text-sm text-ink-muted">{teethCountLabel(t.count)}</span>
              {t.error && (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
              )}
            </button>
            {onDuplicate && (
              <button
                type="button"
                title="Lisa veel üks"
                disabled={disabled}
                onClick={() => onDuplicate(tabKey)}
                className={`text-xs font-bold px-1.5 py-2 border-2 border-r-0 transition-colors ${
                  active
                    ? 'border-accent bg-accent/5 text-accent hover:bg-accent/15'
                    : 'border-ink-faint/40 bg-bg-card text-ink-faint hover:text-ink-muted'
                }`}
              >
                +
              </button>
            )}
            {onRemove && (t.key?.includes('§') ?? false) && (
              <button
                type="button"
                title="Eemalda"
                disabled={disabled}
                onClick={() => onRemove(tabKey)}
                className={`text-xs font-bold px-1.5 py-2 border-2 border-l-0 rounded-r-xl transition-colors ${
                  active
                    ? 'border-accent bg-accent/5 text-red-400 hover:text-red-500'
                    : 'border-ink-faint/40 bg-bg-card text-ink-faint hover:text-red-400'
                }`}
              >
                ×
              </button>
            )}
            {!(onRemove && (t.key?.includes('§') ?? false)) && (
              <span className={`w-px h-6 border-r-2 rounded-r-xl ${
                active ? 'border-accent' : 'border-ink-faint/40'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
