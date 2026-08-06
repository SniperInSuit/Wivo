/**
 * One label/value line in the review step.
 *
 * An unfilled field renders an em-dash rather than nothing. A blank space says
 * "there is no such field"; a dash says "this field is empty" — and on the last
 * screen before a job is created, that difference is the whole point of the
 * screen.
 */
import type { ReactNode } from 'react'

export interface WizardSummaryRowProps {
  label: string
  /** Rendered as-is; pass chips (ToothBadges, ShadeChip…) or plain text. */
  value: ReactNode
  /** Shown as '—' in text-ink-faint when value is empty. */
  empty?: boolean
}

export function WizardSummaryRow({ label, value, empty }: WizardSummaryRowProps): JSX.Element {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-4 py-1.5">
      <dt className="text-base text-ink-muted sm:w-52 sm:flex-shrink-0">{label}</dt>
      <dd className={`text-base min-w-0 ${empty ? 'text-ink-faint' : 'text-ink'}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  )
}
