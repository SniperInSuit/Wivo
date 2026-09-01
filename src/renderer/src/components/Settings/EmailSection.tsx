/**
 * Seaded → Kliinik → E-post.
 *
 * Two questions, deliberately kept apart on screen because they are not the
 * same decision:
 *
 *   1. WHERE FROM — the host, the port, the sender address. Transport.
 *   2. WHAT IS ALLOWED — every switch, every ceiling. Permission.
 *
 * The mailbox a clinic connects here is usually its MAIN address, the one
 * patients and suppliers write to. That is why nothing is on by default and why
 * the permissions are a block of their own rather than a checkbox tucked under
 * the host field: connecting a mailbox and allowing this system to write from
 * it are two separate acts, and the second one should feel like one.
 *
 * The password is not here and cannot be. `clinic_settings` is readable by every
 * member of the clinic; the credential lives in `supabase secrets`, reachable
 * only by the edge function while it runs. See sql/051.
 */
import { Mail, ShieldCheck, AlertTriangle, FlaskConical } from 'lucide-react'
import { useSettings } from '../../stores/useSettings'
import type { MailSettings } from '../../stores/useSettings'
import { looksLikeEmail } from '@shared/billing/sendGuard'

export function EmailSection() {
  const { settings, setEpost } = useSettings()
  const e = settings.epost

  const patch = (p: Partial<MailSettings>) => setEpost(p)

  const senderOk = looksLikeEmail(e.saatjaAadress)
  const testOk = !e.testAadress || looksLikeEmail(e.testAadress)
  // What actually has to be true before a single message can leave. Stated as
  // one list because "why is nothing sending" is the question this screen will
  // be opened with.
  const blockers: string[] = []
  if (!e.connected) blockers.push('ühendus on märkimata')
  if (!e.host.trim()) blockers.push('server puudub')
  if (!senderOk) blockers.push('saatja aadress puudub või on vigane')
  if (!e.saatmineLubatud) blockers.push('saatmine on välja lülitatud')
  if (!e.lubaArved) blockers.push('arvete saatmine ei ole lubatud')
  if (e.paevaLimiit <= 0) blockers.push('päevalimiit on 0')
  if (!testOk) blockers.push('testaadress on vigane')

  return (
    <section className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Mail size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-ink">E-posti ühendus</h3>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          Wivo saab arveid välja saata sinu enda majutuse postkasti kaudu — Zone,
          Veebimajutus või muu SMTP. Nii jõuab kiri sinu domeenilt ja sinu SPF/DKIM
          kehtib juba.
        </p>
      </div>

      {/* What it can and cannot do. Said before the fields, because this is the
          thing a person is actually deciding when they type a password into the
          next screen. */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-emerald-900">
              Wivo saab ainult kirju SAATA
            </p>
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              Postkasti lugemiseks on vaja IMAP-i seadeid, mida Wivo kuskil ei küsi
              ega hoia. Sinu saabuvat posti ei loeta, ei kustutata ega liigutata —
              ainus võimekus on kiri väljundkasti panna.
            </p>
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              <strong>Parooli siin ei ole.</strong> See käib eraldi käsuga otse
              Supabase'i saladustesse ega jõua kunagi sellesse seadete ritta, mida
              iga kliiniku liige lugeda saab.
            </p>
          </div>
        </div>
      </div>

      {/* ── Transport ── */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP server" value={e.host} onChange={v => patch({ host: v })}
            placeholder="mail.elkdata.ee" />
          <div>
            <label className="label">Port</label>
            <input
              type="number" min="1" max="65535" value={e.port}
              onChange={ev => patch({ port: parseInt(ev.target.value) || 465 })}
              className="input"
            />
            {/* 587 is the usual advice and it does not work here — worth saying
                on the field rather than in a support conversation later. */}
            {e.port !== 465 && (
              <p className="text-[11px] text-orange-600 mt-1 leading-snug">
                Supabase lubab väljuvat ühendust ainult pordile <strong>465</strong>.
                25 ja 587 on blokeeritud.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Saatja aadress" value={e.saatjaAadress}
            onChange={v => patch({ saatjaAadress: v })}
            placeholder="info@kliinik.ee"
            invalid={!!e.saatjaAadress && !senderOk}
          />
          <Field label="Saatja nimi" value={e.saatjaNimi}
            onChange={v => patch({ saatjaNimi: v })} placeholder="Kliiniku nimi" />
        </div>

        <Toggle
          checked={e.connected}
          onChange={v => patch({ connected: v })}
          label="Saladused on Supabase'is paika pandud"
          hint="Märge sulle endale — Wivo ei näe saladusi ega saa seda kontrollida."
        />
      </div>

      {/* ── Permissions ── */}
      <div className="pt-4 border-t border-ink-faint/20 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Mida tohib saata</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            Iga luba on eraldi ja kõik on vaikimisi väljas. Uus kirjaliik tulevikus
            tähendab uut lülitit, mitte olemasoleva laienemist.
          </p>
        </div>

        <Toggle
          checked={e.saatmineLubatud}
          onChange={v => patch({ saatmineLubatud: v })}
          label="Automaatne saatmine"
          hint="Peakaitse. Väljas = midagi ei saadeta, olenemata kõigist teistest seadetest."
          strong
        />

        <Toggle
          checked={e.lubaArved}
          onChange={v => patch({ lubaArved: v })}
          disabled={!e.saatmineLubatud}
          label="Arved"
          hint="Ainult arve, mille väljastuskuupäev on käes ja millel on tasumata summa."
        />

        <div>
          <label className="label">Päevalimiit</label>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="500" value={e.paevaLimiit}
              onChange={ev => patch({ paevaLimiit: Math.max(0, parseInt(ev.target.value) || 0) })}
              className="input py-1.5 text-sm w-24 text-right"
            />
            <span className="text-xs text-ink-muted">kirja päevas</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
            Ülempiir, mis kaitseb korduva käivituse ja jagatud majutuse
            saatmispiirangu eest. 0 = ei saadeta midagi.
          </p>
        </div>

        <div>
          <label className="label flex items-center gap-1.5">
            <FlaskConical size={11} /> Testaadress
          </label>
          <input
            type="email" value={e.testAadress ?? ''}
            onChange={ev => patch({ testAadress: ev.target.value.trim() || null })}
            placeholder="tühi = päris saajad"
            className={`input ${e.testAadress && !testOk ? 'border-rose-400' : ''}`}
          />
          <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
            Kui täidetud, läheb <strong>iga</strong> kiri siia, mitte patsiendile.
            Sama kood, sama kiri, sama limiit — üks aadress. Soovitan esimene nädal
            nii hoida.
          </p>
        </div>
      </div>

      {/* ── Where it stands ── */}
      <div className={`rounded-xl border p-3 ${
        blockers.length === 0
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-orange-200 bg-orange-50/60'
      }`}>
        {blockers.length === 0 ? (
          <p className="text-xs text-emerald-900">
            <strong>Saatmine on lubatud.</strong>{' '}
            {e.testAadress
              ? `Kirjad lähevad testaadressile ${e.testAadress}, mitte patsientidele.`
              : 'Kirjad lähevad päris saajatele.'}
          </p>
        ) : (
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-orange-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-orange-900">
              <strong>Ei saadeta midagi.</strong> {blockers.join('; ')}.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function Field({ label, value, onChange, placeholder, invalid }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`input ${invalid ? 'border-rose-400' : ''}`}
      />
    </div>
  )
}

function Toggle({ checked, onChange, label, hint, disabled, strong }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
  strong?: boolean
}) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-accent flex-shrink-0"
      />
      <span className="min-w-0">
        <span className={`block text-sm ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>
          {label}
        </span>
        {hint && <span className="block text-[11px] text-ink-faint leading-relaxed">{hint}</span>}
      </span>
    </label>
  )
}
