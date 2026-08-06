/**
 * Search box for the long pick-lists (work types, materials).
 *
 * The result count is announced rather than only drawn: filtering a grid down
 * to nothing is silent otherwise, and "I typed and the screen went blank" is
 * the moment people give up on a form.
 */
import { Search, X } from 'lucide-react'
import { FOCUS_RING, WIZARD_INPUT, WIZARD_HIT_MIN } from '../wizardTheme'

export interface WizardSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** aria-label when no visible label sits above it. */
  ariaLabel: string
  /** Announced result count, e.g. '7 vastet'. */
  resultLabel?: string
}

export function WizardSearch({
  value, onChange, placeholder, ariaLabel, resultLabel,
}: WizardSearchProps): JSX.Element {
  return (
    <div>
      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
        />
        <input
          type="search"
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${WIZARD_INPUT} pl-11 ${value ? 'pr-12' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Tühjenda otsing"
            className={`absolute right-1 top-1/2 -translate-y-1/2 ${WIZARD_HIT_MIN} flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-bg-sidebar transition-colors ${FOCUS_RING}`}
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only">Tühjenda otsing</span>
          </button>
        )}
      </div>
      {resultLabel && (
        <p aria-live="polite" className="mt-1.5 text-base text-ink-muted">
          {resultLabel}
        </p>
      )}
    </div>
  )
}
