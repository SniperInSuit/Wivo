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
  'jobs.read':       { label: t('Tööd vaadata', 'View jobs'), description: t('Näeb kõiki töid tahvlil ja tabelis', 'Sees all jobs on the board and in the table') },
  'jobs.write':      { label: t('Töid muuta', 'Edit jobs'), description: t('Saab luua ja muuta töid', 'Can create and edit jobs') },
  'patients.read':   { label: t('Patsiente vaadata', 'View patients'), description: t('Näeb patsientide nimekirja ja profiile', 'Sees the patient list and profiles') },
  'patients.write':  { label: t('Patsiente muuta', 'Edit patients'), description: t('Saab muuta patsiendi terviseandmeid', 'Can edit patient health data') },
  'visits.read':     { label: t('Visiite vaadata', 'View visits'), description: t('Näeb kõiki visiite kalendris', 'Sees all visits in the calendar') },
  'visits.write':    { label: t('Visiite hallata', 'Manage visits'), description: t('Saab broneerida ja muuta visiite', 'Can book and edit visits') },
  'stats.read':      { label: t('Statistikat vaadata', 'View statistics'), description: t('Näeb statistika ja aruannete lehte', 'Sees the statistics and reports page') },
  'payments.read':   { label: t('Makseid vaadata', 'View payments'), description: t('Näeb arveid ja maksete infot', 'Sees invoices and payment details') },
  'payments.write':  { label: t('Makseid hallata', 'Manage payments'), description: t('Saab märkida makstuks, luua arveid', 'Can mark as paid and create invoices') },
  'settings.read':   { label: t('Seadeid vaadata', 'View settings'), description: t('Näeb kliiniku seadeid (ei saa muuta)', 'Sees the clinic settings (cannot change them)') },
  'pipeline.write':  { label: t('Etappe muuta', 'Edit stages'), description: t('Saab lisada, eemaldada ja ümber nimetada töö etappe', 'Can add, remove and rename job stages') },
  'payroll.manage':  { label: t('Töötasusid hallata', 'Manage payroll'), description: t('Näeb kõigi tasumäärasid ja tunde, saab kinnitada ja tühistada väljamakseid', 'Sees everyone’s pay rates and hours, can confirm and cancel payouts') },
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
