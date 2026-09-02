import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type {
  WorkerRate, WorkerRateInput, WorkHours, WorkHoursInput, EarningLine
} from '../lib/earnings'

const RATES_KEY   = ['worker_rates']
const HOURS_KEY   = ['work_hours']
const PAYOUTS_KEY = ['worker_payouts']

export interface WorkerPayoutLine {
  id: string
  payout_id: string
  job_id: string | null
  revision_id: string | null
  work_hours_id: string | null
  kind: string
  description: string
  qty: number
  rate: number
  amount: number
  /**
   * WHICH line of the job this was — 'design:<job>', 'extra:<rule>:<job>' and
   * so on (migration 058). Null on anything paid before that column existed;
   * `payoutLineKey` falls back to reading the description for those.
   *
   * It exists because the key cannot be reconstructed from the other columns:
   * a job produces up to ten distinct payable lines and only four of their key
   * shapes were recoverable, so the other six came back as unpaid after a
   * payout and could be paid a second time.
   */
  line_key: string | null
}

export interface WorkerPayout {
  id: string
  clinic_id: string
  profile_id: string
  period_start: string
  period_end: string
  total: number
  status: 'kinnitatud' | 'makstud'
  paid_at: string | null
  note: string | null
  created_by: string | null
  created_at: string
  lines: WorkerPayoutLine[]
}

// ── Rates ────────────────────────────────────────────────────────────────────

export function useWorkerRates() {
  const qc = useQueryClient()
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`worker-rates-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_rates' }, () => {
        qc.invalidateQueries({ queryKey: RATES_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<WorkerRate[]>({
    queryKey: RATES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('worker_rates')
        .select('*')
        .order('priority', { ascending: false })
      if (error) throw error
      return data as WorkerRate[]
    }
  })
}

export function useSaveWorkerRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rate: WorkerRateInput & { id?: string }) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub.')
      if (rate.id) {
        const { id, ...patch } = rate
        const { data, error } = await supabase
          .from('worker_rates')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id).select().single()
        if (error) throw error
        return data as WorkerRate
      }
      const { data, error } = await supabase
        .from('worker_rates')
        .insert({ ...rate, clinic_id: clinicId })
        .select().single()
      if (error) throw error
      return data as WorkerRate
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RATES_KEY })
  })
}

export function useDeleteWorkerRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('worker_rates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: RATES_KEY })
  })
}

// ── Hours ────────────────────────────────────────────────────────────────────

export function useWorkHours() {
  const qc = useQueryClient()
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`work-hours-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_hours' }, () => {
        qc.invalidateQueries({ queryKey: HOURS_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<WorkHours[]>({
    queryKey: HOURS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_hours')
        .select('*')
        .order('work_date', { ascending: false })
      if (error) throw error
      return data as WorkHours[]
    }
  })
}

export function useAddWorkHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: WorkHoursInput) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub.')
      const { data: userData } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('work_hours')
        .insert({ ...input, clinic_id: clinicId, recorded_by: userData?.user?.id ?? null })
        .select().single()
      if (error) throw error
      return data as WorkHours
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: HOURS_KEY })
  })
}

export function useDeleteWorkHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('work_hours').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: HOURS_KEY })
  })
}

// ── Payouts ──────────────────────────────────────────────────────────────────

