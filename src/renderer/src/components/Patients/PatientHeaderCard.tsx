import { Cake, Loader2, Mail, Pencil, Phone, Save, Stethoscope, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { differenceInYears, format, isValid, parseISO } from 'date-fns'
import type { Patient, PatientInput } from '../../types/patient'
import { CONSENT_LABEL } from '../../types/patient'
import { patientInitials } from './derive'

interface PatientHeaderCardProps {
  patient: Patient
  editing: boolean
  form: PatientInput
  onField: <K extends keyof PatientInput>(key: K, val: PatientInput[K]) => void
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  saving?: boolean
  deleteConfirm: boolean
}

// View-first identity card. It deliberately owns NO state: `editing`, `form` and
// `deleteConfirm` all live in PatientProfile, because the ravikaart panel edits
// the same form object and the two must never drift apart.
export function PatientHeaderCard({
  patient, editing, form, onField, onEdit, onSave, onCancel, onDelete, saving, deleteConfirm
}: PatientHeaderCardProps) {
  // Imported rows can carry a junk sünniaeg, so parseISO alone is not enough —
  // an Invalid Date would render "NaN.NaN.NaN (NaN a)".
  const dob = patient.synniaeg ? parseISO(patient.synniaeg) : null
  const birth = dob && isValid(dob)
    ? `${format(dob, 'dd.MM.yyyy')} (${differenceInYears(new Date(), dob)} a)`
    : null

  const referrer = [patient.arst, patient.kliinik].filter(Boolean).join(' · ') || null

  return (
    <section className="card p-5">
      <div className="flex items-start gap-4">
        {/* Initials, not a photo — there is no attachment storage in the app yet */}
        <div className="w-14 h-14 rounded-full bg-accent-light text-accent-dark flex items-center justify-center font-bold text-lg flex-shrink-0">
          {patientInitials(patient.nimi)}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="label">Nimi</label>
                <input
                  value={form.nimi}
                  onChange={e => onField('nimi', e.target.value)}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sünniaeg" icon={Cake}>
                  <input
                    type="date"
                    value={form.synniaeg ?? ''}
                    onChange={e => onField('synniaeg', e.target.value || null)}
                    className="input"
                  />
                </Field>
                <Field label="Telefon" icon={Phone}>
                  <input
                    value={form.telefon ?? ''}
                    onChange={e => onField('telefon', e.target.value || null)}
                    placeholder="+372…"
                    className="input"
                  />
                </Field>
                <Field label="E-post" icon={Mail}>
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={e => onField('email', e.target.value || null)}
                    className="input"
                  />
                </Field>
                <Field label="Saatev arst" icon={Stethoscope}>
                  <input
                    value={form.arst ?? ''}
                    onChange={e => onField('arst', e.target.value || null)}
                    className="input"
                  />
                </Field>
                <Field label="Kliinik">
                  <input
                    value={form.kliinik ?? ''}
                    onChange={e => onField('kliinik', e.target.value || null)}
                    className="input"
                  />
                </Field>
                {/* Beside the contact details, because that is what it governs.
                    The address was given for treatment; using it for marketing
                    is a separate purpose and needs its own answer. */}
                <Field label="Turundusnõusolek" icon={Mail}>
                  <select
                    value={form.turundusnousolek ?? 'kysimata'}
                    onChange={e => {
                      const v = e.target.value as Patient['turundusnousolek']
                      onField('turundusnousolek', v)
                      // Stamped on every change, including a withdrawal:
                      // "when did they say no" is asked as often as the other.
                      onField('nousoleku_aeg', v === 'kysimata' ? null : new Date().toISOString())
                    }}
                    className="input"
                  >
                    {(['kysimata', 'jah', 'ei'] as const).map(k => (
                      <option key={k} value={k}>{CONSENT_LABEL[k]}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-ink truncate">{patient.nimi}</h2>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                <Meta icon={Cake} value={birth} />
                <Meta icon={Phone} value={patient.telefon} />
                <Meta icon={Mail} value={patient.email} />
                <Meta icon={Stethoscope} value={referrer} />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {editing ? (
            <>
              <button
                onClick={onSave}
                disabled={saving || !form.nimi.trim()}
                className="btn-primary disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Salvesta
              </button>
              <button onClick={onCancel} disabled={saving} className="btn-ghost disabled:opacity-40">
                <X size={14} />
                Tühista
              </button>
            </>
          ) : (
            <button onClick={onEdit} className="btn-ghost">
              <Pencil size={14} />
              Muuda
            </button>
          )}
          {/* Two-step delete: the parent flips deleteConfirm on the first click
              and performs the delete on the second, so this stays stateless */}
          <button
            onClick={onDelete}
            title="Kustuta patsient"
            className={`btn-ghost ${deleteConfirm ? 'text-red-600 bg-red-50' : 'hover:text-red-600'}`}
          >
            <Trash2 size={14} />
            {deleteConfirm ? 'Kinnita' : ''}
          </button>
        </div>
      </div>
    </section>
  )
}

// Read-mode value. An em dash keeps the row height stable when a field is empty,
// which matters because the header is the first thing on the page.
function Meta({ icon: Icon, value }: { icon: LucideIcon; value: string | null }) {
  return (
    <span className="flex items-center gap-1.5 text-xs min-w-0">
      <Icon size={12} className="text-ink-faint flex-shrink-0" />
      <span className={`truncate ${value ? 'text-ink-soft' : 'text-ink-faint'}`}>{value ?? '—'}</span>
    </span>
  )
}

function Field({ label, icon: Icon, children }: {
  label: string
  icon?: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="label flex items-center gap-1">
        {Icon && <Icon size={11} className="text-ink-faint" />}
        {label}
      </label>
      {children}
    </div>
  )
}
