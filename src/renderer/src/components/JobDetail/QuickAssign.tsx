import { useState } from 'react'
import { Users } from 'lucide-react'
import { stagesOf, type StagePeople } from '@/lib/stageAssign'
import { t } from '@/lib/i18n'

/**
 * Quick assignment: choose a person, tick every stage they do, apply. The
 * caller decides what applying means (the new-job form keeps it in its state,
 * a job's stages call the database).
 */
export function QuickAssign({ stages, everyone, label, busy = false, onApply }: {
  stages: readonly (StagePeople & { label: string; skipped?: boolean })[]
  everyone: { id: string; name: string }[]
  label?: (key: string) => string
  busy?: boolean
  onApply: (person: string, ticked: string[]) => void
}) {
  const [person, setPerson] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const choose = (id: string) => { setPerson(id); setTicked(id ? stagesOf(stages, id) : []) }
  const shown = stages.filter(s => !s.skipped)
  return (
    <div className="space-y-2 rounded-lg bg-bg-sidebar p-2 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <Users size={12} aria-hidden="true" /> {t('workflow.quickAssign')}
      </p>
      <select className="input w-full" value={person} onChange={e => choose(e.target.value)} aria-label={t('workflow.quickAssignPerson')}>
        <option value="">{t('workflow.quickAssignChoose')}</option>
        {everyone.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {person && (
        <>
          <div className="space-y-1">
            {shown.map(s => (
              <label key={s.stageKey} className="flex min-h-[32px] items-center gap-2 text-ink">
                <input type="checkbox" className="h-4 w-4" checked={ticked.includes(s.stageKey)}
                  onChange={e => setTicked(x => e.target.checked ? [...x, s.stageKey] : x.filter(k => k !== s.stageKey))} />
                {label ? label(s.stageKey) : s.label}
              </label>
            ))}
          </div>
          <button type="button" disabled={busy} className="btn-ghost border border-ink-faint/30 text-xs"
            onClick={() => onApply(person, ticked)}>
            {t('workflow.quickAssignApply')}
          </button>
        </>
      )}
    </div>
  )
}
