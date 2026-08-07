/**
 * The six-step tracker.
 *
 * Always SIX, always the same labels, even when step 2 is skipped for an
 * appliance. Renumbering a tracker mid-flow — "now it's 1..5, and step 3 is
 * what step 4 was a second ago" — is precisely the kind of ground shifting that
 * loses the user this product is built for. A skipped step is drawn as skipped
 * and says so in words.
 *
 * Forward steps are not clickable. Not because jumping is philosophically
 * wrong, but because step 6 quotes a price out of answers steps 1-5 have not
 * given yet, and a wrong number shown confidently is worse than a step gate.
 *
 * SHAPE: numbered circles joined by a hairline, label beneath — not a row of
 * full-width pills. The pill version made every step look like a button of
 * equal weight and had a connector element that painted nothing, so the six
 * steps read as six separate controls rather than as one path with a position
 * on it.
 */
import { Check } from 'lucide-react'
import { WIZARD_STEPS, type StepId, type StepStatus } from '@shared/wizard'
import { FOCUS_RING } from './wizardTheme'

export interface WizardProgressProps {
  current: StepId
  /** Precomputed by the shell via stepStatus(); the tracker stays dumb. */
  statuses: Record<StepId, StepStatus>
  /** Steps > maxStep are disabled and aria-disabled. */
  maxStep: StepId
  onStepClick: (step: StepId) => void
}

export function WizardProgress({
  current, statuses, maxStep, onStepClick,
}: WizardProgressProps): JSX.Element {
  const currentMeta = WIZARD_STEPS[current - 1]

  return (
    <nav aria-label="Töö loomise sammud">
      {/* ── Desktop: compact inline tracker ──────────────────────────────── */}
      <ol className="hidden md:flex items-center justify-center">
        {WIZARD_STEPS.map((meta, i) => {
          const status = statuses[meta.id]
          const isCurrent = status === 'current'
          const isDone = status === 'done'
          const isSkipped = status === 'skipped'
          const reachable = meta.id <= maxStep && !isSkipped

          return (
            <li key={meta.key} className="flex items-center min-w-0">
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                aria-disabled={!reachable || undefined}
                onClick={() => { if (reachable) onStepClick(meta.id) }}
                className={[
                  'group flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1',
                  'transition-colors duration-150',
                  !reachable ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  FOCUS_RING,
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    'text-xs font-bold transition-colors duration-150 border-2',
                    isCurrent
                      ? 'bg-stage-varvi border-stage-varvi text-white'
                      : isDone
                        ? 'border-accent text-accent bg-accent/10'
                        : isSkipped
                          ? 'border-ink-faint/40 text-ink-faint'
                          : 'border-ink-faint/50 text-ink-muted',
                    reachable && !isCurrent ? 'group-hover:border-ink-faint' : '',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : meta.id}
                </span>
                <span
                  className={[
                    'text-xs leading-tight whitespace-nowrap',
                    isCurrent
                      ? 'text-stage-varvi font-semibold'
                      : isDone
                        ? 'text-accent font-medium'
                        : 'text-ink-muted font-medium',
                  ].join(' ')}
                >
                  {meta.short}
                </span>
              </button>

              {i < WIZARD_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`h-0.5 w-4 shrink-0 rounded-full ${
                    meta.id < current ? 'bg-stage-varvi/60' : 'bg-ink-faint/30'
                  }`}
                />
              )}
            </li>
          )
        })}
      </ol>

      {/* ── Narrow: a six-segment bar ────────────────────────────────────── */}
      <div className="md:hidden flex items-center gap-1" aria-hidden="true">
        {WIZARD_STEPS.map(meta => {
          const status = statuses[meta.id]
          return (
            <span
              key={meta.key}
              className={[
                'h-1.5 flex-1 rounded-full',
                status === 'done' ? 'bg-accent'
                  : status === 'skipped' ? 'bg-ink-faint/30'
                  : status === 'current' ? 'bg-stage-varvi' : 'bg-ink-faint/25',
              ].join(' ')}
            />
          )
        })}
      </div>

      {/* Screen reader announcement */}
      <p aria-live="polite" className="sr-only">
        Samm {current}/6 · {currentMeta.short}
      </p>
    </nav>
  )
}
