import { describe, it, expect } from 'vitest'
import { decidePermission, PERMISSION_KEYS, TECHNICIAN_PRESET, ADMIN_PERMISSIONS, type PermissionKey, type Who } from './permissions'

const worker = (granted: PermissionKey[] = [], extra: Partial<Who> = {}): Who =>
  ({ role: 'worker', isOrgAdmin: false, licenceCanWrite: true, granted: p => granted.includes(p), ...extra })

describe('decidePermission (mirrors sql/102)', () => {
  it('a worker has only what was granted; nothing by default', () => {
    for (const p of PERMISSION_KEYS) expect(decidePermission(p, worker())).toBe(false)
    expect(decidePermission('payments.read', worker(['payments.read']))).toBe(true)
  })

  it('the technician preset: edit jobs and use stock; no money, no deleting, no other people\'s jobs', () => {
    const tech = worker([...TECHNICIAN_PRESET])
    for (const p of ['jobs.write', 'stock.read', 'stock.write'] as const) expect(decidePermission(p, tech)).toBe(true)
    for (const p of ['payments.read', 'payments.write', 'jobs.delete', 'jobs.read', 'payroll.manage', 'stats.read'] as const) {
      expect(decidePermission(p, tech), p).toBe(false)
    }
  })

  it('an organisation admin has money and deleting without a grant, and nothing else extra', () => {
    const admin = worker([], { isOrgAdmin: true })
    for (const p of ADMIN_PERMISSIONS) expect(decidePermission(p, admin)).toBe(true)
    expect(decidePermission('jobs.write', admin)).toBe(false)
  })

  it('an owner has everything; a patient only their visits', () => {
    for (const p of PERMISSION_KEYS) expect(decidePermission(p, { ...worker(), role: 'owner' })).toBe(true)
    expect(decidePermission('visits.read', { ...worker(), role: 'patient' })).toBe(true)
    expect(decidePermission('payments.read', { ...worker(), role: 'patient' })).toBe(false)
  })

  it('an expired licence takes every write and deleting, from everyone; reading stays', () => {
    const owner: Who = { ...worker(), role: 'owner', licenceCanWrite: false }
    for (const p of ['jobs.write', 'jobs.delete', 'payments.write', 'payroll.manage'] as const) expect(decidePermission(p, owner), p).toBe(false)
    expect(decidePermission('payments.read', owner)).toBe(true)
  })
})
