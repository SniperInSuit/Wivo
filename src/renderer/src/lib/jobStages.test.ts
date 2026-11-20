import { describe, it, expect } from 'vitest'
import {
  hasStagePeople, jobStagesFromRows, jobStagesUnavailable, myTurnIn, neighbours, stageLines, type JobStage,
} from './jobStages'

const st = (stageKey: string, position: number, extra: Partial<JobStage> = {}): JobStage => ({
  id: stageKey, stageKey, position, task: null, skipped: false, startedAt: null, startedBy: null, doneAt: null, doneBy: null, people: [], ...extra,
})

describe('a job\'s stages', () => {
  it('reads rows in order with their people', () => {
    const rows = [
      { id: '2', stage_key: 'b', position: 1, task: null, skipped_at: '2026-01-01', started_at: null, started_by: null, done_at: null, done_by: null, job_stage_person: [{ profile_id: 'x' }] },
      { id: '1', stage_key: 'a', position: 0, task: 't', skipped_at: null, started_at: null, started_by: null, done_at: null, done_by: null, job_stage_person: null },
    ]
    const out = jobStagesFromRows(rows)
    expect(out.map(s => s.stageKey)).toEqual(['a', 'b'])
    expect(out[1]).toMatchObject({ skipped: true, people: ['x'] })
    expect(out[0].people).toEqual([])
  })

  it('done before the current stage, upcoming after; skipped is neither and not counted as away', () => {
    const lines = stageLines([st('a', 0), st('b', 1), st('c', 2, { skipped: true }), st('d', 3), st('e', 4)], 'b')
    expect(lines.map(l => l.state)).toEqual(['done', 'current', 'skipped', 'upcoming', 'upcoming'])
    expect(lines.map(l => l.stagesAway)).toEqual([null, null, null, 0, 1])
  })

  it('an old job (no done marks) still shows the stages before the current one as done', () => {
    expect(stageLines([st('a', 0), st('b', 1)], 'b')[0].state).toBe('done')
  })

  it('a job whose status is not one of its stages has no current stage and no neighbours', () => {
    const lines = stageLines([st('a', 0), st('b', 1)], 'zzz')
    expect(lines.some(l => l.state === 'current')).toBe(false)
    expect(neighbours(lines)).toEqual({ previous: null, next: null })
  })

  it('neighbours pass over skipped stages', () => {
    const lines = stageLines([st('a', 0), st('b', 1, { skipped: true }), st('c', 2), st('d', 3, { skipped: true }), st('e', 4)], 'c')
    const n = neighbours(lines)
    expect(n.previous?.stageKey).toBe('a')
    expect(n.next?.stageKey).toBe('e')
  })

  it('tells a person how many stages come before theirs', () => {
    const lines = stageLines([st('a', 0), st('b', 1), st('c', 2, { skipped: true }), st('d', 3), st('e', 4, { people: ['me'] })], 'a')
    expect(myTurnIn(lines, 'me')).toBe(2)
    expect(myTurnIn(lines, 'you')).toBeNull()
    expect(myTurnIn(lines, null)).toBeNull()
    expect(myTurnIn(stageLines([st('a', 0, { people: ['me'] })], 'a'), 'me')).toBeNull() // already their stage
  })

  it('people only count on stages that are not skipped', () => {
    expect(hasStagePeople([st('a', 0, { people: ['x'], skipped: true })])).toBe(false)
    expect(hasStagePeople([st('a', 0, { people: ['x'] })])).toBe(true)
  })

  it('a missing table or function means "older database", nothing else does', () => {
    for (const code of ['42P01', 'PGRST200', 'PGRST205', 'PGRST202', '42883']) expect(jobStagesUnavailable({ code })).toBe(true)
    for (const code of ['42501', '23505', undefined]) expect(jobStagesUnavailable({ code })).toBe(false)
    expect(jobStagesUnavailable(null)).toBe(false)
  })
})
