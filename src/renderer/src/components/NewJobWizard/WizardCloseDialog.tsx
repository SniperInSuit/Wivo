/**
 * "You have unfinished work here" — with three named choices, not two.
 *
 * A plain Jah/Ei on a half-filled form asks the user to guess what "Ei" throws
 * away. Each button here says what it does, the safe one is first and holds
 * focus, and the destructive one is last and looks destructive.
 */
import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { WIZARD_BTN } from './wizardTheme'

export interface WizardCloseDialogProps {
  /** Dismiss the dialog, keep filling the form. */
  onContinueEditing: () => void
  /** Write the draft to localStorage, then close the wizard. */
  onSaveAndClose: () => void
  /** Drop the draft and close. Destructive. */
  onDiscardAndClose: () => void
}

export function WizardCloseDialog({
  onContinueEditing, onSaveAndClose, onDiscardAndClose,
}: WizardCloseDialogProps): JSX.Element {
  // Escape resolves to the NON-destructive branch. Escape is a reflex, and a
  // reflex must never be the thing that deletes twenty minutes of typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onContinueEditing() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onContinueEditing])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Above the wizard shell (z-60) and its sticky nav bar (z-61).
      className="fixed inset-0 z-[62] bg-black/40 flex items-center justify-center p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="wizard-close-title"
        aria-describedby="wizard-close-desc"
        className="w-full max-w-md bg-bg-card rounded-2xl shadow-panel p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
            <AlertTriangle size={20} className="text-amber-500" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="wizard-close-title" className="text-lg font-semibold text-ink">
              Sul on salvestamata andmed
            </h2>
            <p id="wizard-close-desc" className="mt-1 text-base text-ink-muted">
              Kui sulged akna praegu, lähevad täidetud väljad kaotsi. Saad need
              mustandina alles hoida ja hiljem jätkata.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            onClick={onContinueEditing}
            className={`${WIZARD_BTN} w-full bg-accent hover:bg-accent-hover text-white transition-colors`}
          >
            Jätka täitmist
          </button>
          <button
            type="button"
            onClick={onSaveAndClose}
            className={`${WIZARD_BTN} w-full bg-bg-sidebar text-ink-soft hover:bg-ink-faint/20 transition-colors`}
          >
            Salvesta mustand ja sulge
          </button>
          <button
            type="button"
            onClick={onDiscardAndClose}
            className={`${WIZARD_BTN} w-full text-rose-500 hover:bg-rose-500/10 border border-rose-500/40 transition-colors`}
          >
            Kustuta ja sulge
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
