/**
 * The one place the renderer listens to the updater.
 *
 * ── Why a provider and not a hook ────────────────────────────────────────────
 * `useAppVersion` was called in two components (the sidebar footer and the
 * update toast). Each mount started its own 30-second and 60-second polls and
 * registered its own `ipcRenderer.on` handlers — and the old preload exposed no
 * way to take those off again, so they outlived the components forever. Two
 * copies of the state also meant the sidebar was receiving update events it
 * never displayed.
 *
 * One subscription, one cleanup, read from context by everybody.
 *
 * ── No polling ───────────────────────────────────────────────────────────────
 * There is nothing to poll. The main process pushes state; the one thing we ask
 * for is the LAST state at mount, because a window opened after a download
 * finished would otherwise never hear about it.
 */
import {
  createContext, useContext, useEffect, useState, useCallback, type ReactNode,
} from 'react'
import type { UpdateState } from '../../../types/update'

interface UpdateContextValue {
  /** The version this process is actually running. */
  running: string
  state: UpdateState
  /** Apply a staged update now rather than at the next launch. */
  installNow: () => void
  /** Force a check — Seaded, and "press this and tell me what it says". */
  checkNow: () => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  // `__APP_VERSION__` is frozen at build time and goes stale in dev the moment
  // package.json is bumped — see HANDOFF.md. It is only the first paint; the
  // bridge replaces it with what is actually on disk.
  const [running, setRunning] = useState<string>(__APP_VERSION__)
  const [state, setState] = useState<UpdateState>({ stage: 'idle' })

  useEffect(() => {
    const bridge = window.wivo
    if (!bridge) return
    let cancelled = false

    void bridge.getVersion().then(v => { if (!cancelled) setRunning(v) }).catch(() => {})
    void bridge.updateState().then(s => { if (!cancelled) setState(s) }).catch(() => {})

    // Returns its own remover — the whole point of the preload change.
    const off = bridge.onUpdateState(s => { if (!cancelled) setState(s) })
    return () => { cancelled = true; off() }
  }, [])

  const installNow = useCallback(() => { void window.wivo?.installNow() }, [])
  const checkNow = useCallback(() => { void window.wivo?.checkNow() }, [])

  return (
    <UpdateContext.Provider value={{ running, state, installNow, checkNow }}>
      {children}
    </UpdateContext.Provider>
  )
}

function useUpdateContext(): UpdateContextValue {
  const ctx = useContext(UpdateContext)
  // Falling back rather than throwing: a missing provider must not blank the
  // whole app over a version number in a footer.
  return ctx ?? {
    running: __APP_VERSION__,
    state: { stage: 'idle' },
    installNow: () => {},
    checkNow: () => {},
  }
}

/** For the toast and the Seaded button. */
export const useUpdate = (): UpdateContextValue => useUpdateContext()

/** For anything that only wants to print the version. */
export const useRunningVersion = (): string => useUpdateContext().running
