/**
 * Stock and inventory, through sql/093–094.
 *
 * Reads go through RLS (`stock_levels`, `stock_movement`, the inventory
 * tables): the clinic's own rows, with `stock.read`. Every write is an RPC.
 * A partner's view of its own goods is `partner_stock()` — totals only.
 *
 * On a database without sql/093 the table and functions do not exist; the
 * hooks then answer with empty lists, like usePartners does.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { ProductLevel, StockLevel } from '../lib/stockWarnings'

const notInstalled = (code: string | undefined): boolean =>
  code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883'

export interface StockMovement {
  id: string
  item_id: string
  kind: 'in' | 'use' | 'return' | 'buy' | 'adjust' | 'writeoff'
  delta: number
  job_id: string | null
  reason: string | null
  reason_code: 'damaged' | 'expired' | 'opened' | 'returned' | null
  expired_override: boolean
  count_id: string | null
  by_user: string | null
  at: string
}

export interface PartnerStockRow {
  item_id: string
  location_org: string
  location_name: string
  category: StockLevel['category']
  manufacturer: string | null
  system: string | null
  size: string | null
  product: string | null
  lot: string
  expiry_date: string
  consignment_due: string | null
  received: number
  used: number
  returned: number
  bought: number
  written_off: number
  adjusted: number
  remaining: number
}

export interface InventorySchedule {
  interval_months: number
  next_due: string
}

export interface InventoryCount {
  id: string
  started_at: string
  finished_at: string
  by_user: string | null
  lines: { item_id: string; expected: number; counted: number; reason: string | null }[]
}

export function useStockLevels(enabled = true) {
  const { clinicId } = useAuth()
  return useQuery<StockLevel[]>({
    queryKey: ['stock', 'levels', clinicId],
    enabled: !!clinicId && enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_levels').select('*').order('category').order('manufacturer')
      if (error) {
        if (notInstalled(error.code)) return []
        throw error
      }
      return (data ?? []) as StockLevel[]
    },
  })
}

/** Each product (the same reference across lots): total, lots in stock, threshold. */
export function useStockProducts(enabled = true) {
  const { clinicId } = useAuth()
  return useQuery<ProductLevel[]>({
    queryKey: ['stock', 'products', clinicId],
    enabled: !!clinicId && enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_product_levels').select('*')
      if (error) {
        if (notInstalled(error.code)) return []
        throw error
      }
      return (data ?? []) as ProductLevel[]
    },
  })
}

export function useStockMovements(itemId: string | null) {
  return useQuery<StockMovement[]>({
    queryKey: ['stock', 'movements', itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_movement').select('*').eq('item_id', itemId!).order('at', { ascending: false })
      if (error) throw error
      return (data ?? []) as StockMovement[]
    },
  })
}

export function usePartnerStock() {
  const { clinicId } = useAuth()
  return useQuery<PartnerStockRow[]>({
    queryKey: ['stock', 'partner', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('partner_stock')
      if (error) {
        if (notInstalled(error.code)) return []
        throw error
      }
      return (data ?? []) as PartnerStockRow[]
    },
  })
}

export function useInventorySchedule(enabled = true) {
  const { clinicId } = useAuth()
  return useQuery<InventorySchedule | null>({
    queryKey: ['stock', 'schedule', clinicId],
    enabled: !!clinicId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_schedule').select('interval_months, next_due').maybeSingle()
      if (error) {
        if (notInstalled(error.code)) return null
        throw error
      }
      return (data ?? null) as InventorySchedule | null
    },
  })
}

export function useInventoryHistory() {
  const { clinicId } = useAuth()
  return useQuery<InventoryCount[]>({
    queryKey: ['stock', 'counts', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_count')
        .select('id, started_at, finished_at, by_user, lines:inventory_count_line(item_id, expected, counted, reason)')
        .order('finished_at', { ascending: false }).limit(20)
      if (error) {
        if (notInstalled(error.code)) return []
        throw error
      }
      return (data ?? []) as InventoryCount[]
    },
  })
}

/** Any stock RPC; afterwards everything stock-related is read again. */
export function useStockAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      return data as unknown
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['stock'] }),
  })
}
