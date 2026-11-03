/**
 * The minimum app version that applies to me (sql/104 app_min_version_for_me),
 * or null when none is set. A read, so it works from an old build too. Read on
 * start and every 30 minutes, with the update check (docs/MIN-VERSION.md).
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Minimum } from '../lib/updatePolicy'

export const MIN_VERSION_KEY = ['app_min_version'] as const

export function useMinVersion(): Minimum | null {
  const { status } = useAuth()
  const { data = null } = useQuery<Minimum | null>({
    queryKey: MIN_VERSION_KEY,
    enabled: status === 'authenticated',
    refetchInterval: 30 * 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc('app_min_version_for_me')
      // A database before sql/104, or not signed in all the way: no minimum.
      if (error) return null
      const row = (rows as Minimum[] | null)?.[0]
      return row?.min_version ? { min_version: row.min_version, required: !!row.required } : null
    },
  })
  return data
}
