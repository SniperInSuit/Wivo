import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { PatientTooth, ManualToothStatus } from '../types/teeth'

const QUERY_KEY = ['patient_teeth']

// --- Fetch every manual tooth override + subscribe to realtime changes ---
// The whole table is fetched and grouped in memory, exactly like jobs and
// patients — no `.eq()` filtering exists anywhere in the app, and one row per
// manually marked tooth stays tiny for a single-lab dataset.
export function usePatientTeeth() {
  const qc = useQueryClient()

  // Unique per mount — a shared topic throws on the second subscriber.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`patient-teeth-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_teeth' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<PatientTooth[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patient_teeth')
        .select('*')
        .order('fdi', { ascending: true })
      if (error) throw error
      return data as PatientTooth[]
    }
  })
}

export interface SetToothStatusInput {
  patient_id: string
  fdi: number
  staatus: ManualToothStatus
  markus?: string | null
}

export interface ClearToothStatusInput {
  patient_id: string
  fdi: number
}

// --- Set (or overwrite) one manual tooth status ---
export function useSetToothStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ patient_id, fdi, staatus, markus = null }: SetToothStatusInput) => {
      const row = { patient_id, fdi, staatus, markus, updated_at: new Date().toISOString() }
      // onConflict must name BOTH key columns — the primary key is composite
      // (patient_id, fdi). Without it PostgREST looks for an `id` column and
      // the second click on the same tooth fails instead of updating.
      const { data, error } = await supabase
        .from('patient_teeth')
        .upsert(row, { onConflict: 'patient_id,fdi' })
        .select()
        .single()
      if (error) throw error
      return data as PatientTooth
    },
    // Optimistic — the chart is click-heavy and a round-trip per tooth reads as
    // a broken button. Same triad as the board's drag-drop update in useJobs.
    onMutate: async ({ patient_id, fdi, staatus, markus = null }: SetToothStatusInput) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const previous = qc.getQueryData<PatientTooth[]>(QUERY_KEY)
      const optimistic: PatientTooth = {
        patient_id, fdi, staatus, markus, updated_at: new Date().toISOString()
      }
      qc.setQueryData<PatientTooth[]>(QUERY_KEY, (old) => [
        ...(old ?? []).filter(t => !(t.patient_id === patient_id && t.fdi === fdi)),
        optimistic
      ])
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

// --- Clear a manual override (DELETE, not a status value) ---
// Removing the row is what returns the tooth to its derived state — there is no
// 'derived' status to write back.
export function useClearToothStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ patient_id, fdi }: ClearToothStatusInput) => {
      const { error } = await supabase
        .from('patient_teeth')
        .delete()
        .eq('patient_id', patient_id)
        .eq('fdi', fdi)
      if (error) throw error
    },
    onMutate: async ({ patient_id, fdi }: ClearToothStatusInput) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const previous = qc.getQueryData<PatientTooth[]>(QUERY_KEY)
      qc.setQueryData<PatientTooth[]>(QUERY_KEY, (old) =>
        (old ?? []).filter(t => !(t.patient_id === patient_id && t.fdi === fdi))
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
