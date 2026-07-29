/**
 * ToothStatusPanel — the patient's tooth chart and the only place where the
 * 4-state status is resolved.
 *
 * Precedence: an explicit row in patient_teeth ALWAYS wins over the value
 * derived from job history — the user knows the tooth was extracted after we
 * made the crown, the job rows do not. A derived 'Töödeldud' can therefore be
 * displayed as 'Puudub'; the chart's tooltip marks those overrides so the two
 * can be told apart (risk R13).
 */

import { useState, useMemo } from 'react'
import { Smile, Pencil, Save, X, Loader2 } from 'lucide-react'
import type { Job } from '../../types/job'
import type { Patient } from '../../types/patient'
import type { ManualToothStatus, ToothStatus } from '../../types/teeth'
import { ALL_FDI, STATUS_CYCLE } from '../../config/teeth'
import { usePatientTeeth, useSetToothStatus, useClearToothStatus } from '../../hooks/usePatientTeeth'
import { derivedTeeth } from './derive'
import { describeError } from './errors'
import { PanelCard } from './PanelCard'
import { ToothChart } from './ToothChart'
import { ToothLegend } from './ToothLegend'

interface ToothStatusPanelProps {
  patient: Patient
  patientJobs: Job[]
  onError: (err: unknown) => void
}

export function ToothStatusPanel({ patient, patientJobs, onError }: ToothStatusPanelProps) {
  const { data: teeth = [], isError, error } = usePatientTeeth()
  const setTooth = useSetToothStatus()
  const clearTooth = useClearToothStatus()

  // Its own toggle on purpose: this panel writes to patient_teeth, not to the
  // patient row, so it must stay out of the profile form's dirty check.
  const [editing, setEditing] = useState(false)
  // Clicks are buffered here while editing and only written on Salvesta, so
  // Tühista can throw them away. Writing on every click made the edit session
  // uncancellable — there was no way back from a mis-click.
  // undefined as a VALUE means "cleared" (falls back to the derived status);
  // a key that is absent means "untouched".
  const [draft, setDraft] = useState<Map<number, ManualToothStatus | undefined>>(new Map())
  const [saving, setSaving] = useState(false)

  // FDI numbers this patient has ever had work done on
  const derived = useMemo(() => derivedTeeth(patientJobs), [patientJobs])

  // The manual overrides. usePatientTeeth fetches the whole table (house
  // convention — no .eq() anywhere in the app), so filter by patient here.
  const saved = useMemo(
    () => new Map(teeth.filter(t => t.patient_id === patient.id).map(t => [t.fdi, t.staatus] as const)),
    [teeth, patient.id]
  )

  // What the chart shows: saved overrides with any unsaved draft edits applied.
  const manual = useMemo(() => {
    const m = new Map<number, ManualToothStatus>(saved)
    draft.forEach((v, fdi) => { if (v === undefined) m.delete(fdi); else m.set(fdi, v) })
    return m
  }, [saved, draft])

  const statuses = useMemo(
    () => Object.fromEntries(
      ALL_FDI.map(n => [n, manual.get(n) ?? (derived.has(String(n)) ? 'toodeldud' : 'terve')] as const)
    ) as Record<number, ToothStatus>,
    [manual, derived]
  )

  const manualFdi = useMemo(() => new Set(manual.keys()), [manual])

  // undefined → 'ravi' → 'puudub' → 'terve' → undefined. Landing on undefined
  // clears the override, returning the tooth to its derived state. Buffered only.
  function handleToothClick(fdi: number) {
    const current = manual.get(fdi)
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length]
    setDraft(d => {
      const copy = new Map(d)
      // Back to what is already stored → drop the entry rather than writing a no-op
      if (next === saved.get(fdi)) copy.delete(fdi)
      else copy.set(fdi, next)
      return copy
    })
  }

  const dirty = draft.size > 0

  function cancelEdits() {
    setDraft(new Map())
    setEditing(false)
  }

  async function saveEdits() {
    if (!dirty) { setEditing(false); return }
    setSaving(true)
    try {
      for (const [fdi, staatus] of draft) {
        if (staatus === undefined) {
          await clearTooth.mutateAsync({ patient_id: patient.id, fdi })
        } else {
          await setTooth.mutateAsync({ patient_id: patient.id, fdi, staatus })
        }
      }
      setDraft(new Map())
      setEditing(false)
    } catch (err) {
      // Never swallowed: an RLS denial here looks exactly like a dead chart (R17).
      // The draft is kept so nothing the user marked is lost on a failed save.
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <PanelCard
      title="HAMBASTAATUSE KAART (FDI)"
      icon={Smile}
      action={
        editing ? (
          <span className="flex items-center gap-1">
            <button
              onClick={saveEdits}
              disabled={saving}
              className="btn-ghost text-xs px-2 py-1 text-accent disabled:opacity-40"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Salvesta
            </button>
            <button onClick={cancelEdits} disabled={saving} className="btn-ghost text-xs px-2 py-1 disabled:opacity-40">
              <X size={13} />
              Tühista
            </button>
          </span>
        ) : (
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs px-2 py-1">
            <Pencil size={13} />
            Muuda seisundeid
          </button>
        )
      }
    >
      {isError && (
        <p className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2">
          {describeError(error)}
        </p>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Ülalõug</span>
          <span className="text-[10px] text-ink-faint">R = patsiendi parem pool</span>
        </div>

        <ToothChart
          statuses={statuses}
          manualFdi={manualFdi}
          editable={editing}
          onToothClick={handleToothClick}
        />

        <span className="block text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Alalõug</span>
      </div>

      {editing && (
        <p className="text-[11px] text-ink-muted">
          Klõpsa hambal: Ravi olemas → Puudub → Terve → tühista käsitsi määrang.
          {dirty && (
            <span className="font-semibold text-accent"> {draft.size} muudatust salvestamata.</span>
          )}
        </p>
      )}

      <ToothLegend statuses={statuses} />

      {manualFdi.size > 0 && (
        <p className="text-[10px] text-ink-faint">
          {manualFdi.size} hammast on käsitsi määratud — käsitsi määrang tühistab tööde ajaloost tuletatud seisundi.
        </p>
      )}
    </PanelCard>
  )
}
