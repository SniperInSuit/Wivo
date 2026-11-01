import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useLicense } from './useLicense'
import { t } from '@/lib/i18n'

export type PermissionKey =
  | 'jobs.read' | 'jobs.write'
  | 'patients.read' | 'patients.write'
  | 'visits.read' | 'visits.write'
  | 'stats.read'
  | 'payments.read' | 'payments.write'
  | 'settings.read'
  | 'pipeline.write'
  | 'payroll.manage'

// Human-readable labels for the permissions UI
export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  'jobs.read':       { label: t('usePermissions.viewJobs'), description: t('usePermissions.seesAllJobsOnTheBoard') },
  'jobs.write':      { label: t('usePermissions.editJobs'), description: t('usePermissions.canCreateAndEditJobs') },
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
}

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as PermissionKey[]

interface PermissionRow {
  permission: string
  granted: boolean
}

/**
 * Returns the current user's effective permissions.
 * - Owner: everything is allowed (no DB check needed)
 * - Worker: fetches from worker_permissions table, defaults to false
 * - Patient: hardcoded minimal set
 */
export function usePermissions() {
  const { role, user, status } = useAuth()
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

  function can(perm: PermissionKey): boolean {
    // An expired licence makes the app read-only. Enforced HERE because every
    // write button in the app already asks this question — gating it anywhere
    // else would mean finding and patching each of them, and missing some.
    // Reading is deliberately untouched: a lab must always be able to look up
    // what it promised a customer, whatever the state of its invoice to us.
    if (!licenceCanWrite && (perm.endsWith('.write') || perm === 'payroll.manage')) {
      return false
    }
    if (role === 'owner') return true
    if (role === 'patient') {
      // Patients can only view their own visits
      return perm === 'visits.read'
    }
    // Worker: check the DB rows, default to false if not explicitly granted
    const row = rows.find(r => r.permission === perm)
    return row?.granted ?? false
  }

  return { can, role, isOwner: role === 'owner', licenceCanWrite }
}
