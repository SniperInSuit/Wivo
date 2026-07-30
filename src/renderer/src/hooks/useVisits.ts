import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type { Visit, VisitInput } from '../types/visit'

const QUERY_KEY = ['visits']

// --- Fetch all visits + subscribe to realtime changes ---
export function useVisits() {
  const qc = useQueryClient()

  // Unique per mount: a realtime topic is global to the Supabase client, and
  // .on('postgres_changes') throws once a channel with that topic is subscribed.
  // A shared topic is what took the whole app down in 1.1.4.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`visits-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Visit[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('*')
        .order('algus', { ascending: true })
      if (error) throw error
      return data as Visit[]
    }
  })
}

export function useCreateVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: VisitInput) => {
      const { data, error } = await supabase.from('visits').insert({ ...input, clinic_id: getActiveClinicId() }).select().single()
      if (error) throw error
      return data as Visit
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Visit> & { id: string }) => {
      const { data, error } = await supabase
        .from('visits')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Visit
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useDeleteVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('visits').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
