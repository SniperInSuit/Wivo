/**
 * Is something open that an update restart (desktop) or reload (phone) would
 * cut off? docs/MIN-VERSION.md: never while a form has unsaved input or an
 * upload, download or print is running.
 *
 * Forms hold the restart while they are open or have unsaved input
 * (useHoldRestart); uploads come from the queue; downloads, prints and PDFs
 * from the desktop's main process (main/busy.ts).
 */
import { useEffect } from 'react'
import { activeUploads } from './uploadQueue'

const holds = new Set<symbol>()

/** Holds the restart while `active` (a form open, a camera on). */
export function useHoldRestart(active = true): void {
  useEffect(() => {
    if (!active) return
    const token = Symbol('hold')
    holds.add(token)
    return () => { holds.delete(token) }
  }, [active])
}

/** For code outside React: hold until the returned function is called. */
export function holdRestart(): () => void {
  const token = Symbol('hold')
  holds.add(token)
  return () => { holds.delete(token) }
}

export const restartHolds = (): number => holds.size

/** Anything open or running that a restart would cut off. */
export async function restartBlocked(): Promise<boolean> {
  if (holds.size > 0 || activeUploads() > 0) return true
  try {
    const busy = await window.wivo?.busy?.()
    return !!busy && (busy.downloads > 0 || busy.otherWindows > 0)
  } catch {
    return false
  }
}
