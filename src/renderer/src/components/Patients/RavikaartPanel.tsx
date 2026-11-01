import { FileText, ShieldAlert } from 'lucide-react'
import type { Patient, PatientInput } from '../../types/patient'
import { ShadeChip } from '../ui/ShadeChip'
import { PanelCard } from './PanelCard'
import { t } from '@/lib/i18n'

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
    <PanelCard title={t('RAVIKAART', 'TREATMENT RECORD')} icon={FileText} sensitive>
      <div className="flex items-start gap-2 rounded-xl bg-orange-50 border border-orange-200 p-3">
        <ShieldAlert size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-orange-800">
          {t('Ravikaardi andmed on', 'Treatment record data is')} <strong>{t('terviseandmed', 'health data')}</strong>{' '}
          {t('(GDPR art. 9 eriliik). Sisesta ainult see, mis on töö tegemiseks vajalik.', '(GDPR Art. 9 special category). Enter only what the work requires.')}
        </p>
      </div>

      <Field label={t('Kliinilised märkused', 'Clinical notes')}>
        {editing ? (
          <textarea
            value={form.ravikaart ?? ''}
            onChange={e => onField('ravikaart', e.target.value || null)}
            rows={6}
            placeholder={t('Ravi käik, tehtud tööd, tähelepanekud…', 'Course of treatment, work done, observations…')}
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.ravikaart} />
        )}
      </Field>

      <Field label={t('Allergiad', 'Allergies')}>
        {editing ? (
          <textarea
            value={form.allergiad ?? ''}
            onChange={e => onField('allergiad', e.target.value || null)}
            rows={3}
            placeholder={t('Teadaolevad allergiad…', 'Known allergies…')}
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.allergiad} />
        )}
      </Field>

      <Field label={t('Materjali eelistused', 'Material preferences')}>
        {editing ? (
          <textarea
            value={form.eelistused ?? ''}
            onChange={e => onField('eelistused', e.target.value || null)}
            rows={3}
            placeholder={t('Eelistatud materjalid, mida vältida…', 'Preferred materials, what to avoid…')}
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.eelistused} />
        )}
      </Field>

      <Field label={t('Tooni eelistused', 'Shade preferences')}>
        {editing ? (
          // Free text, not a picker: the field holds a preference list ("A2, A3
          // pigem heledam"), not a single selectable VITA code.
          <input
            value={form.varvi_eelistus ?? ''}
            onChange={e => onField('varvi_eelistus', e.target.value || null)}
            placeholder={t('nt A2, A3.5', 'e.g. A2, A3.5')}
            className="input"
          />
        ) : (
          <ShadeList value={patient.varvi_eelistus} />
        )}
      </Field>

      <Field label={t('Hambumus', 'Bite')}>
        {editing ? (
          <textarea
            value={form.lougad ?? ''}
            onChange={e => onField('lougad', e.target.value || null)}
            rows={3}
            placeholder={t('Angle klass, kontaktid, oklusioon…', 'Angle class, contacts, occlusion…')}
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.lougad} />
        )}
      </Field>

      <Field label={t('Lõualiiges', 'Jaw joint (TMJ)')}>
        {editing ? (
          <textarea
            value={form.lougaliiges ?? ''}
            onChange={e => onField('lougaliiges', e.target.value || null)}
            rows={3}
            placeholder={t('Lõualiigese kaebused, bruksism, klõpsumine…', 'TMJ complaints, bruxism, clicking…')}
            className="input resize-none"
          />
        ) : (
          <ReadText value={patient.lougaliiges} />
        )}
      </Field>

      <Field label={t('Lisamärkused', 'Additional notes')}>
        {editing ? (
          <textarea
            value={form.markmed ?? ''}
            onChange={e => onField('markmed', e.target.value || null)}
            rows={3}
            placeholder={t('Üldised märkmed (mitte terviseandmed)', 'General notes (not health data)')}
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
