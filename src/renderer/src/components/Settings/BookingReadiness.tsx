/**
 * Is the website booking flow actually ready?
 *
 * Every one of these failures looks the same from the outside — the form shows
 * no times — and each has a different cause. Without this panel the answer to
 * "why does it say no free times" is a guessing game across four screens, a
 * secret and a slug.
 *
 * It checks only what Wivo can see. Whether the function is deployed and whether
 * the origin is allowed are answered by a request from the page itself, so those
 * two are listed as steps to run rather than as ticks.
 */
import { Check, X, AlertTriangle } from 'lucide-react'
import type { PublicService } from '@shared/portal/publicService'
import { publishProblems, bookingDuration } from '@shared/portal/publicQuote'

import { openWindows } from '@shared/portal/slots'
import type { BookingConfig } from './BookingHoursSection'
import { t } from '@/lib/i18n'

interface Check {
  ok: boolean
  /** Not an error — the flow works without it. */
  soft?: boolean
  label: string
  fix: string
}

export function BookingReadiness({ slug, teenused, broneering }: {
  slug: string | null
  teenused: PublicService[]
  broneering: BookingConfig | null
}) {
  const published = teenused.filter(service => service.avalik && publishProblems(service).length === 0)
  const openDays = broneering
    ? [1, 2, 3, 4, 5, 6, 7].filter(d => openWindows(broneering, d).length > 0)
    : []
  // A service can only be offered a time if it says how long it takes. Without
  // that the slot picker refuses rather than guessing a chair length.
  const withDuration = published.filter(service => bookingDuration(service) > 0)

  const checks: Check[] = [
    {
      ok: !!slug?.trim(),
      label: t('Kliinikul on avalik aadress (slug)', 'The clinic has a public address (slug)'),
      fix: t(
        'Seaded → Kliinik → Avalik aadress. Ilma selleta vastab funktsioon 404-ga.',
        'Settings → Clinic → Public address. Without it the function answers with a 404.',
      ),
    },
    {
      ok: published.length > 0,
      label: t(`Avaldatud teenuseid: ${published.length}`, `Published services: ${published.length}`),
      fix: t(
        'Märgi vähemalt üks teenus avalikuks ja täida selle puuduvad väljad.',
        'Mark at least one service as public and fill in its missing fields.',
      ),
    },
    {
      ok: withDuration.length > 0,
      label: t(`Kestusega teenuseid: ${withDuration.length}`, `Services with a duration: ${withDuration.length}`),
      fix: t(
        'Teenusel peab olema „Visiidi kestus (min)". Ilma selleta ei paku vorm '
          + 'aegu — vale pikkusega tooli broneerimine oleks halvem.',
        'A service needs a “Visit length (min)”. Without it the form offers no '
          + 'times — booking a chair for the wrong length would be worse.',
      ),
    },
    {
      ok: openDays.length > 0,
      label: openDays.length > 0
        ? t(`Lahtiolekupäevi nädalas: ${openDays.length}`, `Open days per week: ${openDays.length}`)
        : t('Tööaegu ei ole määratud', 'No opening hours set'),
      fix: t(
        'Veebibroneeringu ajad allpool. Päev ilma kellaaegadeta on KINNI — '
          + 'see on tahtlik, et unustatud seade ei avaks päevikut.',
        'Online booking hours, below. A day with no hours is CLOSED — '
          + 'on purpose, so a forgotten setting never opens the diary.',
      ),
    },
    {
      ok: (broneering?.visiiditasu ?? 0) === 0,
      soft: true,
      label: (broneering?.visiiditasu ?? 0) === 0
        ? t('Visiiditasu ei küsita — sobib demoks', 'No visit fee is charged — fine for a demo')
        : t(`Visiiditasu ${broneering?.visiiditasu} € on sees`, `Visit fee of ${broneering?.visiiditasu} € is on`),
      fix: t(
        'Ilma Montonio võtmeteta jäetakse tasu vaikselt vahele ja taotlus tuleb '
          + 'ikka kohale. Demo ajaks võib tasu 0 peale jätta.',
        'Without Montonio keys the fee is quietly skipped and the request still '
          + 'arrives. For a demo the fee can stay at 0.',
      ),
    },
  ]

  const blocking = checks.filter(c => !c.ok && !c.soft)

  return (
    <div className="rounded-xl border border-ink-faint/25 p-3">
      <p className="text-xs font-semibold text-ink-soft mb-2">
        {t('Veebibroneeringu valmidus', 'Online booking readiness')}
      </p>

      <div className="space-y-1">
        {checks.map(c => (
          <div key={c.label} className="flex items-start gap-2">
            {c.ok
              ? <Check size={12} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              : c.soft
                ? <AlertTriangle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                : <X size={12} className="text-red-500 flex-shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <p className={`text-xs ${c.ok ? 'text-ink-muted' : 'text-ink'}`}>{c.label}</p>
              {!c.ok && <p className="text-[10px] text-ink-faint">{c.fix}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Deployment cannot be checked from here, so it is named as a step. */}
      <div className="mt-3 pt-2.5 border-t border-ink-faint/15">
        <p className="text-[11px] text-ink-muted mb-1">
          {blocking.length === 0
            ? t('Wivo pool on valmis. Jääb kaks käsku sinu terminalis:', 'Wivo’s side is ready. Two commands are left, in your terminal:')
            : t('Kui ülal olevad punased on tehtud, siis terminalis:', 'Once the red items above are done, in the terminal:')}
        </p>
        <pre className="text-[10px] bg-bg-sidebar rounded-lg p-2 overflow-x-auto text-ink-muted leading-relaxed">
{`supabase secrets set \\
  PUBLIC_BOOKING_ORIGINS="${t('https://sinu-leht.ee', 'https://your-site.com')}" \\
  IP_HASH_PEPPER="$(openssl rand -hex 32)"

supabase functions deploy public-booking --no-verify-jwt`}
        </pre>
        <p className="text-[10px] text-ink-faint mt-1">
          {t(
            'Montonio võtmeid ei ole demoks vaja — ilma nendeta jäetakse makse vahele ja taotlus tuleb ikka kohale.',
            'A demo doesn’t need Montonio keys — without them the payment is skipped and the request still arrives.',
          )}
        </p>
      </div>
    </div>
  )
}
