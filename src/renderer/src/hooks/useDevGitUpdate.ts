/**
 * The DEVELOPER's update path: git, not releases.
 *
 * This used to live interleaved with the real auto-updater inside one 129-line
 * `useAppVersion`, and the two kept being mistaken for each other — HANDOFF.md
 * still said "it is NOT an auto-updater, nothing is downloaded" long after
 * electron-updater was wired up. They are separate files now so that cannot
 * happen again.
 *
 * What it does: compares the repo against `origin/main`, offers a pull, and
 * notices when package.json on disk stops matching the version this process
 * booted with (i.e. somebody pulled outside the app).
 *
 * In a packaged build the git IPC fails into `false`/`null`, so this is inert —
 * but it is also gated on `import.meta.env.DEV`, because polling for something
 * that can never change is just a timer burning a user's battery.
 */
import { useEffect, useRef, useState, useCallback } from 'react'

export interface DevGitUpdate {
  /** A new version appeared on disk since boot — restart to run it. */
  diskAvailable: string | null
  /** origin/main is ahead of the working copy. */
  remoteAvailable: boolean
  pulling: boolean
  pullDone: boolean
  pullAndRestart: () => Promise<void>
  restart: () => void
}

const IDLE: DevGitUpdate = {
  diskAvailable: null,
  remoteAvailable: false,
  pulling: false,
  pullDone: false,
  pullAndRestart: async () => {},
  restart: () => {},
}

export function useDevGitUpdate(): DevGitUpdate {
  const booted = useRef<string | null>(null)
  const [diskAvailable, setDiskAvailable] = useState<string | null>(null)
  const [remoteAvailable, setRemoteAvailable] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullDone, setPullDone] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const bridge = window.wivo
    if (!bridge) return
    let cancelled = false

    const checkDisk = async (): Promise<void> => {
      try {
        const onDisk = await bridge.getVersion()
        if (cancelled) return
        if (booted.current === null) { booted.current = onDisk; return }
        setDiskAvailable(onDisk !== booted.current ? onDisk : null)
      } catch { /* a version we cannot read is not a finding */ }
    }

    const checkRemote = async (): Promise<void> => {
      try {
        const ahead = await bridge.checkRemoteUpdate()
        if (!cancelled) setRemoteAvailable(ahead)
      } catch { /* no git, no remote, no network — all fine */ }
    }

    void checkDisk()
    const remoteTimeout = setTimeout(() => void checkRemote(), 10_000)
    const diskTimer = setInterval(() => void checkDisk(), 30_000)
    const remoteTimer = setInterval(() => void checkRemote(), 60_000)
    const onFocus = (): void => { void checkDisk(); void checkRemote() }
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearTimeout(remoteTimeout)
      clearInterval(diskTimer)
      clearInterval(remoteTimer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const pullAndRestart = useCallback(async () => {
    const bridge = window.wivo
    if (!bridge) return
    setPulling(true)
    try {
      const next = await bridge.gitPull()
      if (next) {
        setPullDone(true)
        setDiskAvailable(next)
        setRemoteAvailable(false)
        setTimeout(() => void bridge.relaunch(), 1500)
      }
    } finally {
      setPulling(false)
    }
  }, [])

  if (!import.meta.env.DEV) return IDLE

  return {
    diskAvailable,
    remoteAvailable,
    pulling,
    pullDone,
    pullAndRestart,
    restart: () => void window.wivo?.relaunch(),
  }
}
