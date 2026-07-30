import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * The people currently in THIS clinic, for assignment pickers and payroll.
 *
 * The clinic filter is load-bearing, not a nicety. The `profiles_read` policy
 * lets any authenticated user select every profile row in the project, so
 * without it this returned people who had been removed from the team, and
 * anyone belonging to another clinic — all of them offered as a technician to
 * assign work to.
 *
 * Patients-as-users are excluded too: they are people with a login, not staff.
 */
export function useClinicProfiles() {
  const { clinicId } = useAuth()

  return useQuery<Profile[]>({
    queryKey: ['clinic_profiles', clinicId],
    enabled: !!clinicId,
    // Rarely changes and read by several screens; a short window avoids each
    // of them firing its own request on mount.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!clinicId) return []
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('clinic_id', clinicId)
        .in('role', ['owner', 'worker'])
        .order('full_name', { ascending: true })
      if (error) throw error
      return data as Profile[]
    }
  })
}
