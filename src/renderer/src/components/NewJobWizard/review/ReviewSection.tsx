import { useId, type ReactNode } from 'react'
import { AlertCircle, Pencil } from 'lucide-react'
import type { StepId, ValidationError } from '@shared/wizard'
import { FOCUS_RING, WIZARD_HIT_MIN } from '../wizardTheme'

export interface ReviewSectionProps {
  title: string
  /** Which step "Muuda" jumps to. */
  step: StepId
  onEdit: (step: StepId) => void
  /** Blocking errors belonging to this section, rendered inline in red. */
  errors: ValidationError[]
  children: ReactNode
}

/**
 * One group on the review page: a title, its values, and the way back.
 *
 * "Muuda" is a text button with an icon, never an icon alone — a pencil glyph
 * on its own is a guess, and nine of them on one page is nine guesses. Each one
 * also carries an aria-label naming its section, because a screen reader
 * otherwise hears "Muuda" nine times with no way to tell them apart.
 */
export function ReviewSection({ title, step, onEdit, errors, children }: ReviewSectionProps) {
  const blocking = errors.filter(e => e.severity === 'error')
  const warnings = errors.filter(e => e.severity === 'warning')
  // useId, not `review-${step}-${title}`. A title like "Töö tüüp" put a SPACE in
  // the id, and aria-labelledby is a space-separated list of ID references — it
  // parsed as two tokens, neither of which existed, so all nine cards on the
  // last screen before an insert had no accessible name at all.
  const headingId = useId()

  return (
    <section
      className={`rounded-xl border bg-bg-card p-5 shadow-card ${
        blocking.length > 0 ? 'border-rose-400/70' : 'border-ink-faint/25'
      }`}
      aria-labelledby={headingId}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <h3 id={headingId} className="text-base font-semibold text-ink">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => onEdit(step)}
          aria-label={`Muuda — ${title}`}
          className={`flex items-center gap-1.5 px-3 text-base font-medium text-accent
                      rounded-lg hover:bg-accent/10 transition-colors
                      ${WIZARD_HIT_MIN} ${FOCUS_RING}`}
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
          Muuda
        </button>
      </div>

      {/* A description list, because that is what a review page is: labels and
          the values that answer them. WizardSummaryRow renders <dt>/<dd> and
          needs this parent to be announced as a list at all. */}
      <dl className="space-y-2">{children}</dl>

      {blocking.length > 0 && (
        <ul className="mt-4 space-y-1.5" role="alert">
          {blocking.map((e, i) => (
            <li key={i} className="flex items-start gap-1.5 text-base font-medium text-rose-500">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              {e.message}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {warnings.map((e, i) => (
            <li key={i} className="flex items-start gap-1.5 text-base text-amber-500">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
