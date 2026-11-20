import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type { Job, JobInput } from '../types/job'
import {
  JOBS_WITH_PAY_STAGES, PAY_STAGE_FILTER, payStagesUnavailable, withPayStages,
  payStagesKnownUnavailable, markPayStagesUnavailable,
} from '../lib/jobPayStages'

const QUERY_KEY = ['jobs']

// --- Fetch all jobs + subscribe to realtime changes ---
export function useJobs() {
  const qc = useQueryClient()

  // Subscribe to Postgres changes so all connected instances stay in sync
  // Unique per mount — a shared topic throws on the second subscriber.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`jobs-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Job[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      // With the stages that carry a pay kind (§10, lib/jobPayStages). A
      // database older than sql/124 has none to give; the jobs are then read
      // alone, which pays every job by today's rule, as that database must.
      if (!payStagesKnownUnavailable()) {
        const { data, error } = await supabase
          .from('jobs')
          .select(JOBS_WITH_PAY_STAGES)
          .not(...PAY_STAGE_FILTER)
          .order('created_at', { ascending: false })
        if (!error) return (data as unknown as Record<string, unknown>[]).map(withPayStages)
        if (!payStagesUnavailable(error)) throw error
        markPayStagesUnavailable()
      }
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
/**
 * Fields the DATABASE owns. `job_code` is numbered by a trigger (sql/070) and
 * unique; a payload built by spreading an existing job — "Duplicate" does
 * exactly that — would otherwise send the original's code and be refused.
 */
export function withoutDbOwned<T extends object>(row: T): T {
  // `pay_stages` is read with the job (lib/jobPayStages), not a column: a form
  // filled by spreading a loaded job carries it, and the save would be refused.
  const { job_code: _code, pay_stages: _stages, ...rest } = row as T & { job_code?: unknown; pay_stages?: unknown }
  return rest as T
}

export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: JobInput) => {
      const { data, error } = await supabase.from('jobs').insert({ ...withoutDbOwned(input), clinic_id: getActiveClinicId() }).select().single()
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
        .update({ ...withoutDbOwned(patch), updated_at: new Date().toISOString() })
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
