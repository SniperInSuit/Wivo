import { useState, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Board } from './components/Board/Board'
import { TableView } from './components/TableView/TableView'
import { Dashboard } from './components/Dashboard/Dashboard'
import { CalendarView, type CalendarMode, type CalendarScale } from './components/CalendarView/CalendarView'
import { CalendarTopControls } from './components/CalendarView/CalendarTopControls'
import { PatientsView } from './components/Patients/PatientsView'
import { OverviewView } from './components/Overview/OverviewView'
import { JobDetailPanel } from './components/JobDetail/JobDetailPanel'
import { SettingsPage } from './components/SettingsPage'
import { InvoicesView } from './components/Invoices/InvoicesView'
import { PayrollView } from './components/Workers/PayrollView'
import { WorkersPage } from './components/Workers/WorkersPage'
import { useJobs, useCreateJob, useUpdateJob, useDeleteJob } from './hooks/useJobs'
import { useMarkJobsPaid } from './hooks/useInvoices'
import type { PaidDetails } from './components/JobDetail/MarkPaidDialog'
import { PipelineProvider, usePipeline } from './context/PipelineContext'
import { AuthProvider } from './context/AuthContext'
import { AuthGuard } from './components/Auth/AuthGuard'
import { ClinicSettingsSync } from './components/ClinicSettingsSync'
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
  const [panelJob, setPanelJob] = useState<Job | null | 'new'>(null)
  const [panelRevisionId, setPanelRevisionId] = useState<string | undefined>()
  const [panelNoteId, setPanelNoteId] = useState<string | undefined>()
  const [newJobDate, setNewJobDate] = useState<string | undefined>()
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

  const { data: jobs = [], isLoading } = useJobs()
  const { doneStageKey } = usePipeline()
  const createJob = useCreateJob()
  const updateJob = useUpdateJob()
  const deleteJob = useDeleteJob()
  const markJobsPaid = useMarkJobsPaid()

  const openNew = useCallback(() => { setNewJobDate(undefined); setPanelJob('new'); setPanelRevisionId(undefined); setPanelNoteId(undefined) }, [])
  const openEdit = useCallback((job: Job) => { setPanelJob(job); setPanelRevisionId(undefined); setPanelNoteId(undefined) }, [])
  const openEditWithRevision = useCallback((job: Job, revId: string) => { setPanelJob(job); setPanelRevisionId(revId); setPanelNoteId(undefined) }, [])
  // Opening a job note from the patient's Märkused panel — scrolls to and
  // highlights that note inside the job's own notes box.
  const openJobNote = useCallback((job: Job, noteId: string) => {
    setPanelJob(job); setPanelRevisionId(undefined); setPanelNoteId(noteId)
  }, [])
  const closePanel = useCallback(() => { setPanelJob(null); setNewJobDate(undefined); setPanelRevisionId(undefined); setPanelNoteId(undefined) }, [])
  const openNewOnDate = useCallback((isoDatetime: string) => {
    setNewJobDate(isoDatetime)
    setPanelJob('new')
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
      } else if (panelJob) {
        await updateJob.mutateAsync({ id: (panelJob as Job).id, ...payload })
      }
      closePanel()
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
      closeBottom()
    },
    [bottomJob, updateJob, closeBottom, withCompletionDate]
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

        <main className="flex-1 overflow-hidden flex flex-col">
          {view === 'overview' && (
            <OverviewView
              jobs={jobs}
              loading={isLoading}
              onJobClick={openEdit}
              onNewJob={openNew}
              onNavigate={setView}
            />
          )}
          {view === 'board' && (
            <Board
              jobs={jobs}
              loading={isLoading}
              onJobClick={openEdit}
              onStageChange={handleStageChange}
              onRevisionStageChange={handleRevisionStageChange}
              onRevisionClick={openEditWithRevision}
            />
          )}
          {view === 'table' && (
            <TableView
              jobs={jobs}
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
              jobs={jobs}
              onJobClick={openBottom}
              onRevisionClick={openBottomRevision}
              onNewJobOnDate={openNewOnDate}
              onOpenPatient={openPatient}
              mode={calendarMode}
              scale={calendarScale}
              todaySignal={todaySignal}
            />
          )}
          {view === 'patients' && (
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
            initialDate={newJobDate}
            highlightRevisionId={panelRevisionId}
            highlightNoteId={panelNoteId}
            onOpenPatient={openPatient}
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
          position="bottom"
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
          </PipelineProvider>
        </AuthGuard>
      </AuthProvider>
    </QueryClientProvider>
  )
}
