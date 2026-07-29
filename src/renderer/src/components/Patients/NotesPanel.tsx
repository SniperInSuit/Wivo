import { useState } from 'react'
import { MessageSquare, Loader2, Plus, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { Patient, PatientNote } from '../../types/patient'
import { useUpdatePatient } from '../../hooks/usePatients'
import { useSettings } from '../../stores/useSettings'
import { PanelCard } from './PanelCard'

interface NotesPanelProps {
  patient: Patient
  onError: (err: unknown) => void
}

export function NotesPanel({ patient, onError }: NotesPanelProps) {
  const updatePatient = useUpdatePatient()
  const { settings } = useSettings()
  const [draft, setDraft] = useState('')
  // Two-step delete, per note — a note can be clinical context and there is no undo
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // `markused` only exists once sql/003_patient_teeth.sql has run — every row
  // fetched before that returns undefined, not [] (risk R18).
  const notes = patient.markused ?? []
  const sorted = [...notes].sort((a, b) => b.ts.localeCompare(a.ts))

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
    <PanelCard title="MÄRKUSED" icon={MessageSquare}>
      <div className="space-y-3">
        {sorted.length === 0 && <p className="text-sm text-ink-muted">Märkusi pole.</p>}
        {sorted.map(n => (
          <div key={n.id} className="space-y-0.5 group">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-ink">{n.autor}</span>
              <span className="text-[10px] text-ink-faint">
                {format(parseISO(n.ts), 'dd.MM.yy HH:mm')}
              </span>

              {confirmId === n.id ? (
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => removeNote(n.id)}
                    disabled={updatePatient.isPending}
                    className="text-[10px] font-semibold text-red-600 hover:underline disabled:opacity-40"
                  >
                    Kustuta
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-ink-faint hover:text-ink"
                    title="Tühista"
                  >
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
              )}
            </div>
            <p className="text-sm text-ink-soft whitespace-pre-wrap">{n.tekst}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 pt-1">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          placeholder="Uus märkus…"
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
      </div>
    </PanelCard>
  )
}