export function useWorkerPayouts() {
  const qc = useQueryClient()
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`worker-payouts-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_payouts' }, () => {
        qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<WorkerPayout[]>({
    queryKey: PAYOUTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('worker_payouts')
        .select('*, lines:worker_payout_lines(*)')
        .order('period_end', { ascending: false })
      if (error) throw error
      return (data as WorkerPayout[]).map(p => ({ ...p, lines: p.lines ?? [] }))
    }
  })
}

/**
 * Freeze a period's earnings into a payout.
 *
 * The lines are COPIED, not referenced. Once someone has been paid, changing
 * their rate or editing a job must not restate what they were paid — that is a
 * payroll dispute, not a recalculation. Same rule the invoices follow.
 */
export function useCreatePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      profile_id: string
      period_start: string
      period_end: string
      lines: EarningLine[]
      note?: string | null
    }) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub.')
      if (input.lines.length === 0) throw new Error('Sellel perioodil ei ole midagi välja maksta.')

      const total = Math.round(input.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
      const { data: userData } = await supabase.auth.getUser()

      const { data: payout, error } = await supabase
        .from('worker_payouts')
        .insert({
          clinic_id: clinicId,
          profile_id: input.profile_id,
          period_start: input.period_start,
          period_end: input.period_end,
          total,
          note: input.note ?? null,
          created_by: userData?.user?.id ?? null,
        })
        .select().single()
      if (error) throw error

      const { error: lineError } = await supabase.from('worker_payout_lines').insert(
        input.lines.map(l => ({
          payout_id: (payout as WorkerPayout).id,
          job_id: l.job_id,
          revision_id: l.revision_id,
          work_hours_id: l.work_hours_id,
          kind: l.kind,
          description: l.description,
          qty: l.qty,
          rate: l.rate,
          amount: l.amount,
          // The whole point of migration 058: the frozen line says what it was,
          // so the next reckoning knows it is already covered.
          line_key: l.key,
        }))
      )
      if (lineError) throw lineError
      return payout as WorkerPayout
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
  })
}

export function useUpdatePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<WorkerPayout> & { id: string }) => {
      const { data, error } = await supabase
        .from('worker_payouts').update(patch).eq('id', id).select().single()
      if (error) throw error
      return data as WorkerPayout
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
  })
}

export function useDeletePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('worker_payouts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
  })
}

/**
 * Keys already frozen into a payout, so a preview never offers them twice.
 *
 * Reads `line_key` (migration 058). It used to RECONSTRUCT the key from
 * `job_id`, `revision_id` and `kind`, which cannot be done: one job yields up
 * to ten payable lines and only four of those key shapes were recoverable.
 * Design, model and every additive line came back as `job:<id>` — a key they
 * never had — so a confirmed payout did not cover them and the next
 * confirmation paid them AGAIN. Seen live: a 42-line payout, and seven design
 * lines worth 135 € standing unpaid immediately afterwards, all seven already
 * inside it.
 *
 * `rates` is only for reading old rows: an additive line's description starts
 * with the RULE's label, which is free text, so the labels have to be looked up
 * to recognise one.
 */
export function paidKeysFrom(
  payouts: WorkerPayout[], profileId: string, rates: WorkerRate[] = [],
): Set<string> {
  const keys = new Set<string>()
  for (const p of payouts) {
    if (p.profile_id !== profileId) continue
    for (const l of p.lines) {
      keys.add(l.line_key ?? legacyLineKey(l, p.period_start, rates))
    }
  }
  return keys
}

/**
 * The key for a line paid before migration 058, read back out of its
 * description. The descriptions are generated by `lib/earnings`, so the
 * prefixes are exact — but an additive rule's label is the user's own words,
 * which is why the rules have to be consulted for that one case.
 *
 * Deliberately biased: anything unrecognised keeps the old `job:<id>` answer.
 * That can let one legacy duplicate through once more, which is the lesser
 * error — guessing the other way would mark a line as paid that never was, and
 * somebody would simply not be paid.
 */
function legacyLineKey(
  l: WorkerPayoutLine, periodStart: string, rates: WorkerRate[],
): string {
  if (l.work_hours_id) return `hours:${l.work_hours_id}`
  if (l.kind === 'kuu' && !l.job_id) return `salary:${periodStart}`
  if (!l.job_id) return `line:${l.id}`

  const d = l.description ?? ''
  const extraRuleId = additiveRuleIdIn(d, rates)

  if (l.revision_id) {
    if (d.startsWith('Disain, muudatus')) return `revdesign:${l.job_id}:${l.revision_id}`
    if (d.startsWith('Mudel, muudatus'))  return `revmudel:${l.job_id}:${l.revision_id}`
    if (extraRuleId) return `extra:${extraRuleId}:${l.job_id}:${l.revision_id}`
    return `rev:${l.job_id}:${l.revision_id}`
  }
  if (d.startsWith('Disain: ')) return `design:${l.job_id}`
  if (d.startsWith('Mudel · '))  return `mudel:${l.job_id}`
  if (extraRuleId) return `extra:${extraRuleId}:${l.job_id}`
  return `job:${l.job_id}`
}

/** The additive rule whose label opens this description, if any. */
function additiveRuleIdIn(description: string, rates: WorkerRate[]): string | null {
  for (const r of rates) {
    if (!r.additive) continue
    const label = (r.label ?? '').trim()
    if (!label) continue
    // 'Hamba Disain: Kroon · Mari' and 'Hamba Disain (muudatus #1) · Mari'.
    if (description.startsWith(`${label}: `) || description.startsWith(`${label} (muudatus`)) {
      return r.id
    }
  }
  return null
}
