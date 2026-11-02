/**
 * Stock that needs attention, wherever the app is open: the count on the
 * sidebar's Stock item, and the stock-warning sound (spec, Sounds:
 * `notify-stock-warning` — "stock under its minimum, or consignment goods
 * turning red a month before they are due"; expiring goods too).
 *
 * The sound plays once per warning: what was already announced is kept per
 * user in localStorage, so a refresh or a restart does not sound again. A
 * warning that clears and comes back is announced again.
 */
import { useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from './usePermissions'
import { useStockLevels } from './useStock'
import { stockWarnings, freshWarnings } from '../lib/stockWarnings'
import { playSound } from '../lib/sound'

const key = (userId: string) => `wivo_stock_alerted:${userId}`

function readSeen(userId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key(userId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function useStockAlerts(): number {
  const { user } = useAuth()
  const { can } = usePermissions()
  const allowed = can('stock.read')
  const { data: rows } = useStockLevels(allowed)
  // Recomputed with the data; "today" moves on with the five-minute refetch.
  const warnings = useMemo(() => (rows ? stockWarnings(rows, new Date()) : []), [rows])

  useEffect(() => {
    if (!allowed || !rows || !user) return
    const { fresh, nextSeen } = freshWarnings(warnings, readSeen(user.id))
    if (fresh.length > 0) playSound('notify-stock-warning')
    try { localStorage.setItem(key(user.id), JSON.stringify([...nextSeen])) } catch { /* private mode: it sounds again next time */ }
  }, [allowed, rows, user, warnings])

  return allowed ? new Set(warnings.map(w => w.itemId)).size : 0
}
