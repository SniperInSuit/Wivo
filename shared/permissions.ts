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

export interface Who {
  role: string | null
  /** Organisation owner or admin (profiles.org_role). */
  isOrgAdmin: boolean
  /** An expired licence makes the app read-only. */
  licenceCanWrite: boolean
  /** Whether the person has a granted row for this permission. */
  granted: (perm: PermissionKey) => boolean
}

/**
 * The app's answer to "may this person …", mirroring the database: an owner
 * may everything; an organisation admin also has ADMIN_PERMISSIONS (sql/102);
 * a patient only sees their visits; a worker has what was granted, nothing
 * by default.
 *
 * An expired licence takes away every write first. Enforced here because every
 * write button already asks this question. Reading is deliberately untouched:
 * a lab must always be able to look up what it promised a customer, whatever
 * the state of its invoice to us.
 */
export function decidePermission(perm: PermissionKey, who: Who): boolean {
  if (!who.licenceCanWrite && (perm.endsWith('.write') || perm === 'jobs.delete' || perm === 'payroll.manage')) return false
  if (who.role === 'owner') return true
  if (who.role === 'patient') return perm === 'visits.read'
  if (who.isOrgAdmin && ADMIN_PERMISSIONS.includes(perm)) return true
  return who.granted(perm)
}
