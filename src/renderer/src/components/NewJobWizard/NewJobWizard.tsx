/**
 * "Lisa uus töö" — the guided six-step alternative to the full Edit page.
 *
 * This file is the only thing App.tsx imports, and it is the only place in the
 * wizard that talks to the database. Everything above it is pure state and
 * pure rules; everything below it is presentation. The wizard owns its own
 * insert rather than handing a JobInput back up to App because App's existing
 * save path is shared with the Edit panel, and a second caller with different
 * post-save behaviour ("close" vs "open the job we just made") is how that
 * handler grows a mode flag.
 *
 * The hand-off is deliberate: create → show the id → onCreated(job) → App
 * closes the wizard and opens JobDetailPanel on the real row. The Edit page
 * initialises to its READ view for a non-null job, so the user lands on the
 * finished job rather than back in another form.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { quoteJob } from '@shared/pricing/quote'
import { todayISO, type NewJobStateInit } from '@shared/wizard'
import type { Job, StageKey } from '@/types/job'
import { priceBookOf, useSettings, useWorkTypes } from '@/stores/useSettings'
import { usePipeline } from '@/context/PipelineContext'
import { useCreateJob } from '@/hooks/useJobs'
import { useNewJobWizard } from './state/useNewJobWizard'
import { wizardQuoteInput } from './state/workItems'
import { toJobInput } from './state/toJobInput'
import { WizardShell } from './WizardShell'
import { WizardSuccess } from './WizardSuccess'
import { WizardCloseDialog } from './WizardCloseDialog'

export interface NewJobWizardProps {
  /** App renders <AnimatePresence>{open && <NewJobWizard …/>}</AnimatePresence>. */
  open: boolean
  /** 'YYYY-MM-DDTHH:mm' local datetime from CalendarView. Undefined from the
   *  TopBar button. */
  initialDate?: string
  /** Close request that already passed the unsaved-changes dialog. */
  onClose: () => void
  /** Fired after a successful insert, with the full Job (id included). */
  onCreated: (job: Job) => void
}

export function NewJobWizard({
  open, initialDate, onClose, onCreated,
}: NewJobWizardProps): JSX.Element | null {
  const { settings } = useSettings()
  const { types } = useWorkTypes()
  const { stages } = usePipeline()
  const createJob = useCreateJob()

  // The calendar hands over a moment in time, and what the user picked on the
  // calendar is a DEADLINE, not the day the case arrived — kuupaev stays today.
  //
  // Except when the clicked day is in the PAST. Every cell in the month grid
  // calls onNewJobOnDate, past ones included, and validateStep(4) refuses a
  // deadline earlier than the received date. Seeding kuupaev from the clicked
  // day in that case is the only reading that makes sense — a job being entered
  // against last Tuesday arrived on or before last Tuesday — and it stops the
  // wizard opening blocked on step 4 by a value the user never typed.
  const init = useMemo<NewJobStateInit>(() => {
    const [deadline, time] = (initialDate ?? '').split('T')
    const backdated = Boolean(deadline) && deadline < todayISO()
    return {
      deadline: deadline || undefined,
      time: time ? time.slice(0, 5) : undefined,
      date: backdated ? deadline : undefined,
      machine: settings.defaultMachine || null,
    }
    // Only the values the wizard is SEEDED with. Re-running this on a settings
    // change would reset a machine the user had already picked by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate])

  const wizard = useNewJobWizard(init)

  const [created, setCreated] = useState<Job | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [askClose, setAskClose] = useState(false)

  // ONE quote, built by the same function StepReview uses. Two builders would
  // eventually disagree, and the number the user approved would not be the
  // number written to the row.
  const quote = useMemo(
    () => quoteJob(wizardQuoteInput(wizard.state, types), priceBookOf(settings)),
    [wizard.state, types, settings]
  )

  // A SYNCHRONOUS latch. `disabled={createJob.isPending}` on the button is not
  // one: mutateAsync awaits the mutation cache before it dispatches 'pending',
  // so the disable lands a microtask later and a held Enter or a double click
  // gets two inserts through. The table has no unique constraint to catch the
  // duplicate afterwards.
  const inFlight = useRef(false)

  const handleCreate = useCallback(async () => {
    if (inFlight.current) return
    if (!wizard.canCreate) {
      // Pressing a blocked primary is the user asking what is missing. goNext()
      // is what flips showErrors on; at step 6 it cannot move anywhere, so this
      // only reveals the errors.
      wizard.goNext()
      return
    }
    inFlight.current = true
    setCreateError(null)
    wizard.patch({ status: 'creating' })
    try {
      const job = await createJob.mutateAsync(
        toJobInput(wizard.state, {
          defaultStatus: (stages[0]?.key ?? 'disain') as StageKey,
          quote,
          types,
        })
      )
      wizard.patch({ status: 'created' })
      // The draft has served its purpose. Leaving it behind means the next
      // "Lisa uus töö" reopens the job that was just created.
      wizard.discardDraft()
      setCreated(job)
    } catch (e) {
      wizard.patch({ status: 'draft' })
      setCreateError(
        `Töö loomine ebaõnnestus. ${e instanceof Error && e.message ? e.message : 'Proovi uuesti.'}`
      )
    } finally {
      inFlight.current = false
    }
  }, [wizard, createJob, stages, quote, types])

  const requestClose = useCallback(() => {
    // Refused while the insert is in flight. Closing here unmounts this
    // component (App renders it conditionally) while the insert continues: the
    // row lands, `setCreated` fires on nothing, `onCreated` never runs, and the
    // user is left believing they cancelled a job that in fact exists. Worse,
    // "Salvesta mustand ja sulge" would leave a draft that recreates it.
    if (createJob.isPending) return
    if (wizard.isDirty) setAskClose(true)
    else onClose()
  }, [createJob.isPending, wizard.isDirty, onClose])

  // After every hook, so the hook order never depends on `open`.
  if (!open) return null

  if (created) {
    return <WizardSuccess jobId={created.id} onDone={() => onCreated(created)} />
  }

  return (
    <>
      <WizardShell
        wizard={wizard}
        onRequestClose={requestClose}
        onCreate={handleCreate}
        saving={createJob.isPending}
        createError={createError}
      />

      <AnimatePresence>
        {askClose && (
          <WizardCloseDialog
            onContinueEditing={() => setAskClose(false)}
            onSaveAndClose={() => { wizard.saveDraft(); setAskClose(false); onClose() }}
            onDiscardAndClose={() => { wizard.discardDraft(); setAskClose(false); onClose() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
