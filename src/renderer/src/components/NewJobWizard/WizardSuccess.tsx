/**
 * The beat between "Loo töö" and the Edit page.
 *
 * It exists so the creation is not silent: the wizard vanishing and a different
 * screen appearing does not, on its own, tell anyone the job was saved. A short
 * pause with the id on it does — and the id is the thing people write on the
 * case box.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'
import { FOCUS_RING, WIZARD_BTN } from './wizardTheme'

export interface WizardSuccessProps {
  /** The created job's id. */
  jobId: string
  /** Hands over to the Edit page. */
  onDone: () => void
}

/**
 * NO AUTO-ADVANCE.
 *
 * This screen used to hand over on a 1.2-second timer that only a successful
 * clipboard write could cancel. The id is the thing a technician copies onto
 * the case box, and it was gone before an older user had finished reading it —
 * with focus yanked off the button they were already pressing. A moving target
 * the user cannot pause is a WCAG 2.2.1 failure and precisely the wrong
 * behaviour for this audience. "Ava töö" is focused on arrival, so Enter still
 * gets you there in one keystroke; the difference is that it waits.
 */
export function WizardSuccess({ jobId, onDone }: WizardSuccessProps): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function copyId() {
    try {
      await navigator.clipboard.writeText(jobId)
      setCopied(true)
    } catch {
      // Clipboard access can be refused; the id is on screen either way.
      setCopied(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
        aria-live="polite"
        className="w-full max-w-md bg-bg-card rounded-2xl shadow-panel overflow-hidden"
      >
        <div className="h-[3px] bg-stage-varvi" />
        <div className="p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <Check className="w-7 h-7 text-emerald-500" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-ink">Töö on loodud</h2>
          <p className="mt-1 text-base text-ink-muted">Töö number on all — ava töö, kui oled valmis.</p>

          <div className="mt-5 flex items-center justify-center gap-2">
            <span className="font-mono text-base text-ink-soft bg-bg-sidebar rounded-lg px-3 py-2 break-all">
              {jobId}
            </span>
            <button
              type="button"
              onClick={copyId}
              title="Kopeeri töö ID"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-bg-sidebar transition-colors ${FOCUS_RING}`}
            >
              <Copy size={18} aria-hidden="true" />
              <span className="sr-only">Kopeeri töö ID</span>
            </button>
          </div>
          <p aria-live="polite" className="mt-1.5 text-base text-emerald-500 min-h-[20px]">
            {copied ? 'Töö ID on kopeeritud.' : ''}
          </p>

          <button
            type="button"
            autoFocus
            onClick={onDone}
            className={`${WIZARD_BTN} mt-4 w-full bg-accent hover:bg-accent-hover text-white transition-colors`}
          >
            Ava töö
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
