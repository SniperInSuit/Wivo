/**
 * The bell (spec, Phase 1: "realtime badges"). Rows come from `notification`
 * (sql/075), each user sees only their own, and new ones arrive over realtime
 * (sql/076) — the badge moves within seconds of the other side acting.
 */
import { useEffect, useId } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { playSound } from '../lib/sound'

export interface AppNotification {
  id: string
  job_id: string | null
  job_code: string | null
  kind: 'job_shared' | 'stage_handover' | 'question' | 'files_added' | 'stage_reached' | 'assigned'
  detail: Record<string, unknown>
  created_at: string
  read_at: string | null
}

export function useNotifications() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const channelId = useId()
  const key = ['notifications', user?.id]

  const query = useQuery<AppNotification[]>({
    queryKey: key,
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('notification')
        .select('id, job_id, job_code, kind, detail, created_at, read_at')
        .order('created_at', { ascending: false }).limit(30)
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return [] // sql/075 not applied yet
        throw error
      }
      return (data ?? []) as AppNotification[]
    },
  })

  useEffect(() => {
    if (!user?.id) return
    const ch = supabase.channel(`notifications-${user.id}-${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification', filter: `user_id=eq.${user.id}` },
        payload => {
          qc.invalidateQueries({ queryKey: ['notifications', user.id] })
          // With the bell's badge — never instead of it.
          const kind = (payload.new as { kind?: string } | undefined)?.kind
          playSound(kind === 'job_shared' || kind === 'files_added' || kind === 'assigned' ? 'notify-new-work'
            : kind === 'stage_handover' || kind === 'stage_reached' ? 'notify-handoff' : 'notify-message')
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user?.id, channelId, qc])

  const markRead = useMutation({
    mutationFn: async (ids?: string[]) => {
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const items = query.data ?? []
  return { items, unread: items.filter(n => !n.read_at).length, markRead }
}
