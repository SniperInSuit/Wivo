/**
 * Picking who did a piece of work. THE implementation.
 *
 * Lived inside JobDetailPanel until revisions needed it too. Worth sharing
 * rather than copying, because this control decides who gets PAID: the pay
 * engine reads `assigned_to` and `designed_by` and nothing else. A second copy
 * that offered a slightly different list — archived staff, say — would move
 * money to the wrong person and look right while doing it.
 */
import { UserRound } from 'lucide-react'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'

export interface WorkerSelectProps {
  label: string
  value: string | null
  onChange: (v: string | null) => void
  /** Text shown for "nobody", e.g. "sama mis tööl" on a revision. */
  emptyLabel?: string
  /** The revision fullscreen editor paints itself slate-900 in every theme. */
  dark?: boolean
}

export function WorkerSelect({ label, value, onChange, emptyLabel = '—', dark }: WorkerSelectProps) {
  const { data: workers = [] } = useClinicProfiles()
  return (
    <div>
      <label className={`label flex items-center gap-1.5 ${dark ? 'text-slate-400' : ''}`}>
        <UserRound size={11} /> {label}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className={`input ${dark ? 'bg-slate-800 border-slate-600 text-slate-100 focus:border-accent' : ''}`}
      >
        <option value="">{emptyLabel}</option>
        {workers.map(w => (
          <option key={w.id} value={w.id}>{w.full_name || 'Nimeta'}</option>
        ))}
      </select>
    </div>
  )
}
