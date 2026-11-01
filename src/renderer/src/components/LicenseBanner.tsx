/**
 * The licence nag, and the wall.
 *
 * Nothing here appears in a build with no public key compiled in, which is
 * every development build — see src/main/license.ts.
 */
import { useState } from 'react'
import { KeyRound, AlertTriangle, X } from 'lucide-react'
import { useLicense } from '../hooks/useLicense'
import { t } from '@/lib/i18n'

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
          <strong>{t('licenseBanner.licenceExpired')}</strong>{' '}
          {t('licenseBanner.theAppKeepsWorkingForMore', { status, graceLeft: status.graceLeft })}
        </p>
        <button onClick={onOpenSettings} className="text-xs font-medium text-accent hover:underline">
          {t('licenseBanner.enterANewKey')}
        </button>
        <button onClick={() => setDismissed(true)} className="text-ink-faint hover:text-ink" title={t('licenseBanner.dismiss')}>
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
          {status.state === 'missing' ? t('licenseBanner.noLicenceKey') :
           status.state === 'invalid' ? t('licenseBanner.licenceKeyIsNotValid') :
           t('licenseBanner.licenceExpired')}
        </strong>{' '}
        {t('licenseBanner.theAppIsReadOnlyAll')}
      </p>
      <button onClick={onOpenSettings} className="text-xs font-medium text-accent hover:underline">
        {t('licenseBanner.enterKey')}
      </button>
    </div>
  )
}
