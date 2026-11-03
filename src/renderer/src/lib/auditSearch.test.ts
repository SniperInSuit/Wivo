import { describe, it, expect } from 'vitest'
import { toCsv } from '@shared/export/csv'
import { AUDIT_ACTIONS, AUDIT_CSV_COLUMNS, NO_FILTERS, actionLabel, cursorAfter, describeEntry, entryWhat, filterArgs, type AuditEntry } from './auditSearch'

const entry = (p: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1, at: '2026-03-05T10:00:00Z', user_name: 'Mari', action: 'stage_move', object: 'job:x', job_code: 'TAL-26-0042',
  detail: { from: 'disain', to: 'print' }, ...p,
})

describe('the filters as the database takes them', () => {
  it('nothing set: nothing filtered', () => {
    expect(filterArgs(NO_FILTERS)).toEqual({ p_user: null, p_action: null, p_job_code: null, p_from: null, p_to: null })
  })

  it('dates are this computer\'s days, both ends included: from the start of the first to the start of the day after the last', () => {
    const a = filterArgs({ ...NO_FILTERS, from: '2026-03-01', to: '2026-03-31' })
    expect(new Date(a.p_from!).getTime()).toBe(new Date(2026, 2, 1).getTime())
    expect(new Date(a.p_to!).getTime()).toBe(new Date(2026, 3, 1).getTime())
  })

  it('a job code is trimmed; person and action pass as they are; a broken date is ignored', () => {
    expect(filterArgs({ ...NO_FILTERS, jobCode: '  tal 26 0042 ', userId: 'u1', action: 'view', from: 'yesterday' }))
      .toEqual({ p_user: 'u1', p_action: 'view', p_job_code: 'tal 26 0042', p_from: null, p_to: null })
  })
})

describe('paging', () => {
  it('the next page starts after this page\'s last row', () => {
    expect(cursorAfter([entry({ id: 9, at: 'b' }), entry({ id: 3, at: 'a' })])).toEqual({ at: 'a', id: 3 })
    expect(cursorAfter([])).toBeNull()
  })
})

describe('what is shown, and exported', () => {
  it('every kind of entry the log holds has a name', () => {
    for (const a of AUDIT_ACTIONS) expect(actionLabel(a)).not.toBe(a)
    expect(AUDIT_ACTIONS).toContain('delete')
    expect(AUDIT_ACTIONS).toContain('stock_override')
  })

  it('the job code where there is one, otherwise the object', () => {
    expect(entryWhat(entry())).toBe('TAL-26-0042')
    expect(entryWhat(entry({ job_code: null, object: 'partnership:1' }))).toBe('partnership:1')
    expect(describeEntry(entry())).toBe('disain → print')
  })

  it('the CSV has exactly the screen\'s columns — nothing the log does not show (no ids, no raw detail)', () => {
    expect(AUDIT_CSV_COLUMNS).toHaveLength(5)
    const csv = toCsv([entry({ detail: { from: 'disain', to: 'print', secret: 'x' } })], AUDIT_CSV_COLUMNS)
    expect(csv).toContain('TAL-26-0042')
    expect(csv).toContain('Mari')
    expect(csv).not.toContain('secret')
    expect(csv).not.toContain('job:x')
  })
})
