import { useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, Plus, Trash2, X } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job, JobNote } from '../../types/job'
import { useUpdateJob } from '../../hooks/useJobs'
import { useSettings } from '../../stores/useSettings'

interface JobNotesPanelProps {
  job: Job
  // Set when the panel was opened by clicking this note on the patient profile
  highlightNoteId?: string
}

/**
 * Notes on a job — sits under Tootmise andmed in the read view.
 *
 * Writes through its own mutation rather than the panel's form save, so adding a
 * note neither closes the panel nor carries the rest of the form with it.
 * `markused` is excluded from JobInput for the same reason: a form save must not
 * overwrite notes added since the form was seeded.
 */
export function JobNotesPanel({ job, highlightNoteId }: JobNotesPanelProps) {
  const highlightRef = useRef<HTMLLIElement>(null)

  // Bring the note that was clicked on the patient profile into view
  useEffect(() => {
    if (!highlightNoteId) return
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightNoteId])

  const updateJob = useUpdateJob()
  const { settings } = useSettings()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The column only exists once sql/005_job_notes.sql has run — rows fetched
  // before that return undefined, not [].
  const notes = job.markused ?? []
  const sorted = [...notes].sort((a, b) => b.ts.localeCompare(a.ts))

  async function write(next: JobNote[], after?: () => void) {
    setError(null)
    try {
      await updateJob.mutateAsync({ id: job.id, markused: next })
      after?.()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      setError(
        e?.code === 'PGRST204' || e?.code === '42703'
          ? 'Käivita sql/005_job_notes.sql Supabase SQL-redaktoris.'
          : e?.message ?? 'Salvestamine ebaõnnestus'
      )
    }
  }

  async function addNote() {
    const tekst = draft.trim()
    if (!tekst) return
    const note: JobNote = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      autor: settings.kasutajaNimi || 'Tundmatu',
      tekst
    }
    await write([...notes, note], () => { setDraft(''); setAdding(false) })
  }

  return (
    <section className="border border-ink-faint/20 rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <MessageSquare size={12} className="text-accent" />
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">Märkused</h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="ml-auto flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
          >
            <Plus size={11} />
            Lisa märkus
          </button>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 mb-2">
          {error}
        </p>
      )}

      {sorted.length === 0 && !adding && (
        <p className="text-sm text-ink-faint">Märkusi pole.</p>
      )}

      <ul className="space-y-2">
        {sorted.map(n => {
          const d = n.ts ? parseISO(n.ts) : null
          return (
            <li
              key={n.id}
              ref={n.id === highlightNoteId ? highlightRef : undefined}
              className={`group flex items-start gap-2 rounded-lg transition-colors ${
                n.id === highlightNoteId ? 'bg-accent/10 ring-1 ring-accent/40 -mx-1.5 px-1.5 py-1' : ''
              }`}
            >
              <span className="w-1 h-1 rounded-full bg-ink-faint flex-shrink-0 mt-[7px]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-soft whitespace-pre-wrap break-words">{n.tekst}</p>
                <p className="text-[10px] text-ink-faint">
                  {n.autor}
                  {d && isValid(d) && ` · ${format(d, 'dd.MM.yy HH:mm')}`}
                </p>
              </div>
              {confirmId === n.id ? (
                <span className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                  <button
                    type="button"
                    onClick={() => write(notes.filter(x => x.id !== n.id), () => setConfirmId(null))}
                    disabled={updateJob.isPending}
                    className="text-[10px] font-semibold text-red-600 hover:underline disabled:opacity-40"
                  >
                    Kustuta
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="text-ink-faint hover:text-ink">
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(n.id)}
                  title="Kustuta märkus"
                  className="flex-shrink-0 mt-0.5 text-ink-faint hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {adding && (
        <div className="space-y-1.5 mt-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Nt kontaktpunkt distaalselt veidi kõrgem…"
            className="input resize-none text-sm"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={addNote}
              disabled={!draft.trim() || updateJob.isPending}
              className="btn-primary text-xs py-1 px-2.5 disabled:opacity-40"
            >
              {updateJob.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Lisa
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft(''); setError(null) }}
              className="btn-ghost text-xs py-1 px-2"
            >
              Tühista
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
