/**
 * Which stage moves a partner may make (spec: "stages move only through
 * move_job_stage, which checks stage_transition and the partner's assigned
 * stages").
 *
 * With no rule written, a partner can only hand its own stage over to the next
 * one — the "›" button. Rules written here REPLACE that default for partners
 * (sql/071 `stage_move_allowed`). Admins only; the table's own policy says so.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Trash2, Route } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { usePipeline } from '../../context/PipelineContext'
import { useAuth } from '../../context/AuthContext'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

interface Rule { id: string; from_stage: string; to_stage: string; actor: 'owner' | 'partner' }

export function StageTransitionsSection() {
  const qc = useQueryClient()
  const { clinicId } = useAuth()
  const { stages, stageMap } = usePipeline()
  const [from, setFrom] = useState(stages[0]?.key ?? '')
  const [to, setTo] = useState(stages[1]?.key ?? '')
  const [error, setError] = useState<string | null>(null)

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ['stage_transition', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error: err } = await supabase.from('stage_transition').select('id, from_stage, to_stage, actor').eq('actor', 'partner')
      if (err) return [] // sql/070 not applied yet
      return (data ?? []) as Rule[]
    },
  })
  const label = (k: string) => stageMap[k]?.label ?? k
  const refresh = () => qc.invalidateQueries({ queryKey: ['stage_transition', clinicId] })

  async function add() {
    setError(null)
    if (!clinicId || from === to) return
    const { error: err } = await supabase.from('stage_transition').insert({ org_id: clinicId, from_stage: from, to_stage: to, actor: 'partner' })
    if (err) setError(describeError(err))
    else refresh()
  }

  async function remove(id: string) {
    const { error: err } = await supabase.from('stage_transition').delete().eq('id', id)
    if (err) setError(describeError(err))
    else refresh()
  }

  return (
    <section className="space-y-3 max-w-2xl">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
        <Route size={14} className="text-accent" aria-hidden="true" /> {t('stageRules.partnerMoves')}
      </h3>
      <p className="text-xs text-ink-muted">{rules.length === 0 ? t('stageRules.defaultRule') : t('stageRules.customRules')}</p>
      {rules.length > 0 && (
        <ul className="space-y-1">
          {rules.map(r => (
            <li key={r.id} className="flex items-center gap-2 text-sm text-ink">
              {label(r.from_stage)} <ArrowRight size={12} aria-hidden="true" /> {label(r.to_stage)}
              <button type="button" onClick={() => void remove(r.id)} aria-label={t('stageRules.remove')} className="ml-2 text-ink-muted hover:text-rose-500">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-40" value={from} onChange={e => setFrom(e.target.value)} aria-label={t('stageRules.from')}>
          {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <ArrowRight size={14} className="text-ink-muted" aria-hidden="true" />
        <select className="input w-40" value={to} onChange={e => setTo(e.target.value)} aria-label={t('stageRules.to')}>
          {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button type="button" onClick={() => void add()} disabled={from === to} className="btn-ghost text-xs border border-ink-faint/30 disabled:opacity-50">
          {t('stageRules.allow')}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}
