/**
 * The wizard's chrome: the overlay, the header, the tracker, the step frame and
 * the nav bar. Everything that is the same on all six steps lives here, so a
 * step component renders a BODY and nothing else.
 *
 * That split is what makes focus management possible at all. On every step
 * change the shell moves focus to the step heading — one place, one rule. If a
 * step rendered its own <h2> the shell would have no stable node to aim at, and
 * a keyboard user would be dropped back at the top of the document on every
 * Jätka.
 *
 * SURFACES: the chrome (header, footer) is `bg-bg-card`; the scrolling body is
 * `bg-bg-sidebar`, the app's own recessed surface. That is what gives the
 * review step's nine cards something to lift off — as one flat `bg-bg-card`
 * sheet, a `bg-bg-card` card inside it was invisible but for its hairline.
 * `bg-bg-sidebar` and not `bg-bg`: `ink` is only guaranteed legible on card and
 * sidebar surfaces, and in 'cloudy-navy' `bg-bg` is a light page behind dark
 * cards, so loose body text on it would be light-on-light.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { RotateCcw, X } from 'lucide-react'
import {
  WIZARD_STEPS, stepStatus, type StepId, type StepStatus,
} from '@shared/wizard'
import { useWorkTypes } from '@/stores/useSettings'
import type { UseNewJobWizard } from './state/useNewJobWizard'
import type { WizardStepComponent } from './types'
import { WizardProgress } from './WizardProgress'
import { WizardNavigation } from './WizardNavigation'
import { FOCUS_RING, WIZARD_BLUSH } from './wizardTheme'
import { ToothGlyph } from './jobtype/ToothGlyph'
import { StepJobType } from './steps/StepJobType'
import { StepTeeth } from './steps/StepTeeth'
import { StepMaterial } from './steps/StepMaterial'
import { StepProduction } from './steps/StepProduction'
import { StepOrder } from './steps/StepOrder'
import { StepReview } from './steps/StepReview'

// A table, not a switch. The shell must not know what step 4 is about — the
// day it does is the day step 4 cannot be reordered.
const STEP_COMPONENTS: Record<StepId, WizardStepComponent> = {
  1: StepJobType,
  2: StepTeeth,
  3: StepMaterial,
  4: StepProduction,
  5: StepOrder,
  6: StepReview,
}

interface WizardShellProps {
  wizard: UseNewJobWizard
  /** Close was requested; the container decides whether to confirm first. */
  onRequestClose: () => void
  onCreate: () => void
  saving: boolean
  /** Estonian message from a failed insert. */
  createError?: string | null
}

const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })
}

