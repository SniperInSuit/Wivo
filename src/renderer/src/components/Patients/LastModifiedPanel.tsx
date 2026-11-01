import { Clock } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import type { Job } from '../../types/job'
import type { Patient } from '../../types/patient'
import { PanelCard } from './PanelCard'
import { lastModified } from './derive'
import { t } from '@/lib/i18n'

interface LastModifiedPanelProps {
  patient: Patient
  patientJobs: Job[]
}

export function LastModifiedPanel({ patient, patientJobs }: LastModifiedPanelProps) {
  const ts = lastModified(patient, patientJobs)
  const d = ts ? parseISO(ts) : null

  return (
    <PanelCard title={t('VIIMATI MUUDETUD', 'LAST MODIFIED')} icon={Clock}>
      {!ts || !d || !isValid(d) ? (
        <p className="text-sm text-ink-muted">{t('Andmed puuduvad', 'No data')}</p>
      ) : (
        <>
          <p className="text-xl font-bold text-ink">{format(d, 'dd.MM.yyyy HH:mm')}</p>
          <p className="text-[11px] text-ink-muted">{t('Allikas:', 'Source:')} {describeSource(patient, patientJobs, ts)}</p>
        </>
      )}

      {/* CHANGELOG.md:142 — the CSV import stamped updated_at with the import
          time, so for imported rows this is when the row arrived, not when the
          work happened. Say so, or the number is quietly misleading. */}
      <p className="text-[10px] text-ink-faint">
        {t('Imporditud tööde puhul on see impordi hetk, mitte tegelik töö kuupäev.', 'For imported jobs this is when the import ran, not the actual job date.')}
      </p>
    </PanelCard>
  )
}

// Which record produced the maximum. Checked most-specific first: adding a note
// also bumps patients.updated_at, and the note itself is the useful answer.
function describeSource(patient: Patient, patientJobs: Job[], ts: string): string {
  if ((patient.markused ?? []).some(n => n.ts === ts)) return t('märkus', 'note')
  if (patientJobs.some(j => (j.revisions ?? []).some(r => r.ts === ts))) return t('muudatus', 'revision')
  if (patientJobs.some(j => j.updated_at === ts)) return t('töö', 'job')
  if (patient.updated_at === ts) return t('patsient', 'patient')
  return t('teadmata', 'unknown')
}
