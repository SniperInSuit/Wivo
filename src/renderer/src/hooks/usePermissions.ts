import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useLicense } from './useLicense'
import { decidePermission, menuAllows, type MenuPlace, type PermissionKey, type Who } from '@shared/permissions'
import { t } from '@/lib/i18n'

export type { PermissionKey }

// Human-readable labels for the permissions UI
export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  'jobs.read':       { label: t('usePermissions.viewJobs'), description: t('usePermissions.seesAllJobsOnTheBoard') },
  'jobs.write':      { label: t('usePermissions.editJobs'), description: t('usePermissions.canCreateAndEditJobs') },
  'jobs.delete':     { label: t('usePermissions.deleteJobs'), description: t('usePermissions.canDeleteAndRestoreJobs') },
  'patients.read':   { label: t('usePermissions.viewPatients'), description: t('usePermissions.seesThePatientListAndProfiles') },
  'patients.write':  { label: t('usePermissions.editPatients'), description: t('usePermissions.canEditPatientHealthData') },
  'visits.read':     { label: t('usePermissions.viewVisits'), description: t('usePermissions.seesAllVisitsInTheCalendar') },
  'visits.write':    { label: t('usePermissions.manageVisits'), description: t('usePermissions.canBookAndEditVisits') },
  'stats.read':      { label: t('usePermissions.viewStatistics'), description: t('usePermissions.seesTheStatisticsAndReportsPage') },
  'payments.read':   { label: t('usePermissions.viewPayments'), description: t('usePermissions.seesInvoicesAndPaymentDetails') },
  'payments.write':  { label: t('usePermissions.managePayments'), description: t('usePermissions.canMarkAsPaidAndCreate') },
  'settings.read':   { label: t('usePermissions.viewSettings'), description: t('usePermissions.seesTheClinicSettingsCannotChange') },
  'pipeline.write':  { label: t('usePermissions.editStages'), description: t('usePermissions.canAddRemoveAndRenameJob') },
  'payroll.manage':  { label: t('usePermissions.managePayroll'), description: t('usePermissions.seesEveryoneSPayRatesAnd') },
  'stock.read':      { label: t('usePermissions.viewStock'), description: t('usePermissions.seesStockAndCounts') },
  'stock.write':     { label: t('usePermissions.manageStock'), description: t('usePermissions.canAddUseAndCountStock') },
}

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as PermissionKey[]

interface PermissionRow {
  permission: string
  granted: boolean
}

/**
 * Returns the current user's effective permissions.
 * - Owner: everything is allowed (no DB check needed)
 * - Organisation admin: also ADMIN_PERMISSIONS without a grant, as the
 *   database's has_perm_or_admin() (sql/102)
 * - Worker: fetches from worker_permissions table, defaults to false
 * - Patient: hardcoded minimal set
 */
export function usePermissions() {
  const { role, user, status, profile } = useAuth()
  const isOrgAdmin = profile?.org_role === 'admin' || profile?.org_role === 'owner'
  const { canWrite: licenceCanWrite } = useLicense()

  const { data: rows = [] } = useQuery<PermissionRow[]>({
    queryKey: ['permissions', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('worker_permissions')
        .select('permission, granted')
        .eq('profile_id', user.id)
      if (error) return []
      return data as PermissionRow[]
    },
    enabled: status === 'authenticated' && role === 'worker'
  })

  const who: Who = {
    role, isOrgAdmin, licenceCanWrite,
    granted: p => rows.find(r => r.permission === p)?.granted ?? false,
  }
  const can = (perm: PermissionKey): boolean => decidePermission(perm, who)
  /** Whether a place shows in the menu: the same rule on the desktop and the phone. */
  const sees = (place: MenuPlace): boolean => menuAllows(place, who)

  return { can, sees, role, isOwner: role === 'owner', licenceCanWrite }
}
