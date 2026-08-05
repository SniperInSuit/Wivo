import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useLicense } from './useLicense'

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
  'jobs.read':       { label: 'Tööd vaadata',          description: 'Näeb kõiki töid tahvlil ja tabelis' },
  'jobs.write':      { label: 'Töid muuta',             description: 'Saab luua ja muuta töid' },
  'patients.read':   { label: 'Patsiente vaadata',      description: 'Näeb patsientide nimekirja ja profiile' },
  'patients.write':  { label: 'Patsiente muuta',        description: 'Saab muuta patsiendi terviseandmeid' },
  'visits.read':     { label: 'Visiite vaadata',        description: 'Näeb kõiki visiite kalendris' },
  'visits.write':    { label: 'Visiite hallata',        description: 'Saab broneerida ja muuta visiite' },
  'stats.read':      { label: 'Statistikat vaadata',    description: 'Näeb statistika ja aruannete lehte' },
  'payments.read':   { label: 'Makseid vaadata',        description: 'Näeb arveid ja maksete infot' },
  'payments.write':  { label: 'Makseid hallata',        description: 'Saab märkida makstuks, luua arveid' },
  'settings.read':   { label: 'Seadeid vaadata',        description: 'Näeb kliiniku seadeid (ei saa muuta)' },
  'pipeline.write':  { label: 'Etappe muuta',           description: 'Saab lisada, eemaldada ja ümber nimetada töö etappe' },
  'payroll.manage':  { label: 'Töötasusid hallata',     description: 'Näeb kõigi tasumäärasid ja tunde, saab kinnitada ja tühistada väljamakseid' },
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
