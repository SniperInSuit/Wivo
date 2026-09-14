/**
 * Implant teeth — which units of a job actually sit on titanium.
 *
 * A five-unit implant bridge is not five implants: two or three carry it and
 * the rest are pontics hanging between them. Until this existed the cost engine
 * bought a screw per unit, and the map had no way to say otherwise.
 *
 * The load-bearing rule in here is the fallback. Nothing marked must behave
 * EXACTLY as before, or turning this on would quietly restate every past job's
 * margin.
 */
import { describe, it, expect } from 'vitest'
import {
  implantTeeth, implantCount, toggleImplantTooth, jobHardwareUnits,
  type WorkItem,
} from './../types/job'

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: 'a', too: 'Implantaadisild', hambad: '14,15,16,17,18', ...over })

describe('implantTeeth', () => {
  it('lists what was marked', () => {
    expect(implantTeeth(item({ implantaadid: '14,18' }))).toEqual(['14', '18'])
  })

  it('is empty when nothing is marked', () => {
    expect(implantTeeth(item())).toEqual([])
  })

  // Deselecting a tooth must not leave an implant behind it — invisible on the
  // map, still counted in the costs.
  it('drops implants on teeth the item no longer has', () => {
    expect(implantTeeth(item({ hambad: '14,15', implantaadid: '14,18' }))).toEqual(['14'])
  })

  it('tolerates spaces, blanks and duplicates', () => {
    expect(implantTeeth(item({ implantaadid: ' 14 , ,14, 15 ' }))).toEqual(['14', '15'])
  })
})

describe('implantCount', () => {
  it('counts the marked ones', () => {
    expect(implantCount(item({ implantaadid: '14,18' }))).toBe(2)
  })

  // Null, not 0: "nobody said" and "no implants" must stay apart, because the
  // caller turns null into a tooth count and 0 into no hardware at all.
  it('is null when nothing is marked', () => {
    expect(implantCount(item())).toBeNull()
    expect(implantCount(item({ implantaadid: '' }))).toBeNull()
  })
})

describe('toggleImplantTooth', () => {
  it('marks and unmarks', () => {
    const i = item()
    const on = toggleImplantTooth(i, 14)
    expect(on).toBe('14')
    expect(toggleImplantTooth({ ...i, implantaadid: on }, 14)).toBeUndefined()
  })

  it('keeps the item\u2019s own tooth order, so the string reads like the map', () => {
    let v = toggleImplantTooth(item(), 18)
    v = toggleImplantTooth(item({ implantaadid: v }), 14)
    expect(v).toBe('14,18')
  })

  // Undefined rather than "": the field is absent when nothing is marked, and
  // an empty string in the jsonb would read as a deliberate answer.
  it('clears to undefined when the last one is unmarked', () => {
    expect(toggleImplantTooth(item({ implantaadid: '14' }), 14)).toBeUndefined()
  })

  it('refuses a tooth the item does not have', () => {
    expect(toggleImplantTooth(item({ hambad: '14,15' }), 26)).toBeUndefined()
  })
})

describe('jobHardwareUnits', () => {
  // THE compatibility guarantee: an unmarked job is its tooth count, to the
  // unit, so switching the cost engine over moves nothing.
  it('equals the tooth count when nothing is marked', () => {
    expect(jobHardwareUnits({ work_items: [item()], hambad: '14,15,16,17,18' })).toBe(5)
    expect(jobHardwareUnits({ work_items: [], hambad: '14,15,16' })).toBe(3)
    expect(jobHardwareUnits({ hambad: '14,15,16' })).toBe(3)
  })

  it('counts implants on the items that have them', () => {
    expect(jobHardwareUnits({ work_items: [item({ implantaadid: '14,18' })], hambad: '' })).toBe(2)
  })

  // A job can be half one thing and half another: crowns on natural teeth beside
  // a bridge on implants, and each item answers for itself.
  it('mixes marked and unmarked items', () => {
    const units = jobHardwareUnits({
      work_items: [
        item({ id: 'a', implantaadid: '14,18' }),          // 2 implants of 5 teeth
        item({ id: 'b', too: 'Kroon', hambad: '24,25' }),  // unmarked → 2 teeth
      ],
      hambad: '',
    })
    expect(units).toBe(4)
  })
})
