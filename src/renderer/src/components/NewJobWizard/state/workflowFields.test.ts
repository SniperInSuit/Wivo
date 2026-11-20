import { describe, it, expect } from 'vitest'
import { createEmptyNewJobState } from '@shared/wizard'
import { ruleHolds } from '@shared/workflow/workflow'
import { hasPrintedModel, implantsOnJob, jobFactsOf, switchesToSend, workflowJobFields } from './workflowFields'
import { toJobInput } from './toJobInput'

const item = (hambad: string, implantaadid?: string) => ({ hambad, implantaadid })

describe('the new job form and the workflow', () => {
  it('the Model priority sets mudel AND printed_model together; nothing else does', () => {
    const quote = { production: 0, unpriced: [] } as never
    const ctx = { defaultStatus: 'disain', quote, types: [] }
    const model = toJobInput({ ...createEmptyNewJobState(), priority: 'mudel' }, ctx)
    expect(model.mudel).toBe(true)
    expect(model.printed_model).toBe(true)
    for (const priority of ['standard', 'kiirtoo'] as const) {
      const j = toJobInput({ ...createEmptyNewJobState(), priority }, ctx)
      expect(j.mudel).toBe(false)
      expect(j.printed_model).toBe(false)
    }
  })

  it('carries the template and the rule fields to the row', () => {
    const s = { ...createEmptyNewJobState(), templateId: 'tpl', impressionType: 'digital' as const, productionMethod: 'mill' as const }
    expect(workflowJobFields(s, [item('11,12', '11,12')])).toEqual({
      template_id: 'tpl', impression_type: 'digital', implant_count: 2, production_method: 'mill', printed_model: false,
    })
  })

  it('counts each implant tooth once over the whole job, and only teeth the item still has', () => {
    expect(implantsOnJob([item('11,12', '11'), item('11,13', '11,13'), item('21', '99')])).toBe(2)
    expect(implantsOnJob([])).toBe(0)
  })

  it('the facts the rules read agree with what is written', () => {
    const s = { ...createEmptyNewJobState(), priority: 'mudel' as const, impressionType: 'digital' as const }
    const facts = jobFactsOf(s, [item('11,12', '11,12')])
    expect(ruleHolds('implants_gt_1', facts)).toBe(true)
    expect(ruleHolds('printed_model', facts)).toBe(hasPrintedModel(s))
    expect(ruleHolds('digital', facts)).toBe(true)
    expect(ruleHolds('conventional', facts)).toBe(false)
  })

  it('sends one explicit answer per switch of the template, defaults where not touched', () => {
    const stages = [
      { stageKey: 'a', optional: false, defaultOn: false },
      { stageKey: 'qc', optional: true, defaultOn: false },
      { stageKey: 'wax', optional: true, defaultOn: true },
    ]
    expect(switchesToSend(stages, {})).toEqual({ qc: false, wax: true })
    expect(switchesToSend(stages, { qc: true, wax: false, gone: true, a: true })).toEqual({ qc: true, wax: false })
  })
})
