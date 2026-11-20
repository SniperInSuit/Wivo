import { describe, it, expect } from 'vitest'
import { createEmptyNewJobState } from '@shared/wizard'
import { parseTeeth, teethText, withMaterial, withTeeth, withWorkType } from './phoneNewJob'

describe('phone new job state', () => {
  it('reads typed teeth: FDI numbers only, once each', () => {
    expect(parseTeeth('11, 12;13 12')).toEqual([11, 12, 13])
    expect(parseTeeth('9, 49, 19, 5x, 18')).toEqual([18])
    expect(parseTeeth('')).toEqual([])
  })

  it('changing the work clears what belonged to the old one', () => {
    let s = withWorkType(createEmptyNewJobState(), 'Kroon')
    s = withMaterial(withTeeth(s, '11,12'), 'Crown HT')
    expect(s.jobTypes).toEqual(['Kroon'])
    expect(teethText(s)).toBe('11, 12')
    expect(s.materialByType).toEqual({ Kroon: 'Crown HT' })
    const next = withWorkType(s, 'Sild')
    expect(next.selectedTeeth).toEqual({})
    expect(next.materialByType).toEqual({})
    expect(withMaterial(s, null).materialByType).toEqual({})
  })

  it('teeth and material are ignored until a work is chosen', () => {
    const s = createEmptyNewJobState()
    expect(withTeeth(s, '11')).toBe(s)
    expect(withMaterial(s, 'x')).toBe(s)
  })
})
