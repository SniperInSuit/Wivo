import { describe, it, expect } from 'vitest'
import { decidePermission, homePlace, isMenuPlace, isWritePermission, menuAllows, seesJobs, MENU_PLACES, PERMISSION_KEYS, PERMISSION_MODULE, PLACE_MODULE, TECHNICIAN_PRESET, ADMIN_PERMISSIONS, ROLE_PRESETS, ROLE_PRESET_KEYS, type MenuPlace, type PermissionKey, type Who } from './permissions'
import { MODULE_KEYS } from './license/token'

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

  it('Install updates (sql/119): the owner and a member granted it; not an admin without it; an expired licence doesn\'t stop a fix', () => {
    expect(ADMIN_PERMISSIONS).not.toContain('updates.install')
    expect(decidePermission('updates.install', worker([], { isOrgAdmin: true }))).toBe(false)
    expect(decidePermission('updates.install', worker(['updates.install']))).toBe(true)
    expect(decidePermission('updates.install', { ...worker(), role: 'owner', licenceCanWrite: false })).toBe(true)
    expect(TECHNICIAN_PRESET).not.toContain('updates.install')
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

// ─── Licence modules (docs/MODULES-AND-RATINGS.md part 1) ───────────────────

/** A person with everything, so only the module can be the reason for a no. */
const ownerWith = (modules: string[]): Who =>
  ({ ...worker(), role: 'owner', moduleOn: m => modules.includes(m) })

describe('the module maps name modules that exist', () => {
  it('every permission is mapped, to a real module or to the core', () => {
    for (const p of PERMISSION_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(PERMISSION_MODULE, p), p).toBe(true)
      const module = PERMISSION_MODULE[p]
      if (module !== null) expect(MODULE_KEYS, p).toContain(module)
    }
  })

  it('every place is mapped the same way', () => {
    for (const place of MENU_PLACES) {
      const module = PLACE_MODULE[place]
      if (module !== null) expect(MODULE_KEYS, place).toContain(module)
    }
  })

  it('MENU_PLACES and MenuPlace agree — the list is what callers filter by', () => {
    for (const place of MENU_PLACES) expect(menuAllows(place, worker())).toBeTypeOf('boolean')
    expect(isMenuPlace('board')).toBe(true)
    expect(isMenuPlace('settings')).toBe(false)
  })

  it('Settings and Install updates belong to no module: core is always on', () => {
    expect(PERMISSION_MODULE['settings.read']).toBeNull()
    expect(PERMISSION_MODULE['updates.install']).toBeNull()
  })
})

describe('a switched-off module hides and refuses writes — and never a read', () => {
  const noJobs = ownerWith(MODULE_KEYS.filter(m => m !== 'jobs'))

  it('takes the writes of that module, from the owner too', () => {
    for (const p of ['jobs.write', 'jobs.delete', 'pipeline.write'] as const) {
      expect(decidePermission(p, noJobs), p).toBe(false)
    }
  })

  it('LEAVES THE READS. Switching a module back on has to find everything there', () => {
    expect(decidePermission('jobs.read', noJobs)).toBe(true)
  })

  it('touches nothing in another module', () => {
    for (const p of ['stock.write', 'payments.write', 'payroll.manage'] as const) {
      expect(decidePermission(p, noJobs), p).toBe(true)
    }
  })

  it('hides that module\'s places, and only those', () => {
    const menu = MENU_PLACES.filter(place => menuAllows(place, noJobs))
    expect(menu).not.toContain('board')
    expect(menu).not.toContain('table')
    expect(menu).toContain('stock')
    expect(menu).toContain('arved')
  })

  it('Patients, Calendar and Requests go together: one module, one piece', () => {
    const noPatients = ownerWith(MODULE_KEYS.filter(m => m !== 'patients'))
    for (const place of ['patients', 'calendar', 'taotlused'] as const) {
      expect(menuAllows(place, noPatients), place).toBe(false)
    }
  })

  it('Overview is Statistics: switching stats off takes the home page with it', () => {
    const noStats = ownerWith(MODULE_KEYS.filter(m => m !== 'stats'))
    expect(menuAllows('overview', noStats)).toBe(false)
    expect(menuAllows('stats', noStats)).toBe(false)
  })

  it('a caller that knows nothing about modules gets everything, not nothing', () => {
    // The SQL tests and the phone build a Who without moduleOn. If absence
    // meant "off", a missing field would empty the menu.
    expect(decidePermission('jobs.write', { ...worker(), role: 'owner' })).toBe(true)
    expect(MENU_PLACES.filter(p => menuAllows(p, { ...worker(), role: 'owner' }))).toEqual([...MENU_PLACES])
  })

  it('an expired licence and a switched-off module take the same list of writes', () => {
    for (const p of PERMISSION_KEYS) {
      const byLicence = !decidePermission(p, { ...worker(), role: 'owner', licenceCanWrite: false })
      expect(byLicence, p).toBe(isWritePermission(p))
    }
  })
})

describe('where the app opens when a module took the home page away', () => {
  it('Overview, when statistics are on', () => {
    expect(homePlace(ownerWith([...MODULE_KEYS]))).toBe('overview')
  })

  it('Jobs, when they are not', () => {
    expect(homePlace(ownerWith(['jobs', 'payroll', 'stock']))).toBe('board')
  })

  it('the calendar, when there are no jobs either', () => {
    expect(homePlace(ownerWith(['patients', 'payroll']))).toBe('calendar')
  })

  it('down the order: invoices, then pay, then stock', () => {
    expect(homePlace(ownerWith(['invoices', 'payroll', 'stock']))).toBe('arved')
    expect(homePlace(ownerWith(['payroll', 'stock']))).toBe('tootasud')
    expect(homePlace(ownerWith(['stock']))).toBe('stock')
  })

  it('null — meaning Settings — when nothing is on. That is where a licence is pasted in', () => {
    expect(homePlace(ownerWith([]))).toBeNull()
  })

  it('a member\'s own home, not the owner\'s: it answers per person', () => {
    expect(homePlace(worker([...TECHNICIAN_PRESET], { moduleOn: m => m === 'jobs' }))).toBe('board')
    expect(homePlace(worker([], { moduleOn: m => m === 'stock' }))).toBeNull()
  })
})

describe('the role presets of Riga (docs/WORKFLOW-STAGES.md §7)', () => {
  it('only names real permissions, and the technician one is the database default', () => {
    for (const k of ROLE_PRESET_KEYS) for (const p of ROLE_PRESETS[k]) expect(PERMISSION_KEYS).toContain(p)
    expect(ROLE_PRESETS.technician).toEqual(TECHNICIAN_PRESET)
  })

  it('whoever must not see a patient never gets a way to', () => {
    for (const k of ['manager', 'accountant', 'it'] as const) {
      expect(ROLE_PRESETS[k]).not.toContain('jobs.read')
      expect(ROLE_PRESETS[k]).not.toContain('patients.read')
    }
  })

  it('doctor: orders and the patient card; secretary: jobs, no calendar; IT: files only', () => {
    expect([...ROLE_PRESETS.doctor].sort()).toEqual(['jobs.read', 'jobs.write', 'patients.read', 'patients.write'])
    expect(ROLE_PRESETS.secretary).toEqual(['jobs.read'])
    expect(ROLE_PRESETS.secretary).not.toContain('visits.read')
    expect(ROLE_PRESETS.it).toEqual(['files.write'])
  })

  it('no preset hands out the update approval or the money pages', () => {
    for (const k of ROLE_PRESET_KEYS) for (const p of ['updates.install', 'payments.write', 'payments.read'] as const) expect(ROLE_PRESETS[k]).not.toContain(p)
  })
})
