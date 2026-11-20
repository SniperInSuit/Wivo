/**
 * Settings → Stages: the clinic's workflow templates and the people each stage
 * falls back to (docs/WORKFLOW-STAGES.md §2, §8). A new procedure is a new
 * template here, with no release. Only people with Manage stages
 * (pipeline.write) can save; the database says so too.
 *
 * What a template may hold is checked first by shared/workflow
 * validateTemplate: a pay kind on two stages, a switch that is also a rule.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Trash2, Plus, GitBranch } from 'lucide-react'
import { ONLY_IF_RULES, PAY_ROLES, validateTemplate, type TemplateStage } from '@shared/workflow/workflow'
import { useAuth } from '../../context/AuthContext'
import { usePipeline } from '../../context/PipelineContext'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { usePermissions } from '../../hooks/usePermissions'
import { useWorkflowTemplates, useStageDefaults, TEMPLATES_KEY, STAGE_DEFAULTS_KEY } from '../../hooks/useWorkflowTemplates'
import {
  archiveTemplate, normaliseStages, payRoleLabel, problemText, ruleLabel, saveStageDefault, saveTemplate,
} from '../../lib/workflowTemplates'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

const blankStage = (stageKey: string): TemplateStage => ({
  stageKey, position: 0, task: null, optional: false, defaultOn: false, onlyIf: [], orderer: false, payRole: null, people: [],
})

export function WorkflowTemplatesSection() {
  const qc = useQueryClient()
  const { clinicId } = useAuth()
  const { can } = usePermissions()
  const canEdit = can('pipeline.write')
  const { stages: clinicStages, stageMap } = usePipeline()
  const { data: profiles = [] } = useClinicProfiles()
  const { data: templates = [] } = useWorkflowTemplates()
  const { data: defaults = {} } = useStageDefaults()
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<TemplateStage[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const label = (key: string) => stageMap[key]?.label ?? key
  const current = templates.find(x => x.id === selected)

  useEffect(() => {
    if (selected === null && templates.length > 0) setSelected(templates[0].id)
  }, [templates, selected])
  useEffect(() => {
    if (current) { setName(current.name); setRows(current.stages) }
    else if (selected === 'new') { setName(''); setRows([]) }
    setProblems([]); setError(null)
  }, [selected, current])

  if (templates.length === 0 && !canEdit) return null

  const patchRow = (i: number, p: Partial<TemplateStage>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...p } : x))
  const move = (i: number, d: -1 | 1) => setRows(r => {
    const j = i + d
    if (j < 0 || j >= r.length) return r
    const c = [...r]; [c[i], c[j]] = [c[j], c[i]]
    return c
  })
  const refresh = () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY })
  const unused = clinicStages.filter(s => !rows.some(r => r.stageKey === s.key))

  async function save() {
    if (!clinicId) return
    setBusy(true); setError(null)
    try {
      const result = await saveTemplate(clinicId, { id: current?.id ?? null, name, stages: rows })
      if ('problems' in result) { setProblems(result.problems.map(p => problemText(p, label))); return }
      setProblems([])
      await refresh()
      setSelected(result.id)
    } catch (e) {
      setError(describeError(e))
      await refresh()
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!current || current.isDefault) return
    setBusy(true); setError(null)
    try { await archiveTemplate(current.id); setSelected(null); await refresh() }
    catch (e) { setError(describeError(e)) }
    finally { setBusy(false) }
  }

  const live = validateTemplate(normaliseStages(rows)).map(p => problemText(p, label))

  return (
    <section className="space-y-4 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <GitBranch size={14} className="text-accent" aria-hidden="true" /> {t('workflow.templatesTitle')}
        </h3>
        <p className="text-xs text-ink-muted">{t('workflow.templatesHelp')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {templates.map(x => (
          <button key={x.id} type="button" onClick={() => setSelected(x.id)}
            className={`rounded-lg border px-3 py-1 text-xs ${selected === x.id ? 'border-accent bg-accent/10 text-ink' : 'border-ink-faint/30 text-ink-muted'}`}>
            {x.name}{x.isDefault ? ` · ${t('workflow.default')}` : ''}
          </button>
        ))}
        {canEdit && (
          <button type="button" onClick={() => setSelected('new')} className="btn-ghost text-xs border border-ink-faint/30 flex items-center gap-1">
            <Plus size={12} aria-hidden="true" /> {t('workflow.newTemplate')}
          </button>
        )}
      </div>

      {(current || selected === 'new') && (
        <div className="space-y-3">
          <input className="input max-w-sm" value={name} disabled={!canEdit || current?.isDefault === true}
            onChange={e => setName(e.target.value)} placeholder={t('workflow.templateName')} aria-label={t('workflow.templateName')} />

          <ol className="space-y-2">
            {rows.map((s, i) => (
              <li key={s.stageKey} className="rounded-lg border border-ink-faint/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{i + 1}. {label(s.stageKey)}</span>
                  {canEdit && (
                    <span className="ml-auto flex items-center gap-2 text-ink-muted">
                      <button type="button" onClick={() => move(i, -1)} aria-label={t('workflow.moveUp')} disabled={i === 0}><ArrowUp size={13} /></button>
                      <button type="button" onClick={() => move(i, 1)} aria-label={t('workflow.moveDown')} disabled={i === rows.length - 1}><ArrowDown size={13} /></button>
                      <button type="button" onClick={() => setRows(r => r.filter((_, j) => j !== i))} aria-label={t('workflow.removeStage')} className="hover:text-rose-500"><Trash2 size={13} /></button>
                    </span>
                  )}
                </div>
                <input className="input text-xs" value={s.task ?? ''} disabled={!canEdit} onChange={e => patchRow(i, { task: e.target.value })}
                  placeholder={t('workflow.taskText')} aria-label={t('workflow.taskText')} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" disabled={!canEdit || s.onlyIf.length > 0} checked={s.optional}
                      onChange={e => patchRow(i, { optional: e.target.checked, defaultOn: e.target.checked ? s.defaultOn : false })} />
                    {t('workflow.optionalSwitch')}
                  </label>
                  {s.optional && (
                    <label className="flex items-center gap-1">
                      <input type="checkbox" disabled={!canEdit} checked={s.defaultOn} onChange={e => patchRow(i, { defaultOn: e.target.checked })} />
                      {t('workflow.switchOnByDefault')}
                    </label>
                  )}
                  <label className="flex items-center gap-1">
                    <input type="checkbox" disabled={!canEdit} checked={s.orderer} onChange={e => patchRow(i, { orderer: e.target.checked })} />
                    {t('workflow.ordererDoesIt')}
                  </label>
                  <label className="flex items-center gap-1">
                    {t('workflow.payKind')}
                    <select className="input w-36 text-xs py-1" disabled={!canEdit} value={s.payRole ?? ''}
                      onChange={e => patchRow(i, { payRole: (e.target.value || null) as TemplateStage['payRole'] })}>
                      <option value="">{t('workflow.noPay')}</option>
                      {PAY_ROLES.map(r => <option key={r} value={r}>{payRoleLabel(r)}</option>)}
                    </select>
                  </label>
                </div>
                {!s.optional && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink">
                    <span className="text-ink-muted">{t('workflow.onlyWhen')}</span>
                    {ONLY_IF_RULES.map(r => (
                      <label key={r} className="flex items-center gap-1">
                        <input type="checkbox" disabled={!canEdit} checked={s.onlyIf.includes(r)}
                          onChange={e => patchRow(i, { onlyIf: e.target.checked ? [...s.onlyIf, r] : s.onlyIf.filter(x => x !== r) })} />
                        {ruleLabel(r)}
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink">
                  <span className="text-ink-muted">{t('workflow.people')}</span>
                  {profiles.map(p => (
                    <label key={p.id} className="flex items-center gap-1">
                      <input type="checkbox" disabled={!canEdit} checked={s.people.includes(p.id)}
                        onChange={e => patchRow(i, { people: e.target.checked ? [...s.people, p.id] : s.people.filter(x => x !== p.id) })} />
                      {p.full_name || t('wizard.unnamed')}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {canEdit && unused.length > 0 && (
            <select className="input w-56 text-xs" value="" aria-label={t('workflow.addStageToTemplate')}
              onChange={e => { if (e.target.value) setRows(r => [...r, blankStage(e.target.value)]) }}>
              <option value="">{t('workflow.addStageToTemplate')}</option>
              {unused.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}

          {[...new Set([...live, ...problems])].map(p => <p key={p} role="alert" className="text-sm text-rose-500">{p}</p>)}
          {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}

          {canEdit && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void save()} disabled={busy || !name.trim() || live.length > 0}
                className="btn-primary text-xs disabled:opacity-50">{t('workflow.saveTemplate')}</button>
              {current && !current.isDefault && (
                <button type="button" onClick={() => void remove()} disabled={busy} className="btn-ghost text-xs text-rose-500">{t('workflow.archiveTemplate')}</button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-ink">{t('workflow.defaultsTitle')}</h4>
        <p className="text-xs text-ink-muted">{t('workflow.defaultsHelp')}</p>
        {clinicStages.map(s => (
          <div key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink">
            <span className="w-32 font-medium">{s.label}</span>
            {profiles.map(p => {
              const on = (defaults[s.key] ?? []).includes(p.id)
              return (
                <label key={p.id} className="flex items-center gap-1">
                  <input type="checkbox" disabled={!canEdit || !clinicId} checked={on} onChange={async e => {
                    const people = e.target.checked ? [...(defaults[s.key] ?? []), p.id] : (defaults[s.key] ?? []).filter(x => x !== p.id)
                    try { await saveStageDefault(clinicId!, s.key, people); await qc.invalidateQueries({ queryKey: STAGE_DEFAULTS_KEY }) }
                    catch (err) { setError(describeError(err)) }
                  }} />
                  {p.full_name || t('wizard.unnamed')}
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
