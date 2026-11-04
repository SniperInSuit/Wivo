import { describe, it, expect } from 'vitest'
import { decidePermission, menuAllows, seesJobs, PERMISSION_KEYS, TECHNICIAN_PRESET, ADMIN_PERMISSIONS, type MenuPlace, type PermissionKey, type Who } from './permissions'

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

describe('the menu, desktop and phone alike (menuAllows)', () => {
  const PLACES: MenuPlace[] = ['overview', 'board', 'table', 'calendar', 'taotlused', 'patients', 'kliendid', 'arved', 'tootasud', 'stats', 'stock']
  const menu = (who: Who) => PLACES.filter(p => menuAllows(p, who))

  it('a technician with the defaults (Edit jobs, Stock; not View jobs): Jobs and Table with their own jobs', () => {
    // The bug: Jobs and Table asked for View jobs, so the desktop hid the job he was assigned to.
    expect(menu(worker([...TECHNICIAN_PRESET]))).toEqual(['overview', 'board', 'table', 'tootasud', 'stock'])
  })

  it('View jobs widens the jobs, and opens Clients (a client\'s page counts all of the clinic\'s work)', () => {
    expect(menu(worker([...TECHNICIAN_PRESET, 'jobs.read']))).toEqual(['overview', 'board', 'table', 'kliendid', 'tootasud', 'stock'])
  })

  it('an organisation admin with the technician defaults: also Invoices (money, sql/102), nothing else extra', () => {
    expect(menu(worker([...TECHNICIAN_PRESET], { isOrgAdmin: true }))).toEqual(['overview', 'board', 'table', 'arved', 'tootasud', 'stock'])
  })

  it('a member with nothing granted still has their own jobs and pay', () => {
    expect(menu(worker())).toEqual(['overview', 'board', 'table', 'tootasud'])
  })

  it('each other place opens with its permission, as the database decides', () => {
    expect(menuAllows('calendar', worker(['visits.read']))).toBe(true)
    expect(menuAllows('taotlused', worker(['visits.read']))).toBe(false)
    expect(menuAllows('taotlused', worker(['visits.write']))).toBe(true)
    expect(menuAllows('patients', worker(['patients.read']))).toBe(true)
    expect(menuAllows('arved', worker(['payments.read']))).toBe(true)
    expect(menuAllows('stats', worker(['stats.read']))).toBe(true)
  })

  it('an owner: everything', () => {
    expect(menu({ ...worker(), role: 'owner' })).toEqual(PLACES)
  })

  it('an expired licence never hides a job: reading stays', () => {
    expect(menu(worker([...TECHNICIAN_PRESET], { licenceCanWrite: false }))).toEqual(['overview', 'board', 'table', 'tootasud', 'stock'])
  })

  it('jobs are for the clinic\'s members: not a patient, not someone without a role yet', () => {
    expect(seesJobs({ role: 'worker' })).toBe(true)
    expect(seesJobs({ role: 'owner' })).toBe(true)
    expect(seesJobs({ role: 'patient' })).toBe(false)
    expect(seesJobs({ role: null })).toBe(false)
  })
})
