import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Loader2, Save, Trash2, UserRound, X } from 'lucide-react'
import { format } from 'date-fns'
import type { Visit, VisitInput, VisitStatus } from '../../types/visit'
import { EMPTY_VISIT, VISIT_STATUS_LABEL, VISIT_STATUS_HEX } from '../../types/visit'
import { useCreateVisit, useUpdateVisit, useDeleteVisit } from '../../hooks/useVisits'
import { PatientPicker } from '../Patients/PatientPicker'
import { usePatients } from '../../hooks/usePatients'
import { useSettings, useVisitTypes } from '../../stores/useSettings'
import { describeError } from '../Patients/errors'
import { toDate, toLocalInput, fromLocalInput } from '../../lib/dates'

interface VisitFormProps {
  visit: Visit | null      // null = create
  initialDate?: Date       // pre-fill the day when creating from a calendar cell
  initialDuration?: number // pre-fill duration from drag-select (minutes)
  onClose: () => void
  // Jumps to the patient's profile. Only offered when the visit is linked to a
  // patient record — a free-typed name has no profile to open.
  onOpenPatient?: (patientId: string) => void
  // Creating a visit from a patient's profile — seed the link so it can never be
  // saved against the wrong person or left unlinked.
  prefillPatient?: { id: string; nimi: string; arst: string | null }
  /**
   * Seeding a visit from an appointment REQUEST. The person who asked is not
   * a patient record yet — very often not a patient at all — so the name is
   * free text and the note carries what they wrote.
   */
  prefillRequest?: { nimi: string; markus: string }
  /**
   * Fires with the visit that was just CREATED. The request inbox uses it to
   * link the two rows: without the id coming back, a confirmed request could
   * not point at the visit it became.
   */
  onCreated?: (visitId: string) => void
}

// datetime-local wants "YYYY-MM-DDTHH:mm" with no timezone suffix

