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
    const model = toJobInput({ ...createEmptyNewJobState(), model: true }, ctx)
    expect(model.mudel).toBe(true)
    expect(model.printed_model).toBe(true)
    const rush = toJobInput({ ...createEmptyNewJobState(), rush: true }, ctx)
    expect(rush.kiirtoo).toBe(true)
    expect(rush.mudel).toBe(false)
    expect(rush.printed_model).toBe(false)
    const plain = toJobInput(createEmptyNewJobState(), ctx)
    expect(plain.kiirtoo).toBe(false)
    expect(plain.mudel).toBe(false)
    expect(plain.printed_model).toBe(false)
  })

  it('rush and model can be on together', () => {
    const quote = { production: 0, unpriced: [] } as never
    const j = toJobInput({ ...createEmptyNewJobState(), rush: true, model: true }, { defaultStatus: 'disain', quote, types: [] })
    expect([j.kiirtoo, j.mudel, j.printed_model]).toEqual([true, true, true])
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
    const s = { ...createEmptyNewJobState(), model: true, impressionType: 'digital' as const }
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
