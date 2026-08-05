/**
 * The licence, as the renderer sees it.
 *
 * Verification happens in the main process (src/main/license.ts) — this only
 * asks. When the bridge is absent (a web build, or a dev renderer opened in a
 * plain browser) the answer is a permissive stub: refusing to run because an
 * IPC channel is missing would be a support call, not a sale.
 */
import { useCallback, useEffect, useState } from 'react'
import type { LicenceStatus } from '@shared/license/token'
import { licenceAllowsWrites } from '@shared/license/token'

const UNLICENSED_STUB: LicenceStatus = {
  state: 'active', payload: null, daysLeft: null, graceLeft: null,
}

interface WivoLicenceBridge {
  licenseStatus?: () => Promise<LicenceStatus>
  licenseInstall?: (token: string) => Promise<LicenceStatus>
  licenseEnforced?: () => Promise<boolean>
}

const bridge = (): WivoLicenceBridge | null =>
  (window as unknown as { wivo?: WivoLicenceBridge }).wivo ?? null

export function useLicense() {
  const [status, setStatus] = useState<LicenceStatus>(UNLICENSED_STUB)
  const [enforced, setEnforced] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const w = bridge()
    if (!w?.licenseStatus) { setLoading(false); return }
    try {
      const [s, e] = await Promise.all([
        w.licenseStatus(),
        w.licenseEnforced?.() ?? Promise.resolve(false),
      ])
      setStatus(s)
      setEnforced(e)
    } catch {
      // A failed check must not lock the app out. Anything that can brick a
      // paying lab's Monday morning has to fail open.
      setStatus(UNLICENSED_STUB)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Re-check on focus. A key installed on one machine, or a day rolling over
  // past the grace window while the app sat open, both show up here.
  useEffect(() => {
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const install = useCallback(async (token: string): Promise<LicenceStatus> => {
    const w = bridge()
    if (!w?.licenseInstall) return UNLICENSED_STUB
    const next = await w.licenseInstall(token)
    setStatus(next)
    return next
  }, [])

  return {
    status,
    /** Whether this build checks licences at all. False in dev. */
    enforced,
    loading,
    /** The single question the rest of the app asks. */
    canWrite: !enforced || licenceAllowsWrites(status),
    install,
    refresh,
  }
}
