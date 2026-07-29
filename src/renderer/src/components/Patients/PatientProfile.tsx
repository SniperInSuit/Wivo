import { useState, useCallback, useMemo, useEffect } from 'react'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import type { Job } from '../../types/job'
import type { Patient, PatientInput } from '../../types/patient'
import { useUpdatePatient, useDeletePatient } from '../../hooks/usePatients'
import { jobsForPatient, buildOrderRefs, patientStats } from './derive'
import { PatientHeaderCard } from './PatientHeaderCard'
import { PatientStatStrip } from './PatientStatStrip'
import { RavikaartPanel } from './RavikaartPanel'
import { ToothStatusPanel } from './ToothStatusPanel'
import { JobHistoryPanel } from './JobHistoryPanel'
import { InvoicesPanel } from './InvoicesPanel'
import { NotesPanel } from './NotesPanel'
import { LastModifiedPanel } from './LastModifiedPanel'
import { VisitsPanel } from './VisitsPanel'
import { VisitForm } from '../CalendarView/VisitForm'
import type { Visit } from '../../types/visit'

interface PatientProfileProps {
  patient: Patient
  jobs: Job[]
  onJobClick: (job: Job) => void
  onRevisionClick?: (job: Job, revisionId: string) => void
  onJobNoteClick?: (job: Job, noteId: string) => void
  onDeleted: () => void
  onError: (err: unknown) => void
  // Reported upward so switching patients mid-edit can warn instead of silently
  // discarding a half-written ravikaart entry.
  onDirtyChange?: (dirty: boolean) => void
  onBack: () => void
  actionError?: string | null
  onDismissError?: () => void
}

// Fields the profile form owns. `markused` is deliberately absent: NotesPanel
// writes it through its own mutation, and it is an array — including it in the
// dirty diff would compare references and leave the form permanently dirty.
const FORM_FIELDS = [
  'nimi', 'synniaeg', 'telefon', 'email', 'arst', 'kliinik',
  'ravikaart', 'allergiad', 'eelistused', 'varvi_eelistus', 'lougad', 'lougaliiges', 'markmed'
] as const

type FormField = (typeof FORM_FIELDS)[number]

function formFromPatient(p: Patient): PatientInput {
  return {
    nimi: p.nimi,
    synniaeg: p.synniaeg,
    telefon: p.telefon,
    email: p.email,
    arst: p.arst,
    kliinik: p.kliinik,
    ravikaart: p.ravikaart,
    allergiad: p.allergiad,
    eelistused: p.eelistused,
    varvi_eelistus: p.varvi_eelistus,
    lougad: p.lougad,
    lougaliiges: p.lougaliiges,
    markmed: p.markmed,
    markused: p.markused ?? []
  }
}

/**
 * The patient page: header + stat strip + panel grid.
 *
 * View-first — nothing is editable until "Muuda". The form is seeded only when
 * edit mode opens, never on every patient update: the realtime channel echoes
 * our own writes back (usePatients subscribes to postgres_changes), and
 * re-seeding on that echo would wipe whatever the user was typing.
 */
