/**
 * Seaded → Litsents. Where a key is pasted in and its state is readable.
 */
import { useState } from 'react'
import { KeyRound, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { PLAN_LABEL } from '@shared/license/token'
import { useLicense } from '../../hooks/useLicense'
import { t } from '@/lib/i18n'

export function LicenseSection() {
  const { status, enforced, loading, install } = useLicense()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleInstall() {
    setBusy(true); setMessage(null)
    try {
      const next = await install(token)
      if (next.state === 'invalid') {
        setMessage(t('See võti ei kehti. Kontrolli, et kogu tekst sai kopeeritud.', 'This key is not valid. Check that all of the text was copied.'))
      } else {
        setToken('')
        setMessage(t('Litsents paigaldatud.', 'Licence installed.'))
      }
    } catch {
      setMessage(t('Võtme salvestamine ebaõnnestus.', 'Could not save the key.'))
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
        <KeyRound size={14} className="text-accent" /> {t('Litsents', 'Licence')}
      </h3>

      {!enforced ? (
        <p className="text-xs text-ink-muted max-w-xl leading-relaxed">
          {t(
            'See build ei kontrolli litsentsi — arendusversioon. Kontroll lülitub sisse siis, kui',
            'This build does not check the licence — it is a development version. Checking turns on once',
          )}{' '}
          <code className="px-1 rounded bg-bg-sidebar">LICENCE_PUBLIC_KEY</code>{' '}
          {t('on seatud.', 'is set.')}
        </p>
      ) : loading ? (
        <p className="text-xs text-ink-faint">{t('Kontrollin…', 'Checking…')}</p>
      ) : (
        <>
          <div className="bg-bg-sidebar rounded-xl p-4 mb-4 max-w-xl">
            <p className={`text-sm font-semibold flex items-center gap-1.5 ${tone}`}>
              {status.state === 'active'
                ? <CheckCircle2 size={14} />
                : <AlertTriangle size={14} />}
              {status.state === 'active' ? t('Kehtiv', 'Valid') :
               status.state === 'grace'   ? t(`Aegunud — armuaega ${status.graceLeft} päeva`, `Expired — ${status.graceLeft} ${status.graceLeft === 1 ? 'day' : 'days'} of grace left`) :
               status.state === 'invalid' ? t('Ei kehti', 'Not valid') :
               status.state === 'expired' ? t('Aegunud — kirjutuskaitse', 'Expired — read-only') : t('Puudub', 'Missing')}
            </p>
            {status.payload && (
              <dl className="mt-2 space-y-1 text-xs">
                <Row label={t('Kellele', 'Licensed to')} value={status.payload.name} />
                <Row label={t('Pakett', 'Plan')} value={PLAN_LABEL[status.payload.plan]} />
                <Row label={t('Kasutajaid', 'Users')} value={status.payload.seats?.toString() ?? t('piiramatu', 'unlimited')} />
                <Row label={t('Kehtib kuni', 'Valid until')} value={status.payload.exp} />
              </dl>
            )}
            {status.state === 'active' && status.daysLeft != null && status.daysLeft <= 30 && (
              <p className="text-[11px] text-amber-600 mt-2">
                {t(`Aegub ${status.daysLeft} päeva pärast.`, `Expires in ${status.daysLeft} ${status.daysLeft === 1 ? 'day' : 'days'}.`)}
              </p>
            )}
          </div>

          <label className="label">{t('Uus litsentsivõti', 'New licence key')}</label>
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
              {t('Paigalda', 'Install')}
            </button>
            {message && <p className="text-xs text-ink-muted">{message}</p>}
          </div>
          <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
            {t(
              'Võti on seotud sinu ettevõttega, mitte arvutiga — sama võti käib iga töökoha peale. Kontroll toimub arvutis kohapeal, ilma internetita: labor ei tohi seisma jääda sellepärast, et võrk kadus.',
              'The key belongs to your company, not to a computer — the same key works on every workstation. It is checked on the computer itself, without the internet: the lab must not stop because the network went down.',
            )}
          </p>
        </>
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink font-medium">{value}</dd>
    </div>
  )
}
