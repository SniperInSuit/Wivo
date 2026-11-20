import { describe, it, expect } from 'vitest'
import { validateTemplate } from '@shared/workflow/workflow'
import { defaultsFromRows, normaliseStages, problemText, templatesFromRows } from './workflowTemplates'
import { withoutWorkflowColumns, WORKFLOW_JOB_COLUMNS } from '../hooks/useJobs'

const raw = (name: string, isDefault: boolean, stages: object[]) => ({
  id: name, name, is_default: isDefault, archived_at: null, workflow_template_stage: stages as never,
})
const rs = (key: string, position: number, extra: object = {}) => ({
  id: key, stage_key: key, position, task: null, optional: false, default_on: false, only_if: [], orderer: false, pay_role: null,
  workflow_template_stage_person: [], ...extra,
})

describe('workflow templates as Settings reads them', () => {
  it('default first, stages in order, people and rules mapped', () => {
    const out = templatesFromRows([
      raw('Zeta', false, []),
      raw('Crown', true, [rs('b', 1, { only_if: ['digital'], pay_role: 'disain', workflow_template_stage_person: [{ profile_id: 'p' }] }), rs('a', 0, { orderer: true })]),
    ])
    expect(out.map(x => x.name)).toEqual(['Crown', 'Zeta'])
    expect(out[0].stages.map(s => s.stageKey)).toEqual(['a', 'b'])
    expect(out[0].stages[1]).toMatchObject({ onlyIf: ['digital'], payRole: 'disain', people: ['p'] })
    expect(out[0].stages[0].orderer).toBe(true)
  })

  it('renumbers, trims, and keeps a switch and a rule from sharing a stage', () => {
    const base = templatesFromRows([raw('T', true, [rs('a', 5), rs('b', 9)])])[0].stages
    const out = normaliseStages([
      { ...base[0], task: '  ', optional: true, defaultOn: true, onlyIf: ['mill'], people: ['x', 'x'] },
      { ...base[1], optional: false, defaultOn: true },
    ])
    expect(out.map(s => s.position)).toEqual([0, 1])
    expect(out[0]).toMatchObject({ task: null, optional: false, defaultOn: false, people: ['x'] })
    expect(out[1].defaultOn).toBe(false)
    expect(validateTemplate(out)).toEqual([])
  })

  it('names a pay kind on two stages in words', () => {
    const base = templatesFromRows([raw('T', true, [rs('a', 0, { pay_role: 'too' }), rs('b', 1, { pay_role: 'too' })])])[0].stages
    const [p] = validateTemplate(base)
    expect(problemText(p, k => k.toUpperCase())).toMatch(/A.*B/)
  })

  it('groups the clinic\'s fall-back people by stage', () => {
    expect(defaultsFromRows([{ stage_key: 'a', profile_id: '1' }, { stage_key: 'a', profile_id: '2' }, { stage_key: 'b', profile_id: '1' }]))
      .toEqual({ a: ['1', '2'], b: ['1'] })
    expect(defaultsFromRows(null)).toEqual({})
  })
})

describe('a job on a database without the workflow columns', () => {
  it('leaves exactly the workflow columns out, keeps mudel', () => {
    const row = { patsient: 'x', mudel: true, template_id: 't', ordered_by: 'o', impression_type: 'digital', implant_count: 2, production_method: 'print', printed_model: true }
    expect(withoutWorkflowColumns(row)).toEqual({ patsient: 'x', mudel: true })
    expect(WORKFLOW_JOB_COLUMNS).toHaveLength(6)
  })
})
