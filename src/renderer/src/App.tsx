import { useState, useCallback, useMemo, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { LicenseBanner } from './components/LicenseBanner'
import { Board } from './components/Board/Board'
import { TableView } from './components/TableView/TableView'
import { Dashboard } from './components/Dashboard/Dashboard'
import { CalendarView, type CalendarMode, type CalendarScale } from './components/CalendarView/CalendarView'
import { CalendarTopControls } from './components/CalendarView/CalendarTopControls'
import { PatientsView } from './components/Patients/PatientsView'
import { OverviewView } from './components/Overview/OverviewView'
import { JobDetailPanel } from './components/JobDetail/JobDetailPanel'
import { NewJobWizard } from './components/NewJobWizard/NewJobWizard'
import { SettingsPage } from './components/SettingsPage'
import { InvoicesView } from './components/Invoices/InvoicesView'
import { CustomersView } from './components/Customers/CustomersView'
import { PayrollView } from './components/Workers/PayrollView'
import { WorkersPage } from './components/Workers/WorkersPage'
import { useJobs, useCreateJob, useUpdateJob, useDeleteJob } from './hooks/useJobs'
import { useMarkJobsPaid } from './hooks/useInvoices'
import type { PaidDetails } from './components/JobDetail/MarkPaidDialog'
import { PipelineProvider, usePipeline } from './context/PipelineContext'
import { useSettings } from './stores/useSettings'
import { AuthProvider } from './context/AuthContext'
import { AuthGuard } from './components/Auth/AuthGuard'
import { ClinicSettingsSync } from './components/ClinicSettingsSync'
import { UpdateBanner } from './components/UpdateBanner'
import type { Job, JobInput, StageKey } from './types/job'
import type { ViewMode } from './types/view'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2
    }
  }
})

