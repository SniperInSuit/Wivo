/**
 * Seaded → Litsents. Where a key is pasted in and its state is readable.
 */
import { useState } from 'react'
import { KeyRound, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { PLAN_LABEL } from '@shared/license/token'
import { useLicense } from '../../hooks/useLicense'

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
        setMessage('See võti ei kehti. Kontrolli, et kogu tekst sai kopeeritud.')
      } else {
        setToken('')
        setMessage('Litsents paigaldatud.')
      }
    } catch {
      setMessage('Võtme salvestamine ebaõnnestus.')
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
        <KeyRound size={14} className="text-accent" /> Litsents
      </h3>

      {!enforced ? (
        <p className="text-xs text-ink-muted max-w-xl leading-relaxed">
          See build ei kontrolli litsentsi — arendusversioon. Kontroll lülitub sisse
          siis, kui <code className="px-1 rounded bg-bg-sidebar">LICENCE_PUBLIC_KEY</code>{' '}
          on seatud.
        </p>
      ) : loading ? (
        <p className="text-xs text-ink-faint">Kontrollin…</p>
      ) : (
        <>
          <div className="bg-bg-sidebar rounded-xl p-4 mb-4 max-w-xl">
            <p className={`text-sm font-semibold flex items-center gap-1.5 ${tone}`}>
              {status.state === 'active'
                ? <CheckCircle2 size={14} />
                : <AlertTriangle size={14} />}
              {status.state === 'active' ? 'Kehtiv' :
               status.state === 'grace'   ? `Aegunud — armuaega ${status.graceLeft} päeva` :
               status.state === 'invalid' ? 'Ei kehti' :
               status.state === 'expired' ? 'Aegunud — kirjutuskaitse' : 'Puudub'}
            </p>
            {status.payload && (
              <dl className="mt-2 space-y-1 text-xs">
                <Row label="Kellele" value={status.payload.name} />
                <Row label="Pakett" value={PLAN_LABEL[status.payload.plan]} />
                <Row label="Kasutajaid" value={status.payload.seats?.toString() ?? 'piiramatu'} />
                <Row label="Kehtib kuni" value={status.payload.exp} />
              </dl>
            )}
            {status.state === 'active' && status.daysLeft != null && status.daysLeft <= 30 && (
              <p className="text-[11px] text-amber-600 mt-2">
                Aegub {status.daysLeft} päeva pärast.
              </p>
            )}
          </div>

          <label className="label">Uus litsentsivõti</label>
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
              Paigalda
            </button>
            {message && <p className="text-xs text-ink-muted">{message}</p>}
          </div>
          <p className="text-[11px] text-ink-faint mt-2 max-w-xl leading-relaxed">
            Võti on seotud sinu ettevõttega, mitte arvutiga — sama võti käib iga
            töökoha peale. Kontroll toimub arvutis kohapeal, ilma internetita:
            labor ei tohi seisma jääda sellepärast, et võrk kadus.
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
