/**
 * This clinic's updates, from its own project (sql/119 update_status();
 * docs/ARCHITECTURE-INSTANCES.md 5b, 5g). Only an approver gets an answer:
 * the owner, or a member with Install updates. Null for anyone else, in a
 * project that isn't a clinic's own instance (production and the test copy
 * today), and in a database without sql/119.
 */
import { supabase } from './supabase'
import type { IndexEntry } from '@shared/release/release'

export interface UpdateStatus {
  channel: 'stable' | 'test'
  installed: { version: string; at: string } | null
  /** The freshest list accepted from a key still trusted. */
  list: {
    key_id: string
    serial: number
    expires: string
    checked_at: string
    content: {
      versions: IndexEntry[]
      withdrawn: { version: string; reason: string }[]
      app?: { version: string; file: string; sha512: string; size: number }
    } | null
  } | null
  /** No unexpired list, by the database's clock: installs wait, and approvers are warned. */
  stale: boolean
  last_check: { at: string; result: 'accepted' | 'refused'; reason: string | null } | null
  installs: {
    at: string; from?: string; to: string; mode: 'setup' | 'manual' | 'automatic'
    by?: string; result: 'installed' | 'refused' | 'failed'; reason?: string
  }[]
  keys: { key_id: string; accepted_at: string }[]
}

export async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  const { data, error } = await supabase.rpc('update_status')
  // A database without sql/119: no updates to show.
  if (error?.code === 'PGRST202') return null
  if (error) throw error
  return (data as UpdateStatus | null) ?? null
}
