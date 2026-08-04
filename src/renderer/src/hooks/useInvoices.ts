import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type {
  Invoice, InvoiceFull, InvoiceLine, InvoiceLineInput, Payment, PaymentInput,
  InvoiceStatus, PaymentMethod
} from '../types/invoice'

const QUERY_KEY = ['invoices']

/**
 * Invoices with their lines and payments, in one query.
 *
 * Loaded together rather than per-invoice: the list has to show what is still
 * owed on every row, and that is a function of the payments. Fetching those
 * lazily would make the list render totals that are wrong until each row
 * happened to resolve.
 */
export function useInvoices() {
  const qc = useQueryClient()
  // Unique per mount — a realtime topic is global to the Supabase client and
  // re-subscribing to an existing topic throws (the 1.1.4 outage).
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`invoices-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_lines' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<InvoiceFull[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, lines:invoice_lines(*), payments(*)')
        .order('issue_date', { ascending: false })
        .order('number', { ascending: false })
      if (error) throw error
      return (data as InvoiceFull[]).map(inv => ({
        ...inv,
        lines: [...(inv.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order),
        payments: [...(inv.payments ?? [])].sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
      }))
    }
  })
}

export interface CreateInvoiceInput {
  patient_id: string | null
  /** The addressee's NAME. A patient's or a customer's — see types/invoice.ts. */
  patsient: string
  // Who this is billed to. The DB has a check constraint tying these together:
  // 'customer' requires customer_id, 'patient' requires it to be null.
  customer_id?: string | null
  bill_to_kind?: 'patient' | 'customer'
  period_start?: string | null
  period_end?: string | null
  issue_date: string
  due_date: string | null
  vat_rate: number
  note?: string | null
  lines: Omit<InvoiceLineInput, 'invoice_id'>[]
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub — arvet ei saa luua.')

      // The number comes from the database, not from counting rows here: two
      // workstations issuing at the same moment would both pick the same one.
      const { data: numberData, error: numberError } =
        await supabase.rpc('next_invoice_number', { p_clinic: clinicId })
      if (numberError) throw numberError

      const { data: userData } = await supabase.auth.getUser()

      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert({
          clinic_id: clinicId,
          number: numberData as string,
          patient_id: input.patient_id,
          patsient: input.patsient,
          customer_id: input.customer_id ?? null,
          bill_to_kind: input.bill_to_kind ?? 'patient',
          period_start: input.period_start ?? null,
          period_end: input.period_end ?? null,
          issue_date: input.issue_date,
          due_date: input.due_date,
          vat_rate: input.vat_rate,
          note: input.note ?? null,
          created_by: userData?.user?.id ?? null,
        })
        .select()
        .single()
      if (error) throw error

      if (input.lines.length > 0) {
        const { error: lineError } = await supabase.from('invoice_lines').insert(
          input.lines.map((l, i) => ({ ...l, invoice_id: (invoice as Invoice).id, sort_order: i }))
        )
        // The invoice exists but is empty — surfacing the error beats leaving
        // the user staring at a document that silently lost its lines.
        if (lineError) throw lineError
      }
      return invoice as Invoice
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Invoice> & { id: string }) => {
      const { data, error } = await supabase
        .from('invoices')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Invoice
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invoices').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useSetInvoiceStatus() {
  const update = useUpdateInvoice()
  return (id: string, status: InvoiceStatus) => update.mutateAsync({ id, status })
}

// ── Lines ────────────────────────────────────────────────────────────────────
// Totals are recomputed by a database trigger, so nothing here writes them.

export function useAddInvoiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (line: InvoiceLineInput) => {
      const { data, error } = await supabase.from('invoice_lines').insert(line).select().single()
      if (error) throw error
      return data as InvoiceLine
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateInvoiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<InvoiceLine> & { id: string }) => {
      const { data, error } = await supabase
        .from('invoice_lines').update(patch).eq('id', id).select().single()
      if (error) throw error
      return data as InvoiceLine
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useDeleteInvoiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invoice_lines').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

// ── Payments ─────────────────────────────────────────────────────────────────

/**
 * Every payment in the clinic, including those recorded against a JOB rather
 * than an invoice (the `makstud` route). The invoice query only ever sees its
 * own, so anything counting how money arrives has to read this instead.
 */
export function usePayments() {
  const qc = useQueryClient()
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`payments-all-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        qc.invalidateQueries({ queryKey: ['payments'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false })
      if (error) throw error
      return data as Payment[]
    }
  })
}

/**
 * Mark jobs paid: writes a payment row per job AND keeps the legacy
 * `makstud` / `makse_kuupaev` fields in step, because several screens still
 * read them. One trip through here so the two can never disagree.
 */
export function useMarkJobsPaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      /** `amount` is what is being PAID NOW; `total` is what the job is worth,
       *  so a part payment can be told apart from a full one. */
      jobs: { id: string; amount: number; total?: number }[]
      method: PaymentMethod
      paid_at: string
      reference: string | null
    }) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub — makset ei saa salvestada.')
      const { data: userData } = await supabase.auth.getUser()

      const payable = input.jobs.filter(j => j.amount > 0)
      if (payable.length > 0) {
        const { error } = await supabase.from('payments').insert(
          payable.map(j => ({
            clinic_id: clinicId,
            invoice_id: null,
            job_id: j.id,
            amount: j.amount,
            method: input.method,
            paid_at: input.paid_at,
            reference: input.reference,
            recorded_by: userData?.user?.id ?? null,
          }))
        )
        if (error) throw error
      }

      // Only jobs that are now FULLY settled get the flag. A part payment is
      // recorded as money received but leaves the job owing the rest — marking
      // it paid would hide a debt, which is the one thing this must not do.
      const settled = input.jobs.filter(j => {
        const total = j.total ?? j.amount
        return total <= 0 || j.amount >= total - 0.005
      })

      const CHUNK = 15
      for (let i = 0; i < settled.length; i += CHUNK) {
        await Promise.all(settled.slice(i, i + CHUNK).map(j =>
          supabase.from('jobs')
            .update({ makstud: true, makse_kuupaev: input.paid_at, updated_at: new Date().toISOString() })
            .eq('id', j.id)
        ))
      }
      return { settled: settled.length, partial: input.jobs.length - settled.length }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    }
  })
}

export function useAddPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PaymentInput) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub — makset ei saa salvestada.')
      const { data: userData } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('payments')
        .insert({ ...input, clinic_id: clinicId, recorded_by: userData?.user?.id ?? null })
        .select()
        .single()
      if (error) throw error
      return data as Payment
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useDeletePayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
