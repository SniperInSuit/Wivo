import { useState, useMemo, useCallback } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { Job } from '../../types/job'
import { EMPTY_PATIENT } from '../../types/patient'
import { usePatients, useCreatePatient, useBackfillPatients } from '../../hooks/usePatients'
import { describeError } from './errors'
import { PatientProfile } from './PatientProfile'
import { PatientSearchPage } from './PatientSearchPage'

interface PatientsViewProps {
  jobs: Job[]
  onJobClick: (job: Job) => void
  onRevisionClick?: (job: Job, revisionId: string) => void
  search: string
  onSearchChange: (v: string) => void
}

/**
 * Two mutually exclusive screens, never both at once:
 *   no selection → the search page (full width, filters, results table)
 *   a selection  → that patient's workspace (full width, "Kõik patsiendid" back)
 *
 * The old side-by-side list cost ~300px of every profile for a list the user had
 * already finished using — they picked a patient, so the page belongs to them.
 */
export function PatientsView({ jobs, onJobClick, onRevisionClick, search, onSearchChange }: PatientsViewProps) {
  const { data: patients = [], isLoading, isError, error } = usePatients()
  const createPatient = useCreatePatient()
  const backfill = useBackfillPatients()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Reported up from PatientProfile so leaving mid-edit can warn rather than
  // silently throwing away a half-written ravikaart entry.
  const [profileDirty, setProfileDirty] = useState(false)

  // Every write goes through here so a rejected mutation is shown, never swallowed
  async function run(fn: () => Promise<void>) {
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(describeError(err))
    }
  }

  const selected = patients.find(p => p.id === selectedId) ?? null

  const unlinkedCount = useMemo(
    () => jobs.filter(j => !j.patient_id && j.patsient?.trim()).length,
    [jobs]
  )

  const handleNew = () => run(async () => {
    const created = await createPatient.mutateAsync({ ...EMPTY_PATIENT, nimi: 'Uus patsient' })
    setSelectedId(created.id)
  })

  const handleBackfill = () => run(async () => {
    setBackfillMsg(null)
    const res = await backfill.mutateAsync()
    setBackfillMsg(`${res.created} patsienti loodud · ${res.linked} tööd seotud`)
  })

  const goBack = useCallback(() => {
    if (profileDirty && !window.confirm('Salvestamata muudatused lähevad kaotsi. Kas jätkata?')) return
    setProfileDirty(false)
    setSelectedId(null)
  }, [profileDirty])

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="card p-6 max-w-lg text-center space-y-2">
          <ShieldAlert className="mx-auto text-orange-500" size={28} />
          <p className="font-semibold text-ink">Patsientide tabelit ei leitud</p>
          <p className="text-sm text-ink-muted">
            Käivita <code className="px-1 rounded bg-bg-sidebar">sql/001_patients.sql</code>,{' '}
            <code className="px-1 rounded bg-bg-sidebar">sql/002_patients_rls.sql</code> ja{' '}
            <code className="px-1 rounded bg-bg-sidebar">sql/003_patient_teeth.sql</code> Supabase
            SQL-redaktoris, seejärel laadi rakendus uuesti.
          </p>
          <p className="text-xs text-ink-faint">{(error as Error)?.message}</p>
        </div>
      </div>
    )
  }

  if (!selected) {
    return (
      <PatientSearchPage
        patients={patients}
        jobs={jobs}
        loading={isLoading}
        search={search}
        onSearchChange={onSearchChange}
        onSelect={setSelectedId}
        onNew={handleNew}
        creating={createPatient.isPending}
        unlinkedCount={unlinkedCount}
        onBackfill={handleBackfill}
        backfilling={backfill.isPending}
        backfillMsg={backfillMsg}
        actionError={actionError}
        onDismissError={() => setActionError(null)}
      />
    )
  }

  return (
    <PatientProfile
      // Remount on patient switch so edit mode and form state never leak from
      // one patient's card onto another's.
      key={selected.id}
      patient={selected}
      jobs={jobs}
      onJobClick={onJobClick}
      onRevisionClick={onRevisionClick}
      onBack={goBack}
      onDeleted={() => { setProfileDirty(false); setSelectedId(null) }}
      onError={err => setActionError(describeError(err))}
      onDirtyChange={setProfileDirty}
      actionError={actionError}
      onDismissError={() => setActionError(null)}
    />
  )
}