function AppContent() {
  const [view, setView] = useState<ViewMode>('overview')
  // The 'new' member is now UNREACHABLE from the UI — creating a job goes
  // through NewJobWizard. The branches that test for it (handleSave, the panel
  // key, the onDelete gate) are kept for one release as an escape hatch in case
  // the wizard has to be switched off in a hurry; delete them deliberately
  // after that, not by accident.
  const [panelJob, setPanelJob] = useState<Job | null | 'new'>(null)
  const [panelRevisionId, setPanelRevisionId] = useState<string | undefined>()
  const [panelNoteId, setPanelNoteId] = useState<string | undefined>()
  const [newJobDate, setNewJobDate] = useState<string | undefined>()
  // Creating a job goes through the guided wizard; JobDetailPanel stays the
  // full management interface for jobs that already exist. The wizard is a
  // separate overlay rather than another panel mode because it owns its own
  // six-step state, its own draft and its own insert.
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardDate, setWizardDate] = useState<string | undefined>()
  const [bottomJob, setBottomJob] = useState<Job | null>(null)
  const [bottomRevisionId, setBottomRevisionId] = useState<string | undefined>()
  // One search box in the top bar, shared by the views that filter (R7) — each
  // used to own a duplicate field of its own.
  const [search, setSearch] = useState('')
  // Set when another view asks to open a patient profile (from a job or a visit).
  const [focusPatientId, setFocusPatientId] = useState<string | null>(null)
  // Calendar controls live in the TopBar, so their state is lifted here.
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('kombineeritud')
  const [calendarScale, setCalendarScale] = useState<CalendarScale>('kuu')
  const [todaySignal, setTodaySignal] = useState(0)
  const [newVisitSignal, setNewVisitSignal] = useState(0)

  const { data: jobs = [], isLoading } = useJobs()
  const { settings } = useSettings()

  // Switching the clinical half off while its view is open would leave <main>
  // empty with no error — the exact hazard types/view.ts warns about. Send the
  // user somewhere that exists instead.
  useEffect(() => {
    if (!settings.kliinilineRezhiim && view === 'patients') setView('overview')
  }, [settings.kliinilineRezhiim, view])

  // Global search filter — applied to views that display individual jobs
  const searchedJobs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(j =>
      j.patsient.toLowerCase().includes(q) ||
      (j.too ?? '').toLowerCase().includes(q) ||
      (j.hambad ?? '').toLowerCase().includes(q) ||
      (j.materjal ?? '').toLowerCase().includes(q) ||
      (j.print_id ?? '').toLowerCase().includes(q) ||
      (j.kirjeldus ?? '').toLowerCase().includes(q)
    )
  }, [jobs, search])
  const panelPosition = settings.paneeliSuund
  const { doneStageKey } = usePipeline()
  const createJob = useCreateJob()
  const updateJob = useUpdateJob()
  const deleteJob = useDeleteJob()
  const markJobsPaid = useMarkJobsPaid()

  // "Uus töö" opens the WIZARD. The job panel is closed first: both are fixed
  // full-height overlays (panel z-40/z-50, wizard z-60) and two of them stacked
  // means the user is filling a form on top of another form.
  const openNew = useCallback(() => {
    setPanelJob(null); setPanelRevisionId(undefined); setPanelNoteId(undefined); setNewJobDate(undefined)
    setWizardDate(undefined); setWizardOpen(true)
  }, [])
  const openEdit = useCallback((job: Job) => { setPanelJob(job); setPanelRevisionId(undefined); setPanelNoteId(undefined) }, [])
  const openEditWithRevision = useCallback((job: Job, revId: string) => { setPanelJob(job); setPanelRevisionId(revId); setPanelNoteId(undefined) }, [])
  // Opening a job note from the patient's Märkused panel — scrolls to and
  // highlights that note inside the job's own notes box.
  const openJobNote = useCallback((job: Job, noteId: string) => {
    setPanelJob(job); setPanelRevisionId(undefined); setPanelNoteId(noteId)
  }, [])
  const closePanel = useCallback(() => { setPanelJob(null); setNewJobDate(undefined); setPanelRevisionId(undefined); setPanelNoteId(undefined) }, [])
  // Clicking an empty slot in the calendar. The moment picked there is the
  // job's DEADLINE, which is what the wizard seeds from it.
  const openNewOnDate = useCallback((isoDatetime: string) => {
    setPanelJob(null); setPanelRevisionId(undefined); setPanelNoteId(undefined); setNewJobDate(undefined)
    setWizardDate(isoDatetime); setWizardOpen(true)
  }, [])

  const closeWizard = useCallback(() => {
    // The wizard has already cleared the unsaved-changes dialog by this point.
    setWizardOpen(false); setWizardDate(undefined)
  }, [])

  // Created → hand straight over to the existing Edit page, on the real row.
  // JobDetailPanel's `editing` initialises to `job == null`, so a non-null job
  // lands on the READ view: the user sees the finished job, not another form.
  // `live()` re-resolves it against the ['jobs'] cache, so handing over the
  // pre-refetch object is safe.
  const handleWizardCreated = useCallback((job: Job) => {
    setWizardOpen(false); setWizardDate(undefined)
    setPanelJob(job); setPanelRevisionId(undefined); setPanelNoteId(undefined); setNewJobDate(undefined)
  }, [])
  const openBottom = useCallback((job: Job) => { setBottomJob(job); setBottomRevisionId(undefined) }, [])
  const openBottomRevision = useCallback((job: Job, revisionId: string) => { setBottomJob(job); setBottomRevisionId(revisionId) }, [])
  const closeBottom = useCallback(() => { setBottomJob(null); setBottomRevisionId(undefined) }, [])

  // Jump to a patient's profile from anywhere. Closes the open panels first —
  // they are viewport-fixed overlays and would otherwise cover the page we just
  // navigated to.
  const openPatient = useCallback((patientId: string) => {
    setPanelJob(null); setPanelRevisionId(undefined); setPanelNoteId(undefined)
    setBottomJob(null); setBottomRevisionId(undefined)
    setFocusPatientId(patientId)
    setView('patients')
  }, [])

  // Moving a job into the done stage is the moment it was finished, and that
  // date is what payroll pays against — the deadline is only ever a plan.
  // Stamped once: dragging a finished job around must not keep rewriting it.
  const handleStageChange = useCallback(
    async (jobId: string, stage: StageKey) => {
      const job = jobs.find(j => j.id === jobId)
      const becomingDone = stage === doneStageKey && job?.valmis_kuupaev == null
      await updateJob.mutateAsync({
        id: jobId,
        status: stage,
        ...(becomingDone ? { valmis_kuupaev: new Date().toISOString().slice(0, 10) } : {}),
      })
    },
    [updateJob, jobs, doneStageKey]
  )

  const handleRevisionStageChange = useCallback(
    async (jobId: string, revId: string, stage: StageKey) => {
      const job = jobs.find(j => j.id === jobId)
      if (!job) return
      const today = new Date().toISOString().slice(0, 10)
      const updatedRevisions = (job.revisions ?? []).map(r =>
        r.id === revId
          ? {
              ...r,
              status: stage,
              // Stamped once, on the way into the done stage — same rule as jobs.
              ...(stage === doneStageKey && !r.valmis_kuupaev ? { valmis_kuupaev: today } : {}),
            }
          : r
      )
      await updateJob.mutateAsync({ id: jobId, revisions: updatedRevisions })
    },
    [jobs, updateJob, doneStageKey]
  )

  // Same stamp when the status is changed from inside the form rather than by
  // dragging on the board.
  const withCompletionDate = useCallback((input: JobInput): JobInput => (
    input.status === doneStageKey && !input.valmis_kuupaev
      ? { ...input, valmis_kuupaev: new Date().toISOString().slice(0, 10) }
      : input
  ), [doneStageKey])

  const handleSave = useCallback(
    async (input: JobInput) => {
      const payload = withCompletionDate(input)
      if (panelJob === 'new') {
        await createJob.mutateAsync(payload)
        closePanel() // New job: close after creation
      } else if (panelJob) {
        await updateJob.mutateAsync({ id: (panelJob as Job).id, ...payload })
        // Existing job: panel stays open, JobDetailPanel switches to read view
      }
    },
    [panelJob, createJob, updateJob, closePanel, withCompletionDate]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteJob.mutateAsync(id)
      closePanel()
    },
    [deleteJob, closePanel]
  )

  const handleBulkStatusChange = useCallback(
    async (ids: string[], status: StageKey) => {
      const stamp = status === doneStageKey ? new Date().toISOString().slice(0, 10) : null
      await Promise.all(ids.map(id => {
        const job = jobs.find(j => j.id === id)
        return updateJob.mutateAsync({
          id, status,
          ...(stamp && job?.valmis_kuupaev == null ? { valmis_kuupaev: stamp } : {}),
        })
      }))
    },
    [updateJob, jobs, doneStageKey]
  )

  const handleBottomSave = useCallback(
    async (input: JobInput) => {
      if (bottomJob) {
        await updateJob.mutateAsync({ id: bottomJob.id, ...withCompletionDate(input) })
      }
      // Panel stays open, JobDetailPanel switches to read view
    },
    [bottomJob, updateJob, withCompletionDate]
  )

  // Bulk assignment. Chunked for the same reason the reprice is: a few hundred
  // simultaneous updates is how a bulk action dies half way through.
  const handleBulkAssign = useCallback(
    async (ids: string[], patch: { assigned_to?: string | null; designed_by?: string | null }) => {
      const CHUNK = 15
      for (let i = 0; i < ids.length; i += CHUNK) {
        await Promise.all(
          ids.slice(i, i + CHUNK).map(id => updateJob.mutateAsync({ id, ...patch }))
        )
      }
    },
    [updateJob]
  )

  const handleBulkDelete = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map(id => deleteJob.mutateAsync(id)))
    },
    [deleteJob]
  )

  // Goes through useMarkJobsPaid so a payment row is written with the method —
  // a bare `makstud = true` cannot answer "in what form", which is the whole
  // point of asking.
  const handleBulkMarkPaid = useCallback(
    async (ids: string[], details: PaidDetails) => {
      await markJobsPaid.mutateAsync({
        jobs: ids.map(id => {
          const job = jobs.find(j => j.id === id)
          const amount = Number(job?.hind ?? 0) + Number(job?.disain_hind ?? 0)
            + (job?.revisions ?? []).reduce((s, r) => s + Number(r.price ?? 0), 0)
          return { id, amount, total: amount }
        }),
        ...details,
      })
    },
    [markJobsPaid, jobs]
  )

  const isPanelOpen = panelJob !== null

  // Both panels hold a job OBJECT captured at click time. Re-resolve it against
  // the live query data on every render, or a write made from inside the panel
  // (a note, a tooth, a realtime change from the other machine) is saved but the
  // panel keeps rendering the stale snapshot — which reads as "it didn't save".
  const live = (j: Job | null): Job | null => (j ? jobs.find(x => x.id === j.id) ?? j : null)

  const panelJobOrNull = panelJob === 'new' ? null : live(panelJob as Job | null)
  const bottomJobLive = live(bottomJob)

  return (
    // h-full/w-full, not h-screen/w-screen: #root already measures exactly one
    // viewport and compensates for the UI scale (styles/index.css). Viewport
    // units here would ignore that compensation and overflow when scaled up.
    <div className="flex h-full w-full overflow-hidden app-surface">
      <Sidebar view={view} onViewChange={setView} />

      {/* Every class here is load-bearing: min-w-0 stops the 1730px-wide board
          from pushing the sidebar off-screen (R1), flex flex-col preserves the
          height contract every view is written against (R2), and
          overflow-hidden is what gives these flex items a 0 minimum size (R3). */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar
          search={search}
          onSearchChange={setSearch}
          onNewJob={openNew}
          onNewVisit={() => { setView('calendar'); setNewVisitSignal(n => n + 1) }}
          onImportDone={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })}
          centerSlot={view === 'calendar' ? (
            <CalendarTopControls
              mode={calendarMode}
              onModeChange={setCalendarMode}
              scale={calendarScale}
              onScaleChange={setCalendarScale}
              onToday={() => setTodaySignal(n => n + 1)}
            />
          ) : undefined}
        />

        <LicenseBanner onOpenSettings={() => setView('settings')} />
        <main className="flex-1 overflow-hidden flex flex-col">
          {view === 'overview' && (
            <OverviewView
              jobs={searchedJobs}
              loading={isLoading}
              onJobClick={openEdit}
              onNewJob={openNew}
              onNavigate={setView}
            />
          )}
          {view === 'board' && (
            <Board
              jobs={searchedJobs}
              loading={isLoading}
              onJobClick={openEdit}
              onStageChange={handleStageChange}
              onRevisionStageChange={handleRevisionStageChange}
              onRevisionClick={openEditWithRevision}
            />
          )}
          {view === 'table' && (
            <TableView
              jobs={searchedJobs}
              onJobClick={openEdit}
              onJobEye={openBottom}
              onBulkStatusChange={handleBulkStatusChange}
              onBulkMarkPaid={handleBulkMarkPaid}
              onBulkDelete={handleBulkDelete}
              onBulkAssign={handleBulkAssign}
              search={search}
              onSearchChange={setSearch}
            />
          )}
          {view === 'calendar' && (
            <CalendarView
              jobs={searchedJobs}
              onJobClick={openBottom}
              onRevisionClick={openBottomRevision}
              onNewJobOnDate={openNewOnDate}
              onOpenPatient={openPatient}
              mode={calendarMode}
              scale={calendarScale}
              todaySignal={todaySignal}
              newVisitSignal={newVisitSignal}
            />
          )}
          {view === 'patients' && settings.kliinilineRezhiim && (
            <PatientsView
              jobs={jobs}
              onJobClick={openEdit}
              onRevisionClick={openEditWithRevision}
              onJobNoteClick={openJobNote}
              search={search}
              onSearchChange={setSearch}
              focusPatientId={focusPatientId}
              onFocusHandled={() => setFocusPatientId(null)}
            />
          )}
          {view === 'kliendid' && <CustomersView />}
          {view === 'arved' && <InvoicesView jobs={jobs} />}
          {view === 'tootasud' && <PayrollView jobs={jobs} />}
          {view === 'stats' && <Dashboard jobs={jobs} />}
          {view === 'settings' && <SettingsPage />}
          {view === 'workers' && <WorkersPage />}
        </main>
      </div>

      <AnimatePresence>
        {isPanelOpen && (
          <JobDetailPanel
            key={panelJob === 'new' ? `new-${newJobDate ?? ''}` : `${(panelJob as Job).id}-${panelRevisionId ?? ''}-${panelNoteId ?? ''}`}
            job={panelJobOrNull}
            onClose={closePanel}
            onSave={handleSave}
            onDelete={panelJob !== 'new' ? handleDelete : undefined}
            saving={createJob.isPending || updateJob.isPending}
            position={panelPosition}
            initialDate={newJobDate}
            highlightRevisionId={panelRevisionId}
            highlightNoteId={panelNoteId}
            onOpenPatient={openPatient}
          />
        )}
      </AnimatePresence>

      {/* Mounted only while open, so every "Uus töö" starts from a fresh hook
          (and re-reads any saved draft) instead of resuming whatever the last
          session left in memory. */}
      <AnimatePresence>
        {wizardOpen && (
          <NewJobWizard
            open
            initialDate={wizardDate}
            onClose={closeWizard}
            onCreated={handleWizardCreated}
          />
        )}
      </AnimatePresence>

      {bottomJobLive && (
        <JobDetailPanel
          key={`bottom-${bottomJobLive.id}-${bottomRevisionId ?? ''}`}
          job={bottomJobLive}
          onClose={closeBottom}
          onSave={handleBottomSave}
          onDelete={handleDelete}
          saving={updateJob.isPending}
          position={panelPosition}
          highlightRevisionId={bottomRevisionId}
          onOpenPatient={openPatient}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGuard>
          <PipelineProvider>
            {/* Renders nothing; pulls the clinic-owned settings down and pushes
                local edits back. Inside AuthGuard because it needs the clinic. */}
            <ClinicSettingsSync />
            <AppContent />
            {/* Corner toast when a newer version is on disk. */}
            <UpdateBanner />
          </PipelineProvider>
        </AuthGuard>
      </AuthProvider>
    </QueryClientProvider>
  )
}