export function VisitForm({ visit, initialDate, initialDuration, onClose, onOpenPatient, prefillPatient, prefillRequest, onCreated }: VisitFormProps) {
  const createVisit = useCreateVisit()
  const updateVisit = useUpdateVisit()
  const deleteVisit = useDeleteVisit()
  const { data: patients = [] } = usePatients()
  const { settings } = useSettings()
  const vt = useVisitTypes()

  const [form, setForm] = useState<VisitInput>(() =>
    visit
      ? {
          patient_id: visit.patient_id,
          patsient: visit.patsient,
          arst: visit.arst,
          tyyp: visit.tyyp ?? null,
          algus: toLocalInput(visit.algus),
          kestus_min: visit.kestus_min,
          markus: visit.markus,
          staatus: visit.staatus
        }
      : {
          ...EMPTY_VISIT,
          kestus_min: initialDuration ?? settings.visiidiKestus,
          patient_id: prefillPatient?.id ?? null,
          patsient: prefillPatient?.nimi ?? prefillRequest?.nimi ?? '',
          arst: prefillPatient?.arst ?? null,
          markus: prefillRequest?.markus ?? null,
          algus: format(initialDate ?? new Date(), "yyyy-MM-dd'T'09:00")
        }
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof VisitInput>(k: K, v: VisitInput[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  // Picking a linked patient fills the referring doctor from their record, since
  // that is where it is maintained — but it stays editable per visit.
  function pickPatient(nimi: string, patientId: string | null) {
    const p = patientId ? patients.find(x => x.id === patientId) : undefined
    setForm(f => ({
      ...f,
      patsient: nimi,
      patient_id: patientId,
      arst: p?.arst?.trim() || f.arst
    }))
  }

  const saving = createVisit.isPending || updateVisit.isPending || deleteVisit.isPending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const payload: VisitInput = {
      ...form,
      patsient: form.patsient.trim(),
      arst: form.arst?.trim() || null,
      markus: form.markus?.trim() || null,
      // Clearing the datetime field left '' here, and new Date('').toISOString()
      // throws "Invalid time value" outside the try below — an uncaught crash
      // rather than the save error it should have been.
      algus: fromLocalInput(form.algus) ?? ''
    }
    if (!payload.algus) {
      setError('Visiidi algusaeg on puudu või vigane.')
      return
    }
    try {
      if (visit) await updateVisit.mutateAsync({ id: visit.id, ...payload })
      else {
        const created = await createVisit.mutateAsync(payload)
        // Before onClose: the caller unmounts this form, and a callback fired
        // afterwards would run against a component that is already gone.
        if (created?.id) onCreated?.(created.id)
      }
      onClose()
    } catch (err) {
      setError(describeError(err))
    }
  }

  async function remove() {
    if (!visit) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setError(null)
    try {
      await deleteVisit.mutateAsync(visit.id)
      onClose()
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Side panel, not a centred modal: a centred box could run off-screen at
          smaller window sizes, and this matches how jobs already open. */}
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 w-[440px] max-w-dialog bg-bg-card shadow-panel z-50 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ink-faint/20 flex-shrink-0">
          <h2 className="text-base font-semibold text-ink">{visit ? 'Muuda visiiti' : 'Uus visiit'}</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-2">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <PatientPicker
              name={form.patsient}
              patientId={form.patient_id}
              onChange={pickPatient}
              required
            />
            {form.patient_id && onOpenPatient ? (
              <button
                type="button"
                onClick={() => onOpenPatient(form.patient_id!)}
                className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                <UserRound size={11} />
                Ava patsiendi profiil
                <ArrowUpRight size={11} />
              </button>
            ) : form.patsient.trim() ? (
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Vali nimekirjast patsient, et profiili avada.
              </p>
            ) : null}
          </div>

          {/* Visit type — why they are coming. Optional on purpose: a front
              desk booking someone in a hurry must not be blocked by a picklist,
              and an untyped visit simply draws grey. */}
          {vt.types.length > 0 && (
            <div>
              <label className="label">Visiidi tüüp</label>
              <div className="flex flex-wrap gap-1.5">
                {vt.types.map(t => {
                  const active = form.tyyp === t.nimi
                  return (
                    <button
                      key={t.nimi}
                      type="button"
                      onClick={() => set('tyyp', active ? null : t.nimi)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border-2 transition-all ${
                        active ? 'border-current' : 'border-transparent bg-bg-sidebar text-ink-muted hover:border-ink-faint/40'
                      }`}
                      style={active ? { color: t.hex, backgroundColor: `${t.hex}1f` } : undefined}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: t.hex }}
                      />
                      {t.nimi}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <label className="label">Suunav arst</label>
            <input
              value={form.arst ?? ''}
              onChange={e => set('arst', e.target.value || null)}
              placeholder="Dr. …"
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Algus</label>
              <input
                type="datetime-local"
                value={form.algus}
                onChange={e => set('algus', e.target.value)}
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">Kestus (min)</label>
              <input
                type="number"
                min={5}
                max={600}
                step={settings.ajaSamm}
                value={form.kestus_min}
                onChange={e => set('kestus_min', parseInt(e.target.value) || 30)}
                required
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Staatus</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(VISIT_STATUS_LABEL) as VisitStatus[]).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => set('staatus', st)}
                  style={form.staatus === st
                    ? {
                        backgroundColor: `${VISIT_STATUS_HEX[st]}1f`,
                        borderColor: VISIT_STATUS_HEX[st],
                        color: VISIT_STATUS_HEX[st]
                      }
                    : undefined}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                    form.staatus === st
                      ? ''
                      : 'bg-bg-sidebar border-transparent text-ink-muted hover:border-ink-faint/40'
                  }`}
                >
                  {VISIT_STATUS_LABEL[st]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Märkus</label>
            <textarea
              value={form.markus ?? ''}
              onChange={e => set('markus', e.target.value || null)}
              rows={2}
              placeholder="Nt proovimine, üleandmine…"
              className="input resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-1 pb-1">
            {visit ? (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className={`btn-ghost ${confirmDelete ? 'text-red-600 bg-red-50' : 'hover:text-red-600'}`}
              >
                <Trash2 size={14} />
                {confirmDelete ? 'Kinnita' : 'Kustuta'}
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost">Tühista</button>
              <button
                type="submit"
                disabled={saving || !form.patsient.trim() || !form.algus}
                className="btn-primary disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {visit ? 'Salvesta' : 'Loo visiit'}
              </button>
            </div>
          </div>
        </form>
      </motion.aside>
    </>
  )
}
