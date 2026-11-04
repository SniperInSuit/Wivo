/**
 * Reading clients (sql/118). Every member reads what a job shows of its
 * client — id, name, archived — from the table. The whole client (contact
 * person, e-mail, phone, address, registry code, notes, special prices,
 * payment terms) comes only from customers_full(): View jobs (the Clients
 * page) or View payments (invoices), owners and admins always.
 */
import { supabase } from './supabase'
import type { Customer } from '../types/customer'

/** The columns every member may read. */
export const CUSTOMER_BASIC_COLUMNS = 'id, clinic_id, name, archived_at' as const

/** `full` for View jobs or View payments. Without it, the rows carry only the basic columns. */
export async function fetchCustomers(full: boolean): Promise<Customer[]> {
  if (full) {
    const { data, error } = await supabase.rpc('customers_full')
    if (!error) return (data ?? []) as Customer[]
    if (error.code !== 'PGRST202' && error.code !== '42883') throw error
    // A database without sql/118: the table, whole, as before.
    const old = await supabase.from('customers').select('*').order('name', { ascending: true })
    if (old.error) throw old.error
    return (old.data ?? []) as Customer[]
  }
  const { data, error } = await supabase.from('customers').select(CUSTOMER_BASIC_COLUMNS).order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Customer[]
}
