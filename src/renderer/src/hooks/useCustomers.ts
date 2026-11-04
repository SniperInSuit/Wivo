import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import { fetchCustomers } from '../lib/customersRead'
import { usePermissions } from './usePermissions'
import type { Customer, CustomerInput } from '../types/customer'

const QUERY_KEY = ['customers']

/**
 * All customers, archived included — the caller filters.
 *
 * Archived ones are still fetched because history needs their names: a job or
 * an invoice from two years ago points at a customer who may no longer be
 * active, and a picker hiding them would render that history nameless.
 *
 * Whole rows only for View jobs or View payments (owners and admins always);
 * everyone else gets id, name and archived — what a job shows (sql/118).
 */
export function useCustomers() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const full = can('jobs.read') || can('payments.read')
  // Unique per mount: a realtime topic is global to the Supabase client, so two
  // components using this hook at once would otherwise collide on the topic and
  // the second `.on()` throws. Same reason as usePatients.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`customers-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Customer[]>({
    queryKey: [...QUERY_KEY, full ? 'full' : 'basic'],
    queryFn: () => fetchCustomers(full),
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    // Nothing read back: the details are not readable from the table (sql/118).
    mutationFn: async (input: CustomerInput) => {
      const { error } = await supabase
        .from('customers')
        .insert({ ...input, clinic_id: getActiveClinicId() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CustomerInput> }) => {
      const { error } = await supabase
        .from('customers')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/**
 * Archive, not delete.
 *
 * A customer with invoices behind them is history. `jobs.customer_id` and
 * `invoices.customer_id` are both `on delete set null`, so a real delete would
 * quietly orphan every job and document that named them. Archiving keeps the
 * link and stops the customer being offered.
 */
export function useArchiveCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from('customers')
        .update({
          archived_at: archived ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/**
 * Hard delete. Refused by the caller when the customer has any history — see
 * the archive note above. Kept for the "typed the wrong name, no work yet" case.
 */
export function useDeleteCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
