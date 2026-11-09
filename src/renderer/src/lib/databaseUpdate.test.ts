import { describe, it, expect } from 'vitest'
import { pendingDatabaseUpdate, updateReasonText } from './databaseUpdate'
import type { UpdateStatus } from './updateStatus'

const entry = (version: string) => ({ version, package: `wivo-update-${version}.json`, sha256: 'a'.repeat(64), size: 1, manual_only: false, auto_after: '2026-11-01T00:00:00Z' })
const status = (over: Partial<UpdateStatus> = {}, versions = ['2.2.0', '2.3.0', '2.4.0'], withdrawn: string[] = []): UpdateStatus => ({
  channel: 'stable', installed: { version: '2.2.0', at: '2026-11-01T00:00:00Z' }, stale: false, last_check: null, installs: [], keys: [],
  list: { key_id: 'k', serial: 3, expires: '2026-11-20T00:00:00Z', checked_at: '2026-11-09T00:00:00Z',
    content: { versions: versions.map(entry), withdrawn: withdrawn.map(version => ({ version, reason: 'x' })) } },
  ...over,
})

describe('the database update an approver is offered', () => {
  it('the newest above the installed version', () => {
    expect(pendingDatabaseUpdate(status())?.version).toBe('2.4.0')
  })

  it('not a withdrawn one', () => {
    expect(pendingDatabaseUpdate(status({}, ['2.3.0', '2.4.0'], ['2.4.0']))?.version).toBe('2.3.0')
  })

  it('none when nothing is newer, the list is stale, or nothing is installed yet', () => {
    expect(pendingDatabaseUpdate(status({}, ['2.1.0', '2.2.0']))).toBeNull()
    expect(pendingDatabaseUpdate(status({ stale: true }))).toBeNull()
    expect(pendingDatabaseUpdate(status({ installed: null }))).toBeNull()
    expect(pendingDatabaseUpdate(null)).toBeNull()
  })
})

describe('what wivo-update answered, in words', () => {
  it('a failed migration keeps its code for support; an unknown reason is shown as it is', () => {
    expect(updateReasonText('migrations/905_bad.sql 42P01')).toContain('migrations/905_bad.sql 42P01')
    expect(updateReasonText('something_new')).toContain('something_new')
  })

  it('a known reason is a sentence, not a code', () => {
    for (const r of ['not_fresh', 'not_approver', 'not_newer', 'withdrawn', 'list_bad_signature', 'functions_not_yet']) {
      expect(updateReasonText(r)).not.toContain(r)
    }
  })
})
