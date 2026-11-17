/**
 * The licence, as the renderer sees it.
 *
 * Verification happens in the main process (src/main/license.ts) — this only
 * asks. When the bridge is absent (a web build, or a dev renderer opened in a
 * plain browser) the answer is a permissive stub: refusing to run because an
 * IPC channel is missing would be a support call, not a sale.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LicenceModule, LicenceStatus } from '@shared/license/token'
import { MODULE_KEYS, isModuleKey, licenceAllowsWrites } from '@shared/license/token'

const UNLICENSED_STUB: LicenceStatus = {
  state: 'active', payload: null, daysLeft: null, graceLeft: null,
}

/**
 * What a build without licensing shows: everything. A developer, and any build
 * with no keys compiled in, must not be looking at a crippled app — and the
 * phone, which has no bridge at all, must not be either.
 */
const ALL_MODULES: readonly LicenceModule[] = MODULE_KEYS

interface WivoLicenceBridge {
  licenseStatus?: () => Promise<LicenceStatus>
  licenseInstall?: (token: string) => Promise<LicenceStatus>
  licenseEnforced?: () => Promise<boolean>
  licenseModules?: () => Promise<string[]>
}

const bridge = (): WivoLicenceBridge | null =>
  (window as unknown as { wivo?: WivoLicenceBridge }).wivo ?? null

export function useLicense() {
  const [status, setStatus] = useState<LicenceStatus>(UNLICENSED_STUB)
  const [enforced, setEnforced] = useState(false)
  const [modules, setModules] = useState<readonly LicenceModule[]>(ALL_MODULES)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const w = bridge()
    if (!w?.licenseStatus) { setLoading(false); return }
    try {
      const [s, e, m] = await Promise.all([
        w.licenseStatus(),
        w.licenseEnforced?.() ?? Promise.resolve(false),
        // An older preload has no module bridge. Its absence means every
        // module, not none: a stale preload must not empty the menu.
        w.licenseModules?.() ?? Promise.resolve([...ALL_MODULES]),
      ])
      setStatus(s)
      setEnforced(e)
      setModules(m.filter(isModuleKey))
    } catch {
      // A failed check must not lock the app out. Anything that can brick a
      // paying lab's Monday morning has to fail open — for the modules too.
      setStatus(UNLICENSED_STUB)
      setModules(ALL_MODULES)
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

  /**
   * Whether a module is on. Not enforced = everything on, the same rule
   * `canWrite` follows, so dev and the phone behave identically.
   */
  const moduleOn = useMemo(() => {
    const on = new Set<string>(enforced ? modules : ALL_MODULES)
    return (module: string): boolean => on.has(module)
  }, [enforced, modules])

  return {
    status,
    /** Whether this build checks licences at all. False in dev. */
    enforced,
    loading,
    /** The single question the rest of the app asks. */
    canWrite: !enforced || licenceAllowsWrites(status),
    /** The modules this clinic may run; everything when not enforced. */
    modules: enforced ? modules : ALL_MODULES,
    moduleOn,
    install,
    refresh,
  }
}