export function PatientProfile({
  patient, jobs, onJobClick, onRevisionClick, onJobNoteClick, onDeleted, onError, onDirtyChange, onBack,
  actionError, onDismissError
}: PatientProfileProps) {
  const updatePatient = useUpdatePatient()
  const deletePatient = useDeletePatient()

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PatientInput>(() => formFromPatient(patient))
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [armedAt, setArmedAt] = useState<number | null>(null)
  // Visits are edited through the same side panel the calendar uses — one form,
  // one place the validation lives.
  const [visitForm, setVisitForm] = useState<{ visit: Visit | null } | null>(null)

  // Disarm the delete confirm after a few seconds. Without this the trash button
  // stays armed for as long as the profile is mounted, so a click now and an
  // unrelated click minutes later destroys the record — and there is no undo:
  // deleting a patient also nulls patient_id on every one of their jobs.
  useEffect(() => {
    if (!deleteConfirm) return
    const t = setTimeout(() => setDeleteConfirm(false), 5000)
    return () => clearTimeout(t)
  }, [deleteConfirm])

  const patientJobs = useMemo(() => jobsForPatient(jobs, patient), [jobs, patient])
  const orderRefs = useMemo(() => buildOrderRefs(patient, patientJobs), [patient, patientJobs])
  const stats = useMemo(() => patientStats(patientJobs), [patientJobs])

  // Only the fields this form owns; markused is written by NotesPanel and is an
  // array, so a reference compare would read permanently dirty.
  const dirty = editing && FORM_FIELDS.some(k => (form[k] ?? '') !== (patient[k] ?? ''))

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const onField = useCallback(<K extends keyof PatientInput>(key: K, val: PatientInput[K]) => {
    setForm(f => ({ ...f, [key]: val }))
  }, [])

  const handleEdit = useCallback(() => {
    setForm(formFromPatient(patient))
    setEditing(true)
    setDeleteConfirm(false)
  }, [patient])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setDeleteConfirm(false)
  }, [])

  const handleSave = useCallback(async () => {
    // Send only the owned fields — never markused, which NotesPanel may have
    // updated since this form was seeded.
    const patch = Object.fromEntries(
      FORM_FIELDS.map(k => [k, form[k as FormField]])
    ) as Partial<Patient>
    try {
      await updatePatient.mutateAsync({ id: patient.id, ...patch })
      setEditing(false)
      onDirtyChange?.(false)
    } catch (err) {
      onError(err)
    }
  }, [form, patient.id, updatePatient, onError])

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      setArmedAt(Date.now())
      return
    }
    // A physical double-click fires two separate click events, and the first has
    // already committed deleteConfirm — so without this the second click deletes.
    // Ignore anything inside the double-click window.
    if (armedAt != null && Date.now() - armedAt < 500) return
    try {
      await deletePatient.mutateAsync(patient.id)
      onDeleted()
    } catch (err) {
      onError(err)
    }
  }, [deleteConfirm, armedAt, deletePatient, patient.id, onDeleted, onError])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5 space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-accent transition-colors"
        >
          <ArrowLeft size={15} />
          Kõik patsiendid
        </button>

        {actionError && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
            <ShieldAlert size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-800 font-medium break-words flex-1">{actionError}</p>
            {onDismissError && (
              <button onClick={onDismissError} className="text-[10px] text-red-600 underline flex-shrink-0">
                Sulge
              </button>
            )}
          </div>
        )}

        {/* Identity (60%) beside the business summary (40%) — who they are, then
            what they are worth, before any working surface. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
          <div className="lg:col-span-3">
            <PatientHeaderCard
              patient={patient}
              editing={editing}
              form={form}
              onField={onField}
              onEdit={handleEdit}
              onSave={handleSave}
              onCancel={handleCancel}
              onDelete={handleDelete}
              saving={updatePatient.isPending || deletePatient.isPending}
              deleteConfirm={deleteConfirm}
            />
          </div>
          <div className="lg:col-span-2">
            <PatientStatStrip stats={stats} />
          </div>
        </div>

        {/* The three working surfaces, side by side: medical | production |
            anatomy — 30/40/30. Job history gets the widest column because that
            is where the technician actually spends their time. Dropping the
            patient list freed the width that makes this fit; below xl there is
            not enough for three, so they stack. */}
        <div className="grid grid-cols-1 xl:grid-cols-10 gap-4 items-start">
          <div className="xl:col-span-3">
            <RavikaartPanel patient={patient} editing={editing} form={form} onField={onField} />
          </div>
          <div className="xl:col-span-4">
            <JobHistoryPanel
              jobs={patientJobs}
              orderRefs={orderRefs}
              onJobClick={onJobClick}
              onRevisionClick={onRevisionClick}
            />
          </div>
          <div className="xl:col-span-3">
            <ToothStatusPanel patient={patient} patientJobs={patientJobs} onError={onError} />
          </div>
        </div>

        {/* Bottom row 50 / 25 / 25 */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          <div className="lg:col-span-2">
            <NotesPanel
              patient={patient}
              patientJobs={patientJobs}
              orderRefs={orderRefs}
              onError={onError}
              onOpenJobNote={onJobNoteClick}
            />
          </div>
          <InvoicesPanel stats={stats} />
          <LastModifiedPanel patient={patient} patientJobs={patientJobs} />
        </div>
      </div>

      <AnimatePresence>
        {visitForm && (
          <VisitForm
            key={visitForm.visit?.id ?? 'new'}
            visit={visitForm.visit}
            // A new visit from the profile is pre-filled with this patient, so the
            // link is never left dangling.
            prefillPatient={visitForm.visit ? undefined : { id: patient.id, nimi: patient.nimi, arst: patient.arst }}
            onClose={() => setVisitForm(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
