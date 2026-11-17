/**
 * Seaded → Litsents. Where a key is pasted in and its state is readable.
 */
import { useState } from 'react'
import { KeyRound, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import {
  MODULE_KEYS, PLAN_LABEL, licenceAllowsApi, licenceApiOrigins, type LicenceModule,
} from '@shared/license/token'
import { useLicense } from '../../hooks/useLicense'
import { apiUrl } from '../../lib/supabase'
import { t } from '@/lib/i18n'

/** The modules, in the order a clinic buys them (docs/ROADMAP.md). */
const MODULE_LABEL: Record<LicenceModule, () => string> = {
  jobs:     () => t('settings.moduleJobs'),
  payroll:  () => t('settings.modulePayroll'),
  stock:    () => t('settings.moduleStock'),
  invoices: () => t('settings.moduleInvoices'),
  patients: () => t('settings.modulePatients'),
  stats:    () => t('settings.moduleStats'),
  partners: () => t('settings.modulePartners'),
  ratings:  () => t('settings.moduleRatings'),
}

export function LicenseSection() {
  const { status, enforced, loading, install, modules } = useLicense()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleInstall() {
    setBusy(true); setMessage(null)
    try {
      const next = await install(token)
      if (next.state === 'invalid') {
        setMessage(t('settings.thisKeyIsNotValidCheck'))
      } else if (next.payload && !licenceAllowsApi(next.payload, apiUrl)) {
        // The key is good, but not for the server this app is pointed at. The
        // database client was built when the app started and cannot be moved,
        // so saying "installed" here would be a lie that shows up as failing
        // saves ten minutes later.
        setToken('')
        setMessage(t('settings.theKeyIsForAnotherServer'))
      } else {
        setToken('')
        setMessage(t('settings.licenceInstalled'))
      }
    } catch {
      setMessage(t('settings.couldNotSaveTheKey'))
    } finally {
      setBusy(false)
    }
  }

  const tone =
    status.state === 'active' ? 'text-emerald-600' :
    status.state === 'grace'  ? 'text-amber-600'   : 'text-red-600'

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
        <KeyRound size={14} className="text-accent" /> {t('settings.licence')}
      </h3>

      {!enforced ? (
        <p className="text-xs text-ink-muted max-w-xl leading-relaxed">
          {t('settings.thisBuildDoesNotCheckThe')}{' '}
          <code className="px-1 rounded bg-bg-sidebar">LICENCE_PUBLIC_KEYS</code>{' '}
          {t('settings.isSet')}
        </p>
      ) : loading ? (
        <p className="text-xs text-ink-faint">{t('settings.checking')}</p>
      ) : (
        <>
          <div className="bg-bg-sidebar rounded-xl p-4 mb-4 max-w-xl">
            <p className={`text-sm font-semibold flex items-center gap-1.5 ${tone}`}>
              {status.state === 'active'
                ? <CheckCircle2 size={14} />
                : <AlertTriangle size={14} />}
              {status.state === 'active' ? t('settings.valid') :
               status.state === 'grace'   ? t('settings.expiredOfGraceLeftDayDays', { status, graceLeft: status.graceLeft }) :
               status.state === 'invalid' ? t('settings.notValid') :
               status.state === 'expired' ? t('settings.expiredReadOnly') : t('settings.missing')}
            </p>
            {status.payload && (
              <dl className="mt-2 space-y-1 text-xs">
                <Row label={t('settings.licensedTo')} value={status.payload.name} />
                <Row label={t('settings.plan')} value={PLAN_LABEL[status.payload.plan]} />
                <Row label={t('settings.users')} value={status.payload.seats?.toString() ?? t('settings.unlimited2')} />
                <Row label={t('settings.validUntil')} value={status.payload.exp} />
                {/* v2 only. A v1 key has neither, and showing an empty row
                    would read as "nothing is allowed" rather than "this key
                    predates the field". */}
                {status.payload.org && (
                  <Row label={t('settings.organisation')} value={status.payload.org} />
                )}
                <Row
                  label={t('settings.apiAddress')}
                  value={licenceApiOrigins(status.payload).join(', ') || t('settings.apiAddressAny')}
                />
                <Row label={t('settings.modules')} value={moduleList(modules)} />
              </dl>
            )}
            <p className="text-[11px] text-ink-faint mt-3 leading-relaxed">
              {t('settings.aSwitchedOffPartIsHidden')}
            </p>
            {status.state === 'active' && status.daysLeft != null && status.daysLeft <= 30 && (
              <p className="text-[11px] text-amber-600 mt-2">
                {t('settings.expiresInDayDays', { status, daysLeft: status.daysLeft })}
              </p>
            )}
          </div>

          <label className="label">{t('settings.newLicenceKey')}</label>
          <textarea
            value={token}
            onChange={e => setToken(e.target.value)}
            rows={3}
            placeholder="WIVO1.…"
            className="input resize-none font-mono text-[11px] max-w-xl"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleInstall}
              disabled={busy || !token.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              {t('settings.install')}
            </button>
            {message && <p className="text-xs text-ink-muted">{message}</p>}
          </div>
          <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
            {t('settings.theKeyBelongsToYourCompany')}
          </p>
        </>
      )}
    </section>
  )
}

/** The modules, named, in a fixed order so the line does not reshuffle. */
function moduleList(modules: readonly LicenceModule[]): string {
  if (modules.length === 0) return t('settings.moduleNone')
  if (modules.length === MODULE_KEYS.length) return t('settings.moduleAll')
  return MODULE_KEYS.filter(m => modules.includes(m)).map(m => MODULE_LABEL[m]()).join(', ')
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink font-medium">{value}</dd>
    </div>
  )
}
