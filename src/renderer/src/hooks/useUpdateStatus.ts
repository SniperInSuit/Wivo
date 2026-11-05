import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { fetchUpdateStatus, type UpdateStatus } from '../lib/updateStatus'

/**
 * The update state for approvers (lib/updateStatus): null for everyone else
 * and in a project that isn't a clinic's own instance. Checked again hourly,
 * so the warning appears on a desktop left open when the list expires.
 */
export function useUpdateStatus(): UpdateStatus | null {
  const { user, status, role } = useAuth()
  const { data } = useQuery({
    queryKey: ['update-status', user?.id],
    queryFn: fetchUpdateStatus,
    enabled: status === 'authenticated' && (role === 'owner' || role === 'worker'),
    staleTime: 5 * 60_000,
    refetchInterval: 60 * 60_000,
  })
  return data ?? null
}
