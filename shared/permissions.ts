/**
 * Permission names and the rules the database also applies (docs/PERMISSIONS.md).
 * No imports: the app, the SQL tests and anyone else can load it.
 */

export const PERMISSION_KEYS = [
  'jobs.read', 'jobs.write', 'jobs.delete',
  'patients.read', 'patients.write',
  'visits.read', 'visits.write',
  'stats.read',
  'payments.read', 'payments.write',
  'settings.read',
  'pipeline.write',
  'payroll.manage',
  'stock.read', 'stock.write',
  // sql/119: approves this clinic's Wivo updates. An admin doesn't get it without a grant.
  'updates.install',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

/**
 * What a new technician starts with (sql/102 handle_new_user, and Team's
 * "Technician" button). Their own jobs and their own pay need no permission.
 * Must equal sql/102 technician_permissions(); sql/test/moneyPermissions.test.ts checks.
 */
export const TECHNICIAN_PRESET: readonly PermissionKey[] = ['jobs.write', 'stock.read', 'stock.write']

/**
 * Permissions an organisation admin has without a grant: the database checks
 * these with has_perm_or_admin() (sql/102). An owner has every permission.
 */
export const ADMIN_PERMISSIONS: readonly PermissionKey[] = ['jobs.delete', 'payments.read', 'payments.write']

/**
 * Which licence module each permission belongs to, or null for the core, which
 * is always on (docs/MODULES-AND-RATINGS.md §1.5). The names are the ones in
 * MODULE_KEYS (shared/license/token.ts); kept as strings so this file still
 * imports nothing, and shared/permissions.test.ts checks they all exist.
 */
export const PERMISSION_MODULE: Record<PermissionKey, string | null> = {
  'jobs.read': 'jobs', 'jobs.write': 'jobs', 'jobs.delete': 'jobs',
  'pipeline.write': 'jobs',
  'patients.read': 'patients', 'patients.write': 'patients',
  'visits.read': 'patients', 'visits.write': 'patients',
  'stats.read': 'stats',
  'payments.read': 'invoices', 'payments.write': 'invoices',
  'payroll.manage': 'payroll',
  'stock.read': 'stock', 'stock.write': 'stock',
  // Core: settings and updates belong to no module. A clinic that may run
  // nothing at all still has to be able to install the build that fixes that.
  'settings.read': null, 'updates.install': null,
}

/**
 * The write-shaped permissions. Taking these away is how both the licence's
 * expiry and a switched-off module work, so the list lives in one place rather
 * than being spelled out twice.
 */
export function isWritePermission(perm: PermissionKey): boolean {
  return perm.endsWith('.write') || perm === 'jobs.delete' || perm === 'payroll.manage'
}

export interface Who {
  role: string | null
  /** Organisation owner or admin (profiles.org_role). */
  isOrgAdmin: boolean
  /** An expired licence makes the app read-only. */
  licenceCanWrite: boolean
  /** Whether the person has a granted row for this permission. */
  granted: (perm: PermissionKey) => boolean
  /**
   * Whether a licence module is switched on. Absent means "everything is on",
   * which is what a build without licensing, the SQL tests and the phone all
   * mean — a caller that knows nothing about modules must not accidentally
   * switch them all off.
   */
  moduleOn?: (module: string) => boolean
}

/** Whether the module this permission belongs to is switched on. */
function moduleAllows(perm: PermissionKey, who: Who): boolean {
  const module = PERMISSION_MODULE[perm]
  return module === null || !who.moduleOn || who.moduleOn(module)
}

/**
 * The app's answer to "may this person …", mirroring the database: an owner
 * may everything; an organisation admin also has ADMIN_PERMISSIONS (sql/102);
 * a patient only sees their visits; a worker has what was granted, nothing
 * by default.
 *
 * An expired licence takes away every write first, and so does a module that
 * is switched off. Enforced here because every write button already asks this
 * question. Reading is deliberately untouched in both cases: a lab must always
 * be able to look up what it promised a customer, whatever the state of its
 * invoice to us and whatever it is paying for.
 */
export function decidePermission(perm: PermissionKey, who: Who): boolean {
  if (!who.licenceCanWrite && isWritePermission(perm)) return false
  // A switched-off module HIDES and refuses writes; it never refuses a read.
  // Switching one back on has to find everything still there, so no row is
  // hidden and no RLS rule changes — losing data must never be what a licence
  // does (docs/MODULES-AND-RATINGS.md §1.6).
  if (isWritePermission(perm) && !moduleAllows(perm, who)) return false
  if (who.role === 'owner') return true
  if (who.role === 'patient') return perm === 'visits.read'
  if (who.isOrgAdmin && ADMIN_PERMISSIONS.includes(perm)) return true
  return who.granted(perm)
}

/**
 * Whether someone has jobs to look at: every member of the clinic does. The
 * database returns a member's own jobs — technician or designer on the job,
 * or designer of one of its work items (job_is_mine, sql/064) — with no
 * permission at all; jobs.read only widens that to every job of the clinic.
 * jobs.write is what lets them edit the jobs they see.
 */
export function seesJobs(who: Pick<Who, 'role'>): boolean {
  return who.role === 'owner' || who.role === 'worker'
}

/** The places in the menu, on the desktop (Sidebar) and the phone (its job lists). */
export type MenuPlace =
  | 'overview' | 'board' | 'table' | 'calendar' | 'taotlused' | 'patients' | 'kliendid' | 'arved' | 'tootasud' | 'stats' | 'stock'

/** The places, as values. Keep in step with MenuPlace above. */
export const MENU_PLACES = [
  'overview', 'board', 'table', 'calendar', 'taotlused', 'patients',
  'kliendid', 'arved', 'tootasud', 'stats', 'stock',
] as const

export const isMenuPlace = (v: string): v is MenuPlace =>
  (MENU_PLACES as readonly string[]).includes(v)

/**
 * Which licence module each place belongs to (docs/MODULES-AND-RATINGS.md
 * §1.5). Patients, Calendar and Requests are ONE piece: a practice that books
 * visits without patient records, or the reverse, is not a thing we sell.
 */
export const PLACE_MODULE: Record<MenuPlace, string | null> = {
  overview: 'stats', stats: 'stats',
  board: 'jobs', table: 'jobs',
  calendar: 'patients', taotlused: 'patients', patients: 'patients',
  kliendid: 'invoices', arved: 'invoices',
  tootasud: 'payroll',
  stock: 'stock',
}

/**
 * Where the app opens when the module behind the usual home page is off
 * (docs/MODULES-AND-RATINGS.md §1.7). Settings is the last resort: it is core,
 * so it is always there, and it is where the licence itself is pasted in — the
 * one page a clinic with nothing switched on actually needs.
 */
export const HOME_ORDER: readonly MenuPlace[] = ['overview', 'board', 'calendar', 'arved', 'tootasud', 'stock']

/** The first place this person can actually open, or null for Settings. */
export function homePlace(who: Who): MenuPlace | null {
  return HOME_ORDER.find(place => menuAllows(place, who)) ?? null
}

/**
 * Who sees a place in the menu: what the database gives them there
 * (docs/PERMISSIONS.md). One rule for the desktop and the phone.
 */
export function menuAllows(place: MenuPlace, who: Who): boolean {
  const module = PLACE_MODULE[place]
  if (module !== null && who.moduleOn && !who.moduleOn(module)) return false
  const can = (perm: PermissionKey) => decidePermission(perm, who)
  switch (place) {
    // Everyone's own numbers and own pay.
    case 'overview': case 'tootasud': return true
    // Own jobs for every member; all of them with jobs.read.
    case 'board': case 'table': return seesJobs(who)
    // A client's page counts all of the clinic's work with them: with only one's
    // own jobs it would show the wrong counts.
    case 'kliendid': return can('jobs.read')
    case 'calendar': return can('visits.read')
    // Handling a booking request makes a visit.
    case 'taotlused': return can('visits.write')
    case 'patients': return can('patients.read')
    case 'arved': return can('payments.read')
    case 'stats': return can('stats.read')
    case 'stock': return can('stock.read')
  }
}
