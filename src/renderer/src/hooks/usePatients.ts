import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type { Patient, PatientInput } from '../types/patient'

const QUERY_KEY = ['patients']
const JOBS_KEY = ['jobs']

// --- Fetch all patients + subscribe to realtime changes ---
export function usePatients() {
  const qc = useQueryClient()

  // A realtime topic is global to the Supabase client: .channel(topic) returns
  // the EXISTING channel for a topic already in use, and .on('postgres_changes')
  // throws once that channel is subscribed. Two components call this hook
  // (PatientsView and the PatientPicker inside JobDetailPanel) and both can be
  // mounted at once, so the topic must be unique per mount or the second one
  // throws in its effect and takes the whole app down.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`patients-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Patient[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .order('nimi', { ascending: true })
      if (error) throw error
      return data as Patient[]
    }
  })
}

// --- Create a new patient ---
export function useCreatePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PatientInput) => {
      const { data, error } = await supabase.from('patients').insert({ ...input, clinic_id: getActiveClinicId() }).select().single()
      if (error) throw error
      return data as Patient
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

// --- Update an existing patient ---
export function useUpdatePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Patient> & { id: string }) => {
      const { data, error } = await supabase
        .from('patients')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Patient
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      // A renamed patient changes the name shown on every linked job
      qc.invalidateQueries({ queryKey: JOBS_KEY })
    }
  })
}

// --- Delete a patient (linked jobs keep their patsient name, patient_id → null) ---
export function useDeletePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('patients').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: JOBS_KEY })
    }
  })
}

export interface BackfillResult {
  created: number   // new patient records created from job names
  linked: number    // jobs that got a patient_id
}

// --- One-off backfill: turn every distinct `jobs.patsient` string into a real
//     patient record and link the jobs to it. Safe to run repeatedly — jobs that
//     already have a patient_id are skipped, and existing names are reused. ---
export function useBackfillPatients() {
  const qc = useQueryClient()
  return useMutation<BackfillResult>({
    mutationFn: async () => {
      const [{ data: jobRows, error: jobErr }, { data: patRows, error: patErr }] = await Promise.all([
        supabase.from('jobs').select('id, patsient, patient_id'),
        supabase.from('patients').select('id, nimi')
      ])
      if (jobErr) throw jobErr
      if (patErr) throw patErr

      const key = (s: string) => s.trim().toLowerCase()
      const byName = new Map<string, string>()  // lower(nimi) → patient id
      ;(patRows ?? []).forEach((p: { id: string; nimi: string }) => byName.set(key(p.nimi), p.id))

      const unlinked = (jobRows ?? []).filter(
        (j: { patsient: string | null; patient_id: string | null }) => !j.patient_id && j.patsient?.trim()
      ) as { id: string; patsient: string; patient_id: string | null }[]

      // 1. Create a patient for every name that has no record yet.
      //    Deduped on the folded key, not the raw string: "Katrin Mägi" and
      //    "katrin mägi" are one patient, and inserting both would leave a
      //    duplicate row with zero jobs attached (step 2 links every spelling to
      //    whichever row was inserted last).
      const missingByKey = new Map<string, string>()   // folded key → first spelling seen
      unlinked.forEach(j => {
        const nimi = j.patsient.trim()
        const k = key(nimi)
        if (!byName.has(k) && !missingByKey.has(k)) missingByKey.set(k, nimi)
      })
      const missing = [...missingByKey.values()]
      let created = 0
      if (missing.length > 0) {
        const { data: inserted, error } = await supabase
          .from('patients')
          .insert(missing.map(nimi => ({ nimi, clinic_id: getActiveClinicId() })))
          .select('id, nimi')
        if (error) throw error
        ;(inserted ?? []).forEach((p: { id: string; nimi: string }) => byName.set(key(p.nimi), p.id))
        created = inserted?.length ?? 0
      }

      // 2. Link each unlinked job to its patient record
      let linked = 0
      for (const job of unlinked) {
        const pid = byName.get(key(job.patsient))
        if (!pid) continue
        const { error } = await supabase.from('jobs').update({ patient_id: pid }).eq('id', job.id)
        if (error) throw error
        linked++
      }

      return { created, linked }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: JOBS_KEY })
    }
  })
}
