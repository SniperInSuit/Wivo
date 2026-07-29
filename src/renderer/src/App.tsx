import { useState, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Board } from './components/Board/Board'
import { TableView } from './components/TableView/TableView'
import { Dashboard } from './components/Dashboard/Dashboard'
import { CalendarView } from './components/CalendarView/CalendarView'
import { PatientsView } from './components/Patients/PatientsView'
import { OverviewView } from './components/Overview/OverviewView'
import { JobDetailPanel } from './components/JobDetail/JobDetailPanel'
import { SettingsPage } from './components/SettingsPage'
import { useJobs, useCreateJob, useUpdateJob, useDeleteJob } from './hooks/useJobs'
import { PipelineProvider } from './context/PipelineContext'
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

  const { data: jobs = [], isLoading } = useJobs()
  const createJob = useCreateJob()
  const updateJob = useUpdateJob()
  const deleteJob = useDeleteJob()

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

  const handleStageChange = useCallback(
    async (jobId: string, stage: StageKey) => {
      await updateJob.mutateAsync({ id: jobId, status: stage })
    },
    [updateJob]
  )

  const handleRevisionStageChange = useCallback(
    async (jobId: string, revId: string, stage: StageKey) => {
      const job = jobs.find(j => j.id === jobId)
      if (!job) return
      const updatedRevisions = (job.revisions ?? []).map(r =>
        r.id === revId ? { ...r, status: stage } : r
      )
      await updateJob.mutateAsync({ id: jobId, revisions: updatedRevisions })
    },
    [jobs, updateJob]
  )

  const handleSave = useCallback(
    async (input: JobInput) => {
      if (panelJob === 'new') {
        await createJob.mutateAsync(input)
      } else if (panelJob) {
        await updateJob.mutateAsync({ id: (panelJob as Job).id, ...input })
      }
      closePanel()
    },
    [panelJob, createJob, updateJob, closePanel]
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
      await Promise.all(ids.map(id => updateJob.mutateAsync({ id, status })))
    },
    [updateJob]
  )

  const handleBottomSave = useCallback(
    async (input: JobInput) => {
      if (bottomJob) {
        await updateJob.mutateAsync({ id: bottomJob.id, ...input })
      }
      closeBottom()
    },
    [bottomJob, updateJob, closeBottom]
  )

  const handleBulkDelete = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map(id => deleteJob.mutateAsync(id)))
    },
    [deleteJob]
  )

  const handleBulkMarkPaid = useCallback(
    async (ids: string[]) => {
      const today = new Date().toISOString().split('T')[0]
      await Promise.all(ids.map(id => updateJob.mutateAsync({ id, makstud: true, makse_kuupaev: today })))
    },
    [updateJob]
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
    <div className="flex h-screen w-screen overflow-hidden app-surface">
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
          {view === 'stats' && <Dashboard jobs={jobs} />}
          {view === 'settings' && <SettingsPage />}
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
      <PipelineProvider>
        <AppContent />
      </PipelineProvider>
    </QueryClientProvider>
  )
}
