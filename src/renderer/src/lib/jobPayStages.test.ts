/**
 * Jobs read with their pay stages (§10): what an older database's answer
 * means, how a row becomes `pay_stages`, and that the field never goes back to
 * the database with a save.
 */
import { describe, it, expect } from 'vitest'
import { payStagesUnavailable, withPayStages, JOBS_WITH_PAY_STAGES, PAY_STAGE_FILTER } from './jobPayStages'
import { withoutDbOwned } from '../hooks/useJobs'

describe('payStagesUnavailable: only an older database falls back', () => {
  it('no job_stage relationship (before sql/122)', () => {
    expect(payStagesUnavailable({ code: 'PGRST200', message: "Could not find a relationship between 'jobs' and 'job_stage'" })).toBe(true)
    expect(payStagesUnavailable({ code: '42P01', message: 'relation "public.job_stage" does not exist' })).toBe(true)
  })

  it('no pay_role column (before sql/124)', () => {
    expect(payStagesUnavailable({ code: '42703', message: 'column job_stage_1.pay_role does not exist' })).toBe(true)
  })

  it('any other missing column is a real error, not a fallback', () => {
    expect(payStagesUnavailable({ code: '42703', message: 'column jobs.something does not exist' })).toBe(false)
  })

  it('a network, permission or second-factor error is thrown, never read as "no stages"', () => {
    for (const code of ['42501', 'PGRST301', '57014', '', undefined]) {
      expect(payStagesUnavailable({ code, message: 'nope' })).toBe(false)
    }
    expect(payStagesUnavailable(null)).toBe(false)
  })
})

describe('withPayStages', () => {
  it('turns the embed into pay_stages and drops the raw rows', () => {
    const job = withPayStages({
      id: 'j1', assigned_to: 'old',
      job_stage: [{ stage_key: 'freesimine', position: 2, pay_role: 'too', skipped_at: null, job_stage_person: [{ profile_id: 't1' }] }],
    })
    expect(job).not.toHaveProperty('job_stage')
    expect(job.pay_stages).toEqual([{ stageKey: 'freesimine', position: 2, payRole: 'too', skipped: false, people: ['t1'] }])
    expect(job.assigned_to).toBe('old')
  })

  it('a job with no pay stages gets an empty list (today\'s rule)', () => {
    expect(withPayStages({ id: 'j1', job_stage: [] }).pay_stages).toEqual([])
  })

  it('asks only for stages that carry a pay kind, and only what pay needs', () => {
    expect(JOBS_WITH_PAY_STAGES).toBe('*, job_stage(stage_key, position, pay_role, skipped_at, job_stage_person(profile_id))')
    expect(PAY_STAGE_FILTER).toEqual(['job_stage.pay_role', 'is', null])
  })
})

describe('a save never sends pay_stages back', () => {
  it('a form filled by spreading a loaded job drops it, with job_code', () => {
    const row = { patsient: 'X', job_code: 'TLN-26-0001', pay_stages: [], assigned_to: 'a' }
    expect(withoutDbOwned(row)).toEqual({ patsient: 'X', assigned_to: 'a' })
  })
})
