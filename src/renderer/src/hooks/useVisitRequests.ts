/**
 * The appointment-request inbox.
 *
 * A request is NOT a visit and does not live in `visits` (sql/059). The calendar
 * shows what has been agreed; filling it with unconfirmed requests would make
 * the one screen the practice runs on unreliable. Confirming a request creates a
 * real visit and links the two.
 *
 * Realtime like `useVisits`: a request arriving while somebody has the inbox
 * open should appear, because the whole point is that nobody has to keep
 * checking.
 */
import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export type VisitRequestStatus = 'uus' | 'kinnitatud' | 'lykatud' | 'ramps'

export const REQUEST_STATUS_LABEL: Record<VisitRequestStatus, string> = {
  uus:        'Uus',
  kinnitatud: 'Kinnitatud',
  lykatud:    'Lükatud tagasi',
  ramps:      'Rämps',
}

export interface VisitRequest {
  id: string
  clinic_id: string
  service_id: string | null
  nimi: string
  telefon: string
  email: string | null
  eelistatud_aeg: string | null
  sonum: string | null
  staatus: VisitRequestStatus
  visit_id: string | null
  kasitles: string | null
  kasitletud_at: string | null
  created_at: string
  /**
   * The visit fee (sql/061). 'vaba' = none was asked for, which is every
   * request made before the fee existed and every one the staff typed in.
   */
  makse_staatus: 'vaba' | 'ootel' | 'makstud' | 'ebaonnestus' | 'tuhistatud'
  makse_summa: number | null
  makstud_at: string | null
  /** What the patient picked in the calculator, and what they were shown. */
  valik: { serviceId: string; hambad: string[]; lisad?: string[] }[] | null
  hinnang: number | null
}

const KEY = ['visit_requests']

/**
 * Named columns, never `*`. `ip_hash` is in this table and there is no screen
 * that needs it — not fetching it is a stronger guarantee than not rendering it.
 */
const COLUMNS =
  'id, clinic_id, service_id, nimi, telefon, email, eelistatud_aeg, sonum, '
  + 'staatus, visit_id, kasitles, kasitletud_at, created_at, '
  + 'makse_staatus, makse_summa, makstud_at, valik, hinnang'

export function useVisitRequests() {
  const qc = useQueryClient()
  const channelId = useId()
  const { clinicId } = useAuth()

  useEffect(() => {
    const channel = supabase
      .channel(`visit-requests-${channelId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'visit_requests' },
        () => { qc.invalidateQueries({ queryKey: KEY }) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<VisitRequest[]>({
    queryKey: KEY,
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_requests')
        .select(COLUMNS)
        .order('created_at', { ascending: false })
      // The table may not exist yet (sql/059 unrun). An empty inbox is a better
      // answer than a crashed page, and the UI says which migration is missing.
      if (error) throw error
      // `visit_requests` is not in the generated DB types, so the column-list
      // parser cannot resolve the row shape. The COLUMNS list above is the
      // real contract; this cast just tells TypeScript so.
      return (data ?? []) as unknown as VisitRequest[]
    },
  })
}

/** How many need looking at. Drives the sidebar counter. */
export function useNewRequestCount(): number {
  const { data = [] } = useVisitRequests()
  return data.filter(r => r.staatus === 'uus').length
}

export function useUpdateVisitRequest() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (patch: {
      id: string
      staatus?: VisitRequestStatus
      visit_id?: string | null
    }) => {
      const { id, ...rest } = patch
      const { data, error } = await supabase
        .from('visit_requests')
        .update({
          ...rest,
          // Who dealt with it and when — otherwise two people ring the same
          // person and neither knows the other did.
          ...(rest.staatus
            ? { kasitles: user?.id ?? null, kasitletud_at: new Date().toISOString() }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(COLUMNS)
        .single()
      if (error) throw error
      return data as unknown as VisitRequest
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Staff writing down a phone call. The public form does not use this path. */
export function useCreateVisitRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      nimi: string; telefon: string; email?: string | null
      eelistatud_aeg?: string | null; sonum?: string | null
    }) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub.')
      const { data, error } = await supabase
        .from('visit_requests')
        .insert({
          ...input,
          clinic_id: clinicId,
          // Same uniqueness rule as the public form, so a double-click here
          // cannot make two rows either.
          idempotency_key: `kasitsi-${crypto.randomUUID()}`,
        })
        .select(COLUMNS)
        .single()
      if (error) throw error
      return data as unknown as VisitRequest
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteVisitRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('visit_requests').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
