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
import { Mail, ShieldCheck, AlertTriangle, FlaskConical, Clock } from 'lucide-react'
import { useSettings } from '../../stores/useSettings'
import type { MailSettings } from '../../stores/useSettings'
import { looksLikeEmail } from '@shared/billing/sendGuard'
import {
  renderTemplate, unknownTokens, TEMPLATE_TOKENS,
} from '@shared/billing/mailTemplate'
import { t } from '@/lib/i18n'

/**
 * A made-up invoice for the preview. Recognisably fake on purpose: a preview
 * using real numbers invites reading it as a real document.
 */
const PREVIEW_VARS: Record<string, string> = {
  arve: '2026-0007',
  saaja: 'Mari Maasikas',
  summa: '1220.00 €',
  tasumata: '1220.00 €',
  tahtaeg: '15.09.2026',
  kuupaev: '01.09.2026',
  kliinik: 'Sinu Kliinik OÜ',
}

export function EmailSection() {
  const { settings, setEpost } = useSettings()
  const e = settings.epost

  const patch = (p: Partial<MailSettings>) => setEpost(p)

  /**
   * How long ago the sender ran. Stale after three hours: it is scheduled
   * hourly, so one missed run is a blip and three is a fault.
   */
  const heartbeat = (() => {
    const at = e.viimane_kaivitus ? new Date(e.viimane_kaivitus) : null
    if (!at || Number.isNaN(at.getTime())) {
      return { text: t('mitte kordagi', 'never'), stale: true }
    }
    const mins = Math.floor((Date.now() - at.getTime()) / 60000)
    const text = mins < 2 ? t('just praegu', 'just now')
      : mins < 60 ? t(`${mins} min tagasi`, `${mins} min ago`)
      : mins < 60 * 48 ? t(`${Math.floor(mins / 60)} t tagasi`, `${Math.floor(mins / 60)} h ago`)
      : t(`${Math.floor(mins / 1440)} päeva tagasi`, `${Math.floor(mins / 1440)} days ago`)
    return { text, stale: mins > 180 }
  })()

  const senderOk = looksLikeEmail(e.saatjaAadress)
  const unknown = [
    ...unknownTokens(e.pealkiri, PREVIEW_VARS),
    ...unknownTokens(e.sissejuhatus, PREVIEW_VARS),
    ...unknownTokens(e.lopp, PREVIEW_VARS),
  ]
  const testOk = !e.testAadress || looksLikeEmail(e.testAadress)
  // What actually has to be true before a single message can leave. Stated as
  // one list because "why is nothing sending" is the question this screen will
  // be opened with.
  const blockers: string[] = []
  if (!e.connected) blockers.push(t('ühendus on märkimata', 'the connection is not ticked'))
  if (!e.host.trim()) blockers.push(t('server puudub', 'no server'))
  if (!senderOk) blockers.push(t('saatja aadress puudub või on vigane', 'the sender address is missing or invalid'))
  if (!e.saatmineLubatud) blockers.push(t('saatmine on välja lülitatud', 'sending is turned off'))
  if (!e.lubaArved) blockers.push(t('arvete saatmine ei ole lubatud', 'sending invoices is not allowed'))
  if (e.paevaLimiit <= 0) blockers.push(t('päevalimiit on 0', 'the daily limit is 0'))
  if (!testOk) blockers.push(t('testaadress on vigane', 'the test address is invalid'))

  return (
    <section className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Mail size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-ink">{t('E-posti ühendus', 'Email connection')}</h3>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          {t(
            'Wivo saab arveid välja saata sinu enda majutuse postkasti kaudu — Zone, Veebimajutus või muu SMTP. Nii jõuab kiri sinu domeenilt ja sinu SPF/DKIM kehtib juba.',
            'Wivo can send invoices through your own hosting mailbox — Zone, Veebimajutus or any other SMTP. That way the email comes from your domain and your SPF/DKIM already applies.',
          )}
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
              {t('Wivo saab ainult kirju SAATA', 'Wivo can only SEND email')}
            </p>
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              {t(
                'Postkasti lugemiseks on vaja IMAP-i seadeid, mida Wivo kuskil ei küsi ega hoia. Sinu saabuvat posti ei loeta, ei kustutata ega liigutata — ainus võimekus on kiri väljundkasti panna.',
                'Reading a mailbox needs IMAP settings, which Wivo never asks for or stores. Your incoming mail is not read, deleted or moved — the only thing it can do is put a message in the outbox.',
              )}
            </p>
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              <strong>{t('Parooli siin ei ole.', 'The password is not here.')}</strong>{' '}
              {t(
                "See käib eraldi käsuga otse Supabase'i saladustesse ega jõua kunagi sellesse seadete ritta, mida iga kliiniku liige lugeda saab.",
                'It goes straight into Supabase secrets with a separate command and never reaches this settings row, which every clinic member can read.',
              )}
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
                {t('Supabase lubab väljuvat ühendust ainult pordile', 'Supabase allows outgoing connections only on port')}{' '}
                <strong>465</strong>.{' '}
                {t('25 ja 587 on blokeeritud.', '25 and 587 are blocked.')}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('Saatja aadress', 'Sender address')} value={e.saatjaAadress}
            onChange={v => patch({ saatjaAadress: v })}
            placeholder={t('info@kliinik.ee', 'info@clinic.com')}
            invalid={!!e.saatjaAadress && !senderOk}
          />
          <Field label={t('Saatja nimi', 'Sender name')} value={e.saatjaNimi}
            onChange={v => patch({ saatjaNimi: v })} placeholder={t('Kliiniku nimi', 'Clinic name')} />
        </div>

        <Toggle
          checked={e.connected}
          onChange={v => patch({ connected: v })}
          label={t("Saladused on Supabase'is paika pandud", 'The secrets are set in Supabase')}
          hint={t(
            'Märge sulle endale — Wivo ei näe saladusi ega saa seda kontrollida.',
            'A note for yourself — Wivo cannot see the secrets or check this.',
          )}
        />
      </div>

      {/* ── Permissions ── */}
      <div className="pt-4 border-t border-ink-faint/20 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('Mida tohib saata', 'What may be sent')}</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            {t(
              'Iga luba on eraldi ja kõik on vaikimisi väljas. Uus kirjaliik tulevikus tähendab uut lülitit, mitte olemasoleva laienemist.',
              'Each permission is separate and all are off by default. A new kind of email in future means a new switch, not a wider existing one.',
            )}
          </p>
        </div>

        <Toggle
          checked={e.saatmineLubatud}
          onChange={v => patch({ saatmineLubatud: v })}
          label={t('Automaatne saatmine', 'Automatic sending')}
          hint={t(
            'Peakaitse. Väljas = midagi ei saadeta, olenemata kõigist teistest seadetest.',
            'Master switch. Off = nothing is sent, whatever the other settings say.',
          )}
          strong
        />

        <Toggle
          checked={e.lubaArved}
          onChange={v => patch({ lubaArved: v })}
          disabled={!e.saatmineLubatud}
          label={t('Arved', 'Invoices')}
          hint={t(
            'Ainult arve, mille väljastuskuupäev on käes ja millel on tasumata summa.',
            'Only an invoice whose issue date has come and that has an unpaid amount.',
          )}
        />

        <div>
          <label className="label">{t('Päevalimiit', 'Daily limit')}</label>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="500" value={e.paevaLimiit}
              onChange={ev => patch({ paevaLimiit: Math.max(0, parseInt(ev.target.value) || 0) })}
              className="input py-1.5 text-sm w-24 text-right"
            />
            <span className="text-xs text-ink-muted">{t('kirja päevas', e.paevaLimiit === 1 ? 'email per day' : 'emails per day')}</span>
          </div>
          <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
            {t(
              'Ülempiir, mis kaitseb korduva käivituse ja jagatud majutuse saatmispiirangu eest. 0 = ei saadeta midagi.',
              'A ceiling that guards against a repeated run and the shared hosting’s sending limit. 0 = nothing is sent.',
            )}
          </p>
        </div>

        <div>
          <label className="label flex items-center gap-1.5">
            <FlaskConical size={11} /> {t('Testaadress', 'Test address')}
          </label>
          <input
            type="email" value={e.testAadress ?? ''}
            onChange={ev => patch({ testAadress: ev.target.value.trim() || null })}
            placeholder={t('tühi = päris saajad', 'empty = real recipients')}
            className={`input ${e.testAadress && !testOk ? 'border-rose-400' : ''}`}
          />
          <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
            {t('Kui täidetud, läheb', 'When filled in,')} <strong>{t('iga', 'every')}</strong>{' '}
            {t(
              'kiri siia, mitte patsiendile. Sama kood, sama kiri, sama limiit — üks aadress. Soovitan esimene nädal nii hoida.',
              'email goes here, not to the patient. Same code, same email, same limit — one address. Worth keeping it this way for the first week.',
            )}
          </p>
        </div>
      </div>

      {/* ── The letter ── */}
      <div className="pt-4 border-t border-ink-faint/20 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('Kirja tekst', 'Email text')}</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            {t(
              'Arve ise on kirja sees alati — päis, rekvisiidid, read, summad, makseinfo. Siin on sõnad selle',
              'The invoice itself is always in the email — header, company details, lines, totals, payment details. These are the words',
            )}{' '}
            <strong>{t('ümber', 'around')}</strong>
            {t(': tervitus enne ja allkiri järel.', ' it: a greeting before and a signature after.')}
          </p>
        </div>

        <div>
          <label className="label">{t('Pealkiri', 'Subject')}</label>
          <input
            type="text" value={e.pealkiri}
            onChange={ev => patch({ pealkiri: ev.target.value })}
            className="input"
          />
        </div>

        <div>
          <label className="label">{t('Sissejuhatus — arve kohal', 'Introduction — above the invoice')}</label>
          <textarea
            value={e.sissejuhatus} rows={5}
            onChange={ev => patch({ sissejuhatus: ev.target.value })}
            className="input resize-none font-mono text-xs leading-relaxed"
          />
        </div>

        <div>
          <label className="label">{t('Lõpp — arve all', 'Closing — below the invoice')}</label>
          <textarea
            value={e.lopp} rows={3}
            onChange={ev => patch({ lopp: ev.target.value })}
            className="input resize-none font-mono text-xs leading-relaxed"
          />
        </div>

        <div>
          <p className="text-[11px] font-medium text-ink-muted mb-1">
            {t('Kohatäited — klõpsa, et lisada sissejuhatusse', 'Placeholders — click to add to the introduction')}
          </p>
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_TOKENS.map(tok => (
              <button
                key={tok.token}
                type="button"
                title={tok.selgitus}
                onClick={() => patch({ sissejuhatus: `${e.sissejuhatus}${tok.token}` })}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-sidebar text-ink-muted hover:text-accent transition-colors"
              >
                {tok.token}
              </button>
            ))}
          </div>
        </div>

        {/* Rendered with the SAME functions the sender uses, so the preview
            cannot promise wording the patient does not get. */}
        {unknown.length > 0 && (
          <p className="text-[11px] text-orange-600">
            {t('Tundmatu kohatäide:', 'Unknown placeholder:')} {unknown.map(token => `{${token}}`).join(', ')}{' '}
            {t('— jõuab kirja sellisena, nagu on kirjutatud.', '— it goes into the email exactly as written.')}
          </p>
        )}

        <div className="rounded-xl border border-ink-faint/20 bg-white p-3">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider mb-2">
            {t('Eelvaade', 'Preview')}
          </p>
          <p className="text-xs font-semibold text-ink mb-2">
            {renderTemplate(e.pealkiri, PREVIEW_VARS)}
          </p>
          <p className="text-[11px] text-ink-soft whitespace-pre-line leading-relaxed">
            {renderTemplate(e.sissejuhatus, PREVIEW_VARS)}
          </p>
          <div className="my-2 border-t border-dashed border-ink-faint/30 py-2">
            <p className="text-[10px] text-ink-faint italic">{t('[ arve — päis, read, summad, makseinfo ]', '[ invoice — header, lines, totals, payment details ]')}</p>
          </div>
          <p className="text-[11px] text-ink-soft whitespace-pre-line leading-relaxed">
            {renderTemplate(e.lopp, PREVIEW_VARS)}
          </p>
        </div>
      </div>

      {/* ── Is the automation alive? ──
          Separate from "is it allowed", because the two fail differently. Every
          switch can be green and nothing move: `pg_cron` calls the function
          through `net.http_post`, which is ASYNC — cron records "succeeded" the
          moment the request is queued, so a 401 from a wrong key looks exactly
          like a working night. The sender stamps this itself, so a stale time
          is the only visible symptom. It happened on 02.09.2026. */}
      {e.saatmineLubatud && (
        <div className={`rounded-xl border p-3 ${
          heartbeat.stale ? 'border-orange-200 bg-orange-50/60' : 'border-ink-faint/20'
        }`}>
          <div className="flex items-start gap-2">
            <Clock size={13} className={`flex-shrink-0 mt-0.5 ${
              heartbeat.stale ? 'text-orange-600' : 'text-ink-faint'
            }`} />
            <div className="min-w-0">
              <p className="text-xs text-ink">
                <strong>{t('Ajastatud saatja käis viimati:', 'Scheduled sender last ran:')}</strong> {heartbeat.text}
              </p>
              {heartbeat.stale && (
                <p className="text-[11px] text-orange-800 leading-relaxed mt-0.5">
                  {t(
                    'Peaks käima igal tunnil. Kontrolli Supabase SQL-redaktoris, mida funktsioon päriselt vastas —',
                    'It should run every hour. Check in the Supabase SQL editor what the function actually answered —',
                  )}{' '}
                  <code>cron.job_run_details</code>{' '}
                  {t('ütleb „succeeded" ka siis, kui vastus oli 401:', 'says “succeeded” even when the answer was 401:')}
                  <br />
                  <code className="text-[10px]">
                    select status_code, left(content,200), created from net._http_response order by created desc limit 5;
                  </code>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Where it stands ── */}
      <div className={`rounded-xl border p-3 ${
        blockers.length === 0
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-orange-200 bg-orange-50/60'
      }`}>
        {blockers.length === 0 ? (
          <p className="text-xs text-emerald-900">
            <strong>{t('Saatmine on lubatud.', 'Sending is allowed.')}</strong>{' '}
            {e.testAadress
              ? t(`Kirjad lähevad testaadressile ${e.testAadress}, mitte patsientidele.`, `Emails go to the test address ${e.testAadress}, not to patients.`)
              : t('Kirjad lähevad päris saajatele.', 'Emails go to the real recipients.')}
          </p>
        ) : (
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} className="text-orange-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-orange-900">
              <strong>{t('Ei saadeta midagi.', 'Nothing is sent.')}</strong> {blockers.join('; ')}.
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
