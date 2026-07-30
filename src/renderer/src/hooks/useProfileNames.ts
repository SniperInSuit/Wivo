import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/supabase'

/**
 * Profiles by id, regardless of which clinic they now belong to.
 *
 * Needed because payroll history outlives team membership: someone removed from
 * the clinic still has payouts that were made to them, and a payslip that could
 * not name its recipient would be a worse record than no filter at all. Used
 * only to label existing history — never to offer someone as assignable.
 */
export function useProfileNames(ids: string[]) {
  const key = [...new Set(ids)].sort()

  return useQuery<Map<string, Profile>>({
    queryKey: ['profile_names', key.join(',')],
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('id', key)
      if (error) throw error
      return new Map((data as Profile[]).map(p => [p.id, p]))
    }
  })
}
