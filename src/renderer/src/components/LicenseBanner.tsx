/**
 * The licence nag, and the wall.
 *
 * Nothing here appears in a build with no public key compiled in, which is
 * every development build — see src/main/license.ts.
 */
import { useState } from 'react'
import { KeyRound, AlertTriangle, X } from 'lucide-react'
import { useLicense } from '../hooks/useLicense'

export function LicenseBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { status, enforced, loading } = useLicense()
  const [dismissed, setDismissed] = useState(false)

  if (loading || !enforced) return null
  if (status.state === 'active') return null
  if (dismissed && status.state === 'grace') return null

  // Grace: a warning you can push aside for the session. The lab keeps working.
  if (status.state === 'grace') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex-shrink-0">
        <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
        <p className="text-xs text-ink flex-1">
          <strong>Litsents on aegunud.</strong>{' '}
          Rakendus töötab veel {status.graceLeft} päeva, siis lülitub
          kirjutuskaitsesse — lugemine jääb alles.
        </p>
        <button onClick={onOpenSettings} className="text-xs font-medium text-accent hover:underline">
          Sisesta uus võti
        </button>
        <button onClick={() => setDismissed(true)} className="text-ink-faint hover:text-ink" title="Peida">
          <X size={13} />
        </button>
      </div>
    )
  }

  // Expired, invalid or missing: read-only, and NOT dismissible. Hiding this
  // would leave someone typing into a form whose save button will refuse.
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex-shrink-0">
      <KeyRound size={14} className="text-red-600 flex-shrink-0" />
      <p className="text-xs text-ink flex-1">
        <strong>
          {status.state === 'missing' ? 'Litsentsivõti puudub.' :
           status.state === 'invalid' ? 'Litsentsivõti ei kehti.' :
           'Litsents on aegunud.'}
        </strong>{' '}
        Rakendus on kirjutuskaitses — kõik andmed on nähtaval, aga muuta ei saa.
      </p>
      <button onClick={onOpenSettings} className="text-xs font-medium text-accent hover:underline">
        Sisesta võti
      </button>
    </div>
  )
}
