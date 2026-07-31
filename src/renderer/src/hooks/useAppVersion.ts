import { useEffect, useRef, useState } from 'react'

/**
 * The version this window is running, and whether a newer one is on disk.
 *
 * Two different numbers used to be confused for each other:
 *   `__APP_VERSION__` — baked in when the bundle was BUILT. During development
 *      it goes stale the moment package.json is bumped, because Vite reads the
 *      config once and HMR keeps serving new code under the old constant.
 *   the file on disk — what the app WOULD be if it started now.
 *
 * The sidebar used to show the first and call it the app's version, which meant
 * it reported a version the app was not running. Twice this session that sent
 * debugging down the wrong path. So: the running version is captured once at
 * boot from the live file, and the same file is re-read periodically. When the
 * two differ, there is an update waiting for a restart.
 *
 * Outside Electron (a browser tab during dev) the bridge is absent, and this
 * falls back to the build constant with no update prompt — a missing bridge must
 * degrade visibly-nothing, not pretend.
 */
export function useAppVersion() {
  // What this window booted with. Captured once; never updated, or the
  // comparison would always agree with itself.
  const booted = useRef<string | null>(null)
  const [running, setRunning] = useState<string>(__APP_VERSION__)
  const [available, setAvailable] = useState<string | null>(null)

  useEffect(() => {
    const bridge = window.wivo
    if (!bridge) return

    let cancelled = false

    const check = async () => {
      try {
        const onDisk = await bridge.getVersion()
        if (cancelled) return
        if (booted.current === null) {
          booted.current = onDisk
          setRunning(onDisk)
          return
        }
        setAvailable(onDisk !== booted.current ? onDisk : null)
      } catch {
        // Nothing to say — an unreachable main process is not an update.
      }
    }

    void check()
    // Polling rather than a file watcher: the answer is one small read, and a
    // watcher on package.json would fire on every editor save regardless of
    // whether the version actually moved.
    const timer = setInterval(check, 30_000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return {
    running,
    available,
    hasUpdate: available !== null,
    restart: () => window.wivo?.relaunch(),
  }
}
