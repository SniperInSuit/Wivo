import { useState } from 'react'
import { MessageSquare, Loader2, Plus, Trash2, X, ExternalLink } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job, JobNote } from '../../types/job'
import type { Patient, PatientNote } from '../../types/patient'
import { useUpdatePatient } from '../../hooks/usePatients'
import { useSettings } from '../../stores/useSettings'
import { PanelCard } from './PanelCard'

interface NotesPanelProps {
  patient: Patient
  patientJobs: Job[]
  orderRefs: Map<string, string>
  onError: (err: unknown) => void
  onOpenJobNote?: (job: Job, noteId: string) => void
}

// One line in the merged list. Job notes are MIRRORED here, not copied: the note
// lives on the job and is only read from it, so there is a single source of truth
// and no risk of the two drifting apart.
type Entry =
  | { kind: 'patient'; note: PatientNote }
  | { kind: 'job'; note: JobNote; job: Job; ref: string }

export function NotesPanel({ patient, patientJobs, orderRefs, onError, onOpenJobNote }: NotesPanelProps) {
  const updatePatient = useUpdatePatient()
  const { settings } = useSettings()
  const [draft, setDraft] = useState('')
  // Two-step delete, per note — a note can be clinical context and there is no undo
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // `markused` only exists once sql/003_patient_teeth.sql has run — every row
  // fetched before that returns undefined, not [] (risk R18).
  const notes = patient.markused ?? []

  const entries: Entry[] = [
    ...notes.map(note => ({ kind: 'patient' as const, note })),
    ...patientJobs.flatMap(job =>
      (job.markused ?? []).map(note => ({
        kind: 'job' as const,
        note,
        job,
        ref: orderRefs.get(job.id) ?? job.too ?? 'töö'
      }))
    )
  ].sort((a, b) => (b.note.ts ?? '').localeCompare(a.note.ts ?? ''))

  const jobNoteCount = entries.filter(e => e.kind === 'job').length

  async function addNote() {
    const tekst = draft.trim()
    if (!tekst) return
    const note: PatientNote = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      autor: settings.kasutajaNimi || 'Tundmatu',
      tekst
    }
    try {
      // Notes are written straight through, independently of the profile edit
      // form — they must not participate in its dirty check.
      await updatePatient.mutateAsync({ id: patient.id, markused: [...notes, note] })
      setDraft('')
    } catch (err) {
      onError(err)
    }
  }

  async function removeNote(id: string) {
    try {
      await updatePatient.mutateAsync({ id: patient.id, markused: notes.filter(n => n.id !== id) })
      setConfirmId(null)
    } catch (err) {
      onError(err)
    }
  }

  return (
    <PanelCard
      title="MÄRKUSED"
      icon={MessageSquare}
      action={
        jobNoteCount > 0
          ? <span className="text-[11px] text-ink-muted">{jobNoteCount} tööde märkust</span>
          : undefined
      }
    >
      <div className="space-y-3">
        {entries.length === 0 && <p className="text-sm text-ink-muted">Märkusi pole.</p>}

        {entries.map(entry => {
          const n = entry.note
          const d = n.ts ? parseISO(n.ts) : null
          const isJob = entry.kind === 'job'

          return (
            <div key={`${entry.kind}:${n.id}`} className="space-y-0.5 group">
              <div className="flex items-baseline gap-2 flex-wrap">
                {isJob && (
                  // The work tag: which job this note came from. Clicking opens
                  // that job with this note highlighted.
                  <button
                    type="button"
                    onClick={() => onOpenJobNote?.(entry.job, n.id)}
                    disabled={!onOpenJobNote}
                    title={`Ava ${entry.job.too ?? 'töö'}`}
                    className="inline-flex items-center gap-1 text-[10px] font-mono font-medium bg-accent-light text-accent-dark rounded px-1.5 py-0.5 hover:bg-accent hover:text-white transition-colors disabled:hover:bg-accent-light disabled:hover:text-accent-dark"
                  >
                    {entry.ref}
                    <ExternalLink size={9} />
                  </button>
                )}
                <span className="text-xs font-semibold text-ink">{n.autor}</span>
                <span className="text-[10px] text-ink-faint">
                  {d && isValid(d) ? format(d, 'dd.MM.yy HH:mm') : '—'}
                </span>

                {/* Only patient notes are deletable here — a job note belongs to
                    its job, and deleting it from two places invites confusion. */}
                {!isJob && (
                  confirmId === n.id ? (
                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={() => removeNote(n.id)}
                        disabled={updatePatient.isPending}
                        className="text-[10px] font-semibold text-red-600 hover:underline disabled:opacity-40"
                      >
                        Kustuta
                      </button>
                      <button onClick={() => setConfirmId(null)} className="text-ink-faint hover:text-ink" title="Tühista">
                        <X size={11} />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmId(n.id)}
                      title="Kustuta märkus"
                      className="ml-auto text-ink-faint hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <Trash2 size={11} />
                    </button>
                  )
                )}
              </div>
              <p className="text-sm text-ink-soft whitespace-pre-wrap">{n.tekst}</p>
            </div>
          )
        })}
      </div>

      <div className="space-y-2 pt-1">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          placeholder="Uus märkus patsiendi kohta…"
          className="input resize-none"
        />
        <button
          onClick={addNote}
          disabled={!draft.trim() || updatePatient.isPending}
          className="btn-primary w-full justify-center disabled:opacity-40"
        >
          {updatePatient.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Lisa märkus
        </button>
        {jobNoteCount > 0 && (
          <p className="text-[10px] text-ink-faint">
            Sildiga read on tööde märkused — neid muudetakse ja kustutatakse töö kaardil.
          </p>
        )}
      </div>
    </PanelCard>
  )
}
