/**
 * Unit counts per work type.
 *
 * The case that matters is the mixed job: every existing breakdown on the
 * dashboard reads `job.too` and `job.hambad`, so a case holding crowns AND a
 * bridge files all of its teeth under the crown. The totals still add up, which
 * is exactly why nobody noticed.
 */
import { describe, it, expect } from 'vitest'
import type { Job, WorkItem, Revision } from '../types/job'
import { unitsByType } from './unitsByType'

let seq = 0
const item = (too: string, hambad: string): WorkItem =>
  ({ id: `i${++seq}`, too, hambad })

function job(over: Partial<Job> = {}): Job {
  return {
    id: `j${++seq}`, status: 'valmis', kuupaev: '2026-08-01', patsient: 'Mari',
    patient_id: null, customer_id: null, customer_ref: null,
    too: null, materjal: null, masina: null, print_id: null, disain_id: null,
    extra_costs: [], varv: null, hambad: null, kirjeldus: null,
    valmis_aeg: null, valmis_kuupaev: '2026-08-10', kiirtoo: false,
    delivery_status: 'labor', delivered_at: null,
    work_items: [], revisions: [], markused: [], extras: [],
    hind: null, disain_hind: null, makstud: false, makse_kuupaev: null,
    assigned_to: null, designed_by: null,
    created_at: '2026-08-01', updated_at: '2026-08-01',
    ...over,
  }
}

/** Identity classification, so the tests read as the raw type names. */
const label = (too: string | null | undefined): string => too?.trim() || 'Määramata'

const row = (got: ReturnType<typeof unitsByType>, name: string) =>
  got.rows.find(r => r.name === name)

describe('unitsByType', () => {
  it('counts teeth per work ITEM, not per job', () => {
    // The bug this exists for: at the job level this is five crowns.
    const got = unitsByType([job({
      too: 'Kroon', hambad: '11,12,14,15,16',
      work_items: [item('Kroon', '11,12'), item('Sild', '14,15,16')],
    })], label)
    expect(row(got, 'Kroon')!.teeth).toBe(2)
    expect(row(got, 'Sild')!.teeth).toBe(3)
  })

  it('counts a bridge as ONE item and several teeth', () => {
    const got = unitsByType([job({ work_items: [item('Sild', '14,15,16,17')] })], label)
    expect(row(got, 'Sild')).toMatchObject({ teeth: 4, items: 1, jobs: 1 })
  })

  it('falls back to the denormalised fields for a legacy row', () => {
    // Rows written before work_items existed have no items at all, and they
    // are most of the history. Dropping them would halve the answer.
    const got = unitsByType([job({ too: 'Kroon', hambad: '11,12,13', work_items: [] })], label)
    expect(row(got, 'Kroon')).toMatchObject({ teeth: 3, items: 1 })
  })

  it('counts a job once per type even with several items of it', () => {
    const got = unitsByType([job({
      work_items: [item('Kroon', '11'), item('Kroon', '21'), item('Sild', '34,35')],
    })], label)
    expect(row(got, 'Kroon')).toMatchObject({ teeth: 2, items: 2, jobs: 1 })
    expect(row(got, 'Sild')!.jobs).toBe(1)
  })

  it('sorts by teeth, so the most-made type is first', () => {
    const got = unitsByType([
      job({ work_items: [item('Kroon', '11')] }),
      job({ work_items: [item('Proteez', '11,12,13,14,15,16')] }),
    ], label)
    expect(got.rows.map(r => r.name)).toEqual(['Proteez', 'Kroon'])
  })

  it('REFUSES to count a tooth twice when two items claim it', () => {
    // A data error. What must not happen is the remake landing on both.
    const got = unitsByType([job({
      work_items: [item('Kroon', '11'), item('Sild', '11')],
      revisions: [{ id: 'r', ts: '2026-08-05', note: '', hambad: '11' } as Revision],
    })], label)
    expect(row(got, 'Kroon')!.redone + (row(got, 'Sild')?.redone ?? 0)).toBe(1)
    expect(got.unplacedRedone).toBe(0)
  })

  it('attributes a remake to the type that owns that tooth', () => {
    const got = unitsByType([job({
      work_items: [item('Kroon', '11,12'), item('Sild', '14,15,16')],
      revisions: [{ id: 'r', ts: '2026-08-05', note: '', hambad: '15,16' } as Revision],
    })], label)
    expect(row(got, 'Sild')!.redone).toBe(2)
    expect(row(got, 'Kroon')!.redone).toBe(0)
  })

  it('keeps remakes OUT of the original count', () => {
    // A remade crown is work done twice, not a second crown sold. Folding them
    // together would inflate production by the failure rate.
    const got = unitsByType([job({
      work_items: [item('Kroon', '11')],
      revisions: [{ id: 'r', ts: '2026-08-05', note: '', hambad: '11' } as Revision],
    })], label)
    expect(row(got, 'Kroon')).toMatchObject({ teeth: 1, redone: 1 })
  })

  it('places a tooth-less revision when the job has only one type', () => {
    const got = unitsByType([job({
      hambad: '11,12',
      work_items: [item('Kroon', '11,12')],
      revisions: [{ id: 'r', ts: '2026-08-05', note: 'kogu töö uuesti' } as Revision],
    })], label)
    expect(row(got, 'Kroon')!.redone).toBe(2)
    expect(got.unplacedRedone).toBe(0)
  })

  it('REPORTS a tooth-less revision on a mixed job instead of guessing', () => {
    // Splitting it across the types would put units under a name nobody made.
    const got = unitsByType([job({
      hambad: '11,14,15',
      work_items: [item('Kroon', '11'), item('Sild', '14,15')],
      revisions: [{ id: 'r', ts: '2026-08-05', note: '' } as Revision],
    })], label)
    expect(got.unplacedRedone).toBe(3)
    expect(row(got, 'Kroon')!.redone).toBe(0)
    expect(row(got, 'Sild')!.redone).toBe(0)
  })

  it('REPORTS a remade tooth that no item claims', () => {
    const got = unitsByType([job({
      work_items: [item('Kroon', '11')],
      revisions: [{ id: 'r', ts: '2026-08-05', note: '', hambad: '47' } as Revision],
    })], label)
    expect(got.unplacedRedone).toBe(1)
  })

  it('groups through the classifier it is given', () => {
    // So the chart groups the way the calendar and the price list already do,
    // rather than inventing a third spelling of the same type.
    const got = unitsByType(
      [job({ work_items: [item('allon4', '11')] }), job({ work_items: [item('AllOn4', '21')] })],
      t => (/allon/i.test(t ?? '') ? 'All-on-X' : 'Muu'),
    )
    expect(got.rows).toHaveLength(1)
    expect(got.rows[0]).toMatchObject({ name: 'All-on-X', teeth: 2, jobs: 2 })
  })

  it('leaves out a type with nothing in it', () => {
    expect(unitsByType([job({ work_items: [item('Kroon', '')] })], label).rows).toEqual([])
  })

  it('is empty for no jobs', () => {
    expect(unitsByType([], label)).toEqual({ rows: [], unplacedRedone: 0 })
  })
})
