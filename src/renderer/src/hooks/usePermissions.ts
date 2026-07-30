import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export type PermissionKey =
  | 'jobs.read' | 'jobs.write'
  | 'patients.read' | 'patients.write'
  | 'visits.read' | 'visits.write'
  | 'stats.read'
  | 'payments.read' | 'payments.write'
  | 'settings.read'
  | 'pipeline.write'

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
    if (role === 'owner') return true
    if (role === 'patient') {
      // Patients can only view their own visits
      return perm === 'visits.read'
    }
    // Worker: check the DB rows, default to false if not explicitly granted
    const row = rows.find(r => r.permission === perm)
    return row?.granted ?? false
  }

  return { can, role, isOwner: role === 'owner' }
}
