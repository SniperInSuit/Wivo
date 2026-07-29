import { FileText, ShieldAlert } from 'lucide-react'
import type { Patient, PatientInput } from '../../types/patient'
import { ShadeChip } from '../ui/ShadeChip'
import { PanelCard } from './PanelCard'

interface RavikaartPanelProps {
  patient: Patient
  editing: boolean
  form: PatientInput
  onField: <K extends keyof PatientInput>(key: K, val: PatientInput[K]) => void
}

// View-first: the panel reads from `patient` and only touches `form` while the
// profile is in edit mode, so a realtime echo can never overwrite what is typed.
export function RavikaartPanel({ patient, editing, form, onField }: RavikaartPanelProps) {
  return (
    <PanelCard title="RAVIKAART" icon={FileText} sensitive>
      <div className="flex items-start gap-2 rounded-xl bg-orange-50 border border-orange-200 p-3">
        <ShieldAlert size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-orange-800">
          Ravikaardi andmed on <strong>terviseandmed</strong> (GDPR art. 9 eriliik).
          Sisesta ainult see, mis on töö tegemiseks vajalik.
        </p>
      </div>

      <Field label="Kliinilised märkused">
        {editing ? (
          <textarea
            value={form.ravikaart ?? ''}
            onChange={e => onField('ravikaart', e.target.value || null)}
            rows={6}
            placeholder="Ravi käik, tehtud tööd, tähelepanekud…"
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.ravikaart} />
        )}
      </Field>

      <Field label="Allergiad">
        {editing ? (
          <textarea
            value={form.allergiad ?? ''}
            onChange={e => onField('allergiad', e.target.value || null)}
            rows={3}
            placeholder="Teadaolevad allergiad…"
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.allergiad} />
        )}
      </Field>

      <Field label="Materjali eelistused">
        {editing ? (
          <textarea
            value={form.eelistused ?? ''}
            onChange={e => onField('eelistused', e.target.value || null)}
            rows={3}
            placeholder="Eelistatud materjalid, mida vältida…"
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.eelistused} />
        )}
      </Field>

      <Field label="Tooni eelistused">
        {editing ? (
          // Free text, not a picker: the field holds a preference list ("A2, A3
          // pigem heledam"), not a single selectable VITA code.
          <input
            value={form.varvi_eelistus ?? ''}
            onChange={e => onField('varvi_eelistus', e.target.value || null)}
            placeholder="nt A2, A3.5"
            className="input"
          />
        ) : (
          <ShadeList value={patient.varvi_eelistus} />
        )}
      </Field>

      <Field label="Hambumus">
        {editing ? (
          <textarea
            value={form.lougad ?? ''}
            onChange={e => onField('lougad', e.target.value || null)}
            rows={3}
            placeholder="Angle klass, kontaktid, oklusioon…"
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.lougad} />
        )}
      </Field>

      <Field label="Lõualiiges">
        {editing ? (
          <textarea
            value={form.lougaliiges ?? ''}
            onChange={e => onField('lougaliiges', e.target.value || null)}
            rows={3}
            placeholder="Lõualiigese kaebused, bruksism, klõpsumine…"
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.lougaliiges} />
        )}
      </Field>

      <Field label="Lisamärkused">
        {editing ? (
          <textarea
            value={form.markmed ?? ''}
            onChange={e => onField('markmed', e.target.value || null)}
            rows={3}
            placeholder="Üldised märkmed (mitte terviseandmed)"
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.markmed} />
        )}
      </Field>
    </PanelCard>
  )
}

// ─── Small presentational helpers ──────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function ReadText({ value }: { value: string | null }) {
  return <p className="text-sm text-ink-soft whitespace-pre-wrap">{value?.trim() || '—'}</p>
}

// Comma-separated VITA codes render as real swatches so the shade is readable
// at a glance; anything the VITA table does not know still gets a neutral chip.
function ShadeList({ value }: { value: string | null }) {
  const codes = (value ?? '').split(',').map(c => c.trim()).filter(Boolean)
  if (codes.length === 0) return <p className="text-sm text-ink-soft">—</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map(c => <ShadeChip key={c} shade={c} />)}
    </div>
  )
}
