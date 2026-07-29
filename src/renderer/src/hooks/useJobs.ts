import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Job, JobInput } from '../types/job'

const QUERY_KEY = ['jobs']

// --- Fetch all jobs + subscribe to realtime changes ---
export function useJobs() {
  const qc = useQueryClient()

  // Subscribe to Postgres changes so all connected instances stay in sync
  useEffect(() => {
    const channel = supabase
      .channel('jobs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc])

  return useQuery<Job[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Job[]
    }
  })
}

// --- Create a new job ---
export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: JobInput) => {
      const { data, error } = await supabase.from('jobs').insert(input).select().single()
      if (error) throw error
      return data as Job
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

// --- Update an existing job ---
export function useUpdateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Job> & { id: string }) => {
      const { data, error } = await supabase
        .from('jobs')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Job
    },
    // Optimistic update for drag-drop stage changes
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const previous = qc.getQueryData<Job[]>(QUERY_KEY)
      if (status) {
        qc.setQueryData<Job[]>(QUERY_KEY, (old) =>
          old ? old.map((j) => (j.id === id ? { ...j, status } : j)) : old
        )
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

// --- Delete a job ---
export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('jobs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
