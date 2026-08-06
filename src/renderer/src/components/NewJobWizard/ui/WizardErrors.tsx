/**
 * A block of validation messages.
 *
 * Errors and warnings are told apart by icon AND wording AND live-region role,
 * never by red-versus-amber alone. The split of role matters: an `alert` is
 * interrupting and is right for something that blocks the user, while a
 * `status` is polite and is right for "kiirtöö doubles the price" — which is
 * information, not a wall.
 */
import { AlertCircle, AlertTriangle } from 'lucide-react'
import type { ValidationError } from '@shared/wizard'

export interface WizardErrorsProps {
  errors: ValidationError[]
  /** Filtered to severity==='error' when false. Default true = show both. */
  includeWarnings?: boolean
}

export function WizardErrors({
  errors, includeWarnings = true,
}: WizardErrorsProps): JSX.Element | null {
  const shown = includeWarnings ? errors : errors.filter(e => e.severity === 'error')
  if (shown.length === 0) return null

  const blocking = shown.filter(e => e.severity === 'error')
  const warnings = shown.filter(e => e.severity === 'warning')

  return (
    <div className="space-y-2">
      {blocking.length > 0 && (
        <ul
          role="alert"
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 space-y-1.5"
        >
          {blocking.map((e, i) => (
            <li key={`e${i}`} className="flex items-start gap-2 text-base font-medium text-rose-500">
              <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul
          role="status"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-1.5"
        >
          {warnings.map((e, i) => (
            <li key={`w${i}`} className="flex items-start gap-2 text-base font-medium text-amber-500">
              <AlertTriangle size={16} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
