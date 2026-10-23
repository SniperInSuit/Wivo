/**
 * What is due today. The Ülevaade rail and its "Täna tähtsad tööd" panel both
 * read only `job.valmis_aeg`, so a remake due at one o'clock was on the board,
 * in the payroll and in the costs — and invisible on the one screen whose job
 * is to say what today looks like.
 */
import { describe, it, expect } from 'vitest'
import { jobDeadlines, deadlinesOn, openDeadlines } from './deadlines'
import type { Job, Revision } from '../types/job'

const DONE = 'valmis'
const TODAY = new Date('2026-10-23T12:00:00')

const rev = (over: Partial<Revision> = {}): Revision =>
  ({ id: 'r1', ts: '2026-10-19T12:14:00', note: 'Murdus', ...over } as Revision)

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1', patsient: 'Merle Kangust', too: 'Sild', hambad: '43,44,45',
  status: 'disain', work_items: [{ id: 'a', too: 'Sild', hambad: '43,44,45' }],
  revisions: [],
  ...over,
} as unknown as Job)

describe('jobDeadlines', () => {
  it('lists the job\u2019s own deadline', () => {
    const d = jobDeadlines([job({ valmis_aeg: '2026-10-23T12:00:00' })])
    expect(d).toHaveLength(1)
    expect(d[0].rev).toBeNull()
    expect(d[0].label).toBe('Sild')
  })

  // The bug, as a test.
  it('lists a revision\u2019s deadline too', () => {
    const d = jobDeadlines([job({
      valmis_aeg: null,
      revisions: [rev({ deadline: '2026-10-23T13:00:00' })],
    })])
    expect(d).toHaveLength(1)
    expect(d[0].nr).toBe(1)
    expect(d[0].label).toBe('Muudatus 1: Sild')
  })

  it('numbers revisions the way the job page chips do', () => {
    const d = jobDeadlines([job({
      revisions: [
        rev({ id: 'a', deadline: '2026-10-20T10:00:00' }),
        rev({ id: 'b', deadline: '2026-10-23T13:00:00' }),
      ],
    })])
    expect(d.map(x => x.nr)).toEqual([1, 2])
  })

  // A remake agreed without a date must not inherit the job's: that would put
  // work on a day nobody promised it for.
  it('skips a revision with no deadline of its own', () => {
    const d = jobDeadlines([job({
      valmis_aeg: '2026-10-23T12:00:00',
      revisions: [rev({})],
    })])
    expect(d).toHaveLength(1)
    expect(d[0].rev).toBeNull()
  })

  it('keys every row distinctly, so two remakes of one job both render', () => {
    const d = jobDeadlines([job({
      valmis_aeg: '2026-10-23T12:00:00',
      revisions: [
        rev({ id: 'a', deadline: '2026-10-23T13:00:00' }),
        rev({ id: 'b', deadline: '2026-10-23T14:00:00' }),
      ],
    })])
    expect(new Set(d.map(x => x.key)).size).toBe(3)
  })
})

describe('deadlinesOn', () => {
  it('takes the job and the remake that fall on the day', () => {
    const rows = deadlinesOn([job({
      valmis_aeg: '2026-10-23T11:30:00',
      revisions: [
        rev({ id: 'a', deadline: '2026-10-23T13:00:00' }),
        rev({ id: 'b', deadline: '2026-10-24T09:00:00' }),
      ],
    })], TODAY)
    expect(rows.map(r => r.nr)).toEqual([null, 1])
  })
})

describe('openDeadlines', () => {
  // The case the board showed and the dashboard did not: the job is finished,
  // its remake is not, and the remake is due today.
  it('shows a remake of a FINISHED job', () => {
    const { dueToday } = openDeadlines([job({
      status: DONE, valmis_aeg: '2026-10-19T12:00:00',
      revisions: [rev({ deadline: '2026-10-23T13:00:00', status: 'varvi' })],
    })], TODAY, DONE)
    expect(dueToday.map(d => d.nr)).toEqual([1])
  })

  // And the other way: a finished remake is not outstanding work.
  it('hides a remake that is itself finished', () => {
    const { dueToday, overdue } = openDeadlines([job({
      status: 'disain', valmis_aeg: null,
      revisions: [rev({ deadline: '2026-10-23T13:00:00', status: DONE })],
    })], TODAY, DONE)
    expect(dueToday).toEqual([])
    expect(overdue).toEqual([])
  })

  it('separates late from due today', () => {
    const { dueToday, overdue } = openDeadlines([job({
      valmis_aeg: '2026-10-23T09:00:00',
      revisions: [rev({ deadline: '2026-10-20T13:00:00' })],
    })], TODAY, DONE)
    expect(dueToday).toHaveLength(1)
    expect(overdue).toHaveLength(1)
  })

  // Earlier today is still TODAY, not late — a rail that reddens at noon on
  // work promised for the morning is a rail nobody trusts.
  it('counts an earlier hour today as due today, not overdue', () => {
    const { dueToday, overdue } = openDeadlines(
      [job({ valmis_aeg: '2026-10-23T09:00:00' })], TODAY, DONE
    )
    expect(dueToday).toHaveLength(1)
    expect(overdue).toHaveLength(0)
  })
})