/** Everything inside the dialog that a Tab can land on. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function WizardShell({
  wizard, onRequestClose, onCreate, saving, createError,
}: WizardShellProps): JSX.Element {
  const { state, rules, patch, errors, showErrors, goToStep, goNext, goBack } = wizard
  const { types } = useWorkTypes()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [bannerOpen, setBannerOpen] = useState(wizard.restored)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const meta = WIZARD_STEPS[state.currentStep - 1]
  const Step = STEP_COMPONENTS[state.currentStep]

  const statuses = useMemo(() => {
    const out = {} as Record<StepId, StepStatus>
    for (const s of WIZARD_STEPS) out[s.id] = stepStatus(s.id, state, types)
    return out
  }, [state, types])

  // The heading is the anchor for both the eye and the screen reader. Scroll
  // first, then focus: focusing a node already at the top avoids the browser's
  // own jump, which lands a few pixels off and looks like a flicker.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    headingRef.current?.focus()
  }, [state.currentStep])

  // Bubble phase on purpose — WizardCloseDialog listens in the capture phase
  // and stops this from firing while it is open. A nested popup that owns
  // Escape (the patient combobox) stops it the same way, from its own wrapper.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      onRequestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRequestClose])

  /**
   * The focus trap `aria-modal` promises.
   *
   * The app behind the backdrop is still in the document and still focusable,
   * so without this a Tab from the last control walks out into the sidebar and
   * the board — a keyboard user ends up operating a screen they cannot see,
   * under a dialog that claims to be modal.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return
      // WizardCloseDialog renders ABOVE this panel and OUTSIDE it. While it is
      // open it owns the keyboard, and pulling focus back down into the wizard
      // would make its three buttons unreachable by Tab.
      //
      // Scoped to alertdialogs outside the panel on purpose. Step 2's
      // "Kustutada kõik N hammast?" confirmation is also a role="alertdialog",
      // but it is INSIDE the panel — treating it as an owner of the keyboard
      // switched the trap off for the rest of the step, so a Tab from the last
      // control walked out into the board behind the backdrop.
      const inDialog = (document.activeElement as HTMLElement | null)
        ?.closest('[role="alertdialog"]')
      if (inDialog && !panelRef.current.contains(inDialog)) return
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(n => n.offsetParent !== null || n === document.activeElement)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!panelRef.current.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Only once the user has ASKED what is missing. The nav bar used to print the
  // first blocking message the instant a step mounted, so the wizard opened in
  // red with "Vali vähemalt üks töö tüüp." before anyone had touched it — which
  // is exactly how a form teaches people to ignore its errors.
  const blockedReason = showErrors
    ? errors.find(e => e.severity === 'error')?.message ?? null
    : null

  return (
    <>
      <motion.div
        key="wizard-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm"
        onClick={() => { if (!saving) onRequestClose() }}
      />

      {/* inset-0 rather than any vh/vw measure: #root is under a CSS zoom and
          viewport units inside it are painted scaled — see styles/index.css. */}
      <div className="fixed inset-0 z-[60] flex justify-center p-0 md:p-6 pointer-events-none">
        <motion.div
          key="wizard-page"
          ref={panelRef}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wizard-title"
          className="pointer-events-auto w-full max-w-[1320px] h-full bg-bg-card shadow-panel rounded-none md:rounded-2xl flex flex-col overflow-hidden min-h-0"
        >
          {/* The magenta line. The wizard's one identifying mark — everything
              below it is the same white surface as the rest of the app. */}
          <div className="h-[3px] flex-shrink-0 bg-stage-varvi" aria-hidden="true" />

          <header className="flex-shrink-0 px-5 md:px-8 pt-3 pb-3 border-b border-ink-faint/20 bg-bg-card">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 flex-shrink-0">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stage-varvi"
                  style={{ background: WIZARD_BLUSH }}
                  aria-hidden="true"
                >
                  <ToothGlyph name="tooth" size={22} />
                </span>
                <h1 id="wizard-title" className="text-lg font-semibold text-ink whitespace-nowrap">
                  Lisa uus töö
                </h1>
                <span className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-400 whitespace-nowrap">
                  {state.currentStep}/6
                </span>
              </div>
              <div className="flex-1 min-w-0 hidden md:block">
                <WizardProgress
                  current={state.currentStep}
                  statuses={statuses}
                  maxStep={wizard.maxStep}
                  onStepClick={goToStep}
                />
              </div>
              <button
                type="button"
                onClick={onRequestClose}
                disabled={saving}
                title="Sulge"
                className={`flex-shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-bg-sidebar transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`}
              >
                <X size={18} aria-hidden="true" />
                <span className="sr-only">Sulge</span>
              </button>
            </div>
          </header>

          {/* pb clears the sticky nav bar, which is out of flow below md. */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto bg-bg-sidebar px-5 md:px-8 py-6 pb-44 md:pb-8">
            {bannerOpen && (
              <div className="mb-6 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px] space-y-1">
                  <p className="text-base text-ink-soft">
                    Taastasime pooleli jäänud mustandi
                    {wizard.draftSavedAt ? ` (salvestatud ${hhmm(wizard.draftSavedAt)})` : ''}.
                  </p>
                  {/* What the restore silently changed. Both of these used to
                      happen with no word said, and both change what the job is:
                      a work type vanishing from the list, and the date the user
                      clicked on the calendar being replaced by the draft's. */}
                  {wizard.droppedTypes.length > 0 && (
                    <p className="text-base font-medium text-amber-500">
                      Need töö tüübid ei ole enam saadaval ja eemaldati:{' '}
                      {wizard.droppedTypes.join(', ')}. Vali sammus 1 uued tüübid.
                    </p>
                  )}
                  {wizard.seededDeadline && (
                    <p className="text-base text-ink-soft">
                      Tähtajaks märkisime kalendrist valitud kuupäeva
                      {' '}({wizard.seededDeadline}).
                    </p>
                  )}
                </div>
                {confirmDiscard ? (
                  <>
                    <span className="text-base font-medium text-rose-500">
                      Kustutada mustand ja alustada algusest?
                    </span>
                    <button
                      type="button"
                      onClick={() => { wizard.discardDraft(); setConfirmDiscard(false); setBannerOpen(false) }}
                      className={`min-h-[44px] px-4 rounded-xl text-base font-medium text-white bg-rose-600 hover:bg-rose-700 transition-colors ${FOCUS_RING}`}
                    >
                      Jah, kustuta
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDiscard(false)}
                      className={`min-h-[44px] px-4 rounded-xl text-base font-medium text-ink-muted hover:text-ink hover:bg-bg-card transition-colors ${FOCUS_RING}`}
                    >
                      Ei
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmDiscard(true)}
                      className={`min-h-[44px] px-4 rounded-xl text-base font-medium text-ink-soft bg-bg-card border border-ink-faint/40 hover:bg-bg-sidebar transition-colors flex items-center gap-2 ${FOCUS_RING}`}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      Alusta algusest
                    </button>
                    <button
                      type="button"
                      onClick={() => setBannerOpen(false)}
                      className={`min-h-[44px] px-4 rounded-xl text-base font-medium text-ink-muted hover:text-ink hover:bg-bg-card transition-colors ${FOCUS_RING}`}
                    >
                      Jätka mustandiga
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="mb-6">
              {/* tabIndex -1: focusable by script for the step change, never in
                  the Tab order itself. */}
              <h2
                ref={headingRef}
                tabIndex={-1}
                className={`text-2xl font-semibold text-ink outline-none ${FOCUS_RING}`}
              >
                {meta.title}
              </h2>
              <p className="mt-1 text-base text-ink-muted">{meta.subtitle}</p>
            </div>

            <Step
              state={state}
              patch={patch}
              rules={rules}
              errors={errors}
              showErrors={showErrors}
              goToStep={goToStep}
            />

            {createError && (
              <p role="alert" className="mt-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base font-medium text-rose-500">
                {createError}
              </p>
            )}
          </div>

          <div className="flex-shrink-0 bg-bg-card md:px-8 md:py-4 md:border-t md:border-ink-faint/20">
            <WizardNavigation
              step={state.currentStep}
              canGoBack={state.currentStep > 1}
              canContinue={state.currentStep === 6 ? wizard.canCreate : wizard.canContinue}
              isLastStep={state.currentStep === 6}
              saving={saving}
              onBack={goBack}
              onContinue={goNext}
              onSaveDraft={wizard.saveDraft}
              onCreate={onCreate}
              blockedReason={blockedReason}
            />
          </div>
        </motion.div>
      </div>
    </>
  )
}
