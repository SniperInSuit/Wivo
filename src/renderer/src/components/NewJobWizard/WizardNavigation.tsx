/**
 * Tagasi · Salvesta mustand · Jätka / Loo töö.
 *
 * One element, two layouts: a right-aligned row in the shell footer from `md`
 * up, a bar pinned to the bottom of the window below it. Pinned rather than
 * scrolled off because on a short screen the odontogram is taller than the
 * viewport, and a Continue button you have to go looking for is a Continue
 * button people stop finding.
 */
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from 'lucide-react'
import type { StepId } from '@shared/wizard'
import { FOCUS_RING, WIZARD_BTN } from './wizardTheme'

export interface WizardNavigationProps {
  step: StepId
  /** false on the first non-skipped step. */
  canGoBack: boolean
  /** false → Continue is visually disabled AND blockedReason is announced. */
  canContinue: boolean
  /** step === 6 → primary becomes "Loo töö". */
  isLastStep: boolean
  /** createJob.isPending — disables everything and spins the primary. */
  saving: boolean
  onBack: () => void
  onContinue: () => void
  onSaveDraft: () => void
  onCreate: () => void
  /** First blocking Estonian message, announced beside the primary button.
   *  The SHELL decides when there is one: it stays null until the user has
   *  pressed a blocked Continue, so a step never opens in red. */
  blockedReason?: string | null
}

export function WizardNavigation({
  step, canGoBack, canContinue, isLastStep, saving,
  onBack, onContinue, onSaveDraft, onCreate, blockedReason,
}: WizardNavigationProps): JSX.Element {
  const blocked = !canContinue

  return (
    <div
      aria-label={`Sammu ${step} juhtnupud`}
      role="group"
      className={[
        // Below md this is the sticky bar; from md it collapses back into the
        // footer flow. One element rather than two so focus order never
        // changes with the window width.
        'fixed bottom-0 inset-x-0 z-[61] border-t border-ink-faint/20 bg-bg-card px-4 py-3',
        'md:static md:border-0 md:bg-transparent md:px-0 md:py-0',
        'flex flex-col gap-2',
      ].join(' ')}
    >
      {/* Announced, not merely drawn. A greyed-out button that never says why
          is the single most common dead end in a multi-step form. */}
      <p
        aria-live="polite"
        className={`text-base font-medium text-rose-500 md:text-right ${blocked && blockedReason ? '' : 'sr-only'}`}
      >
        {blocked && blockedReason ? blockedReason : ''}
      </p>

      <div className="flex items-center gap-2 md:justify-end">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack || saving}
          className={`${WIZARD_BTN} flex items-center gap-2 text-ink-soft bg-bg-sidebar hover:bg-ink-faint/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Tagasi
        </button>

        <div className="flex-1 md:flex-none" />

        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saving}
          className={`${WIZARD_BTN} hidden sm:flex items-center gap-2 text-ink-muted hover:text-ink hover:bg-bg-sidebar disabled:opacity-40 transition-colors`}
        >
          <Save size={18} aria-hidden="true" />
          Salvesta mustand
        </button>

        {isLastStep ? (
          <button
            type="button"
            onClick={onCreate}
            aria-disabled={blocked || undefined}
            disabled={saving}
            className={[
              WIZARD_BTN,
              'flex items-center gap-2 text-white transition-colors',
              blocked
                ? 'bg-ink-faint cursor-not-allowed'
                : 'bg-accent hover:bg-accent-hover',
              FOCUS_RING,
            ].join(' ')}
          >
            {saving
              ? <Loader2 size={18} aria-hidden="true" className="animate-spin" />
              : <Check size={18} aria-hidden="true" />}
            Loo töö
          </button>
        ) : (
          <button
            type="button"
            onClick={onContinue}
            // aria-disabled, NOT the native attribute: pressing a blocked
            // Continue is how the user asks "what is missing?", and the shell
            // answers by revealing the field errors. A natively disabled button
            // swallows that click and the form just sits there.
            aria-disabled={blocked || undefined}
            disabled={saving}
            className={[
              WIZARD_BTN,
              'flex items-center gap-2 text-white transition-colors',
              blocked
                ? 'bg-ink-faint cursor-not-allowed'
                : 'bg-accent hover:bg-accent-hover',
              FOCUS_RING,
            ].join(' ')}
          >
            Jätka
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Under sm the draft button drops out of the row above so the two
          primary controls stay full size; it comes back as its own line. */}
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={saving}
        className={`${WIZARD_BTN} sm:hidden flex items-center justify-center gap-2 text-ink-muted hover:text-ink hover:bg-bg-sidebar disabled:opacity-40 transition-colors`}
      >
        <Save size={18} aria-hidden="true" />
        Salvesta mustand
      </button>
    </div>
  )
}
