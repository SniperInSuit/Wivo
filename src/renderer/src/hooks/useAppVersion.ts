import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Tracks the running version and available updates.
 *
 * Two update paths:
 *   1. Production (packaged): electron-updater checks GitHub Releases
 *   2. Dev mode: git fetch/pull via IPC
 */
export function useAppVersion() {
  const booted = useRef<string | null>(null)
  const [running, setRunning] = useState<string>(__APP_VERSION__)

  // Dev mode: disk/git based
  const [available, setAvailable] = useState<string | null>(null)
  const [remoteAvailable, setRemoteAvailable] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullDone, setPullDone] = useState(false)

  // Production: electron-updater based
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  useEffect(() => {
    const bridge = window.wivo
    if (!bridge) return

    let cancelled = false

    // Read running version from disk
    const checkDisk = async () => {
      try {
        const onDisk = await bridge.getVersion()
        if (cancelled) return
        if (booted.current === null) {
          booted.current = onDisk
          setRunning(onDisk)
          return
        }
        setAvailable(onDisk !== booted.current ? onDisk : null)
      } catch {}
    }

    // Dev mode: check git remote
    const checkRemote = async () => {
      try {
        const hasUpdate = await bridge.checkRemoteUpdate()
        if (cancelled) return
        setRemoteAvailable(hasUpdate)
      } catch {}
    }

    // Production: listen for auto-updater events
    bridge.onUpdateAvailable?.((version) => {
      setUpdateVersion(version)
    })
    bridge.onUpdateDownloaded?.(() => {
      setDownloaded(true)
      setDownloading(false)
    })

    void checkDisk()
    const remoteTimeout = setTimeout(() => void checkRemote(), 10_000)
    const diskTimer = setInterval(checkDisk, 30_000)
    const remoteTimer = setInterval(checkRemote, 60_000)
    const onFocus = () => { void checkDisk(); void checkRemote() }
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearTimeout(remoteTimeout)
      clearInterval(diskTimer)
      clearInterval(remoteTimer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // Dev: git pull + restart
  const pullAndRestart = useCallback(async () => {
    const bridge = window.wivo
    if (!bridge) return
    setPulling(true)
    try {
      const newVersion = await bridge.gitPull()
      if (newVersion) {
        setPullDone(true)
        setAvailable(newVersion)
        setRemoteAvailable(false)
        setTimeout(() => bridge.relaunch(), 1500)
      }
    } finally {
      setPulling(false)
    }
  }, [])

  // Production: download + install
  const downloadAndInstall = useCallback(async () => {
    const bridge = window.wivo
    if (!bridge) return
    setDownloading(true)
    await bridge.downloadUpdate()
  }, [])

  const installNow = useCallback(() => {
    window.wivo?.installUpdate()
  }, [])

  const hasUpdate = available !== null || updateVersion !== null

  return {
    running,
    available: available ?? updateVersion,
    hasUpdate,
    // Dev mode
    remoteAvailable,
    pulling,
    pullDone,
    pullAndRestart,
    // Production
    updateVersion,
    downloading,
    downloaded,
    downloadAndInstall,
    installNow,
    // Generic
    restart: () => window.wivo?.relaunch(),
  }
}
