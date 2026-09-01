import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type { PaymentPlan, PaymentPlanInput } from '../types/paymentPlan'
import { planShape } from '../types/paymentPlan'
import { instalmentSchedule, scheduleProblems, splitAmount } from '@shared/billing/instalments'
import type { CreateInvoiceInput } from './useInvoices'

const QUERY_KEY = ['payment_plans']

/**
 * Every plan in the clinic, newest first. Cancelled ones included — a plan that
 * produced invoices is history, and hiding it would leave those invoices
 * belonging to nothing.
 */
export function usePaymentPlans() {
  const qc = useQueryClient()
  // Unique per mount — a realtime topic is global to the Supabase client and
  // re-subscribing to an existing topic throws. Same reason as useCustomers.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`payment-plans-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_plans' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<PaymentPlan[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_plans')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as PaymentPlan[]
    },
  })
}

/**
 * What the caller supplies beyond the plan itself: the addressee fields every
 * instalment shares, and the lines each one bills.
 */
export interface CreatePlanInput {
  plan: PaymentPlanInput
  invoice: Omit<CreateInvoiceInput, 'issue_date' | 'due_date' | 'lines'>
  lines: CreateInvoiceInput['lines']
}

/**
 * Creates the plan row AND every instalment invoice, up front.
 *
 * Up front rather than by a recurring rule because nothing runs behind a closed
 * desktop app — a rule that "fires next month" would simply never fire. Five
 * documents carrying the right dates need no scheduler to exist; only SENDING
 * them does, and that is separate work.
 *
 * NOT TRANSACTIONAL, and the order is chosen accordingly: the plan row is
 * written FIRST, so a throw halfway through leaves the invoices already created
 * pointing at a real plan — repairable. The other order leaves orphans.
 *
 * Every instalment's lines carry `job_id`. `paidForJob` credits a job from its
 * invoice LINES pro rata, so an instalment without one pays the job nothing,
 * which is exactly how a five-month plan used to leave a job 1/5 settled.
 */
export function useCreatePaymentPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plan, invoice, lines }: CreatePlanInput) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error('Kliinik puudub — maksegraafikut ei saa luua.')

      // Refuse a broken schedule rather than write a plausible wrong one — the
      // same rule publishProblems() and quoteJob's `unpriced` follow.
      const problems = scheduleProblems(planShape(plan))
      if (problems.length > 0) throw new Error(problems.join(' '))
      const schedule = instalmentSchedule(planShape(plan))
      if (schedule.length !== plan.osamakseid) {
        throw new Error('Maksegraafikut ei õnnestu koostada.')
      }

      const { data: userData } = await supabase.auth.getUser()
      const { data: created, error } = await supabase
        .from('payment_plans')
        .insert({ ...plan, clinic_id: clinicId, created_by: userData?.user?.id ?? null })
        .select()
        .single()
      if (error) throw error
      const row = created as PaymentPlan

      // Each line split by the same rule the schedule uses, so the parts add up
      // to the whole line to the cent and the last instalment absorbs the
      // remainder — never a rounding that invents money.
      const perLine = lines.map(l => splitAmount(l.qty * l.unit_price, plan.osamakseid))
      let firstInvoiceId: string | null = null

      for (const part of schedule) {
        const k = part.no - 1
        const { data: numberData, error: numErr } =
          await supabase.rpc('next_invoice_number', { p_clinic: clinicId })
        if (numErr) throw numErr

        const { data: inv, error: invErr } = await supabase
          .from('invoices')
          .insert({
            ...invoice,
            clinic_id: clinicId,
            number: numberData as string,
            issue_date: part.issueDate,
            due_date: part.dueDate,
            payment_plan_id: row.id,
            instalment_no: part.no,
            note: [invoice.note, `Osamakse ${part.no}/${plan.osamakseid}`]
              .filter(Boolean).join(' · '),
            created_by: userData?.user?.id ?? null,
          })
          .select()
          .single()
        if (invErr) throw invErr

        const { error: lineErr } = await supabase.from('invoice_lines').insert(
          lines.map((l, i) => ({
            ...l,
            invoice_id: (inv as { id: string }).id,
            description: `${l.description} — osamakse ${part.no}/${plan.osamakseid}`,
            qty: 1,
            unit_price: perLine[i][k] ?? 0,
            sort_order: i,
          }))
        )
        if (lineErr) throw lineErr
        if (part.no === 1) firstInvoiceId = (inv as { id: string }).id
      }
      // The first instalment's id so the caller can open the document it just
      // made, rather than the plan row nobody has a screen for yet.
      return { plan: row, firstInvoiceId }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useUpdatePaymentPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<PaymentPlan> }) => {
      const { data, error } = await supabase
        .from('payment_plans')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as PaymentPlan
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

/**
 * Stops a plan: the row goes 'tuhistatud' and every instalment that has had
 * NOTHING paid against it is cancelled with it.
 *
 * An instalment that has taken money is left exactly as it is.
 * `payments_amount_positive` (sql/020) means a receipt cannot be reversed, so
 * cancelling is a stop and never a refund — a refund is a business decision and
 * its own piece of work.
 */
export function useCancelPaymentPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: rows, error } = await supabase
        .from('invoices')
        .select('id, payments(amount)')
        .eq('payment_plan_id', id)
        .neq('status', 'tuhistatud')
      if (error) throw error

      const untouched = (rows ?? []).filter(r => {
        const paid = ((r as { payments?: { amount: number }[] }).payments ?? [])
          .reduce((s, p) => s + Number(p.amount), 0)
        return paid <= 0.005
      })
      if (untouched.length > 0) {
        const { error: cancelErr } = await supabase
          .from('invoices')
          .update({ status: 'tuhistatud', updated_at: new Date().toISOString() })
          .in('id', untouched.map(r => (r as { id: string }).id))
        if (cancelErr) throw cancelErr
      }

      const { error: planErr } = await supabase
        .from('payment_plans')
        .update({ staatus: 'tuhistatud', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (planErr) throw planErr
      return { cancelled: untouched.length }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
    },
  })
}
