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
import { publishProblems } from '@shared/portal/publicQuote'
import { bookingDuration } from '@shared/portal/publicService'
import { openWindows } from '@shared/portal/slots'
import type { BookingConfig } from './BookingHoursSection'

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
  const published = teenused.filter(t => t.avalik && publishProblems(t).length === 0)
  const openDays = broneering
    ? [1, 2, 3, 4, 5, 6, 7].filter(d => openWindows(broneering, d).length > 0)
    : []
  // A service can only be offered a time if it says how long it takes. Without
  // that the slot picker refuses rather than guessing a chair length.
  const withDuration = published.filter(t => bookingDuration(t) > 0)

  const checks: Check[] = [
    {
      ok: !!slug?.trim(),
      label: 'Kliinikul on avalik aadress (slug)',
      fix: 'Seaded → Kliinik → Avalik aadress. Ilma selleta vastab funktsioon 404-ga.',
    },
    {
      ok: published.length > 0,
      label: `Avaldatud teenuseid: ${published.length}`,
      fix: 'Märgi vähemalt üks teenus avalikuks ja täida selle puuduvad väljad.',
    },
    {
      ok: withDuration.length > 0,
      label: `Kestusega teenuseid: ${withDuration.length}`,
      fix: 'Teenusel peab olema „Visiidi kestus (min)". Ilma selleta ei paku vorm '
        + 'aegu — vale pikkusega tooli broneerimine oleks halvem.',
    },
    {
      ok: openDays.length > 0,
      label: openDays.length > 0
        ? `Lahtiolekupäevi nädalas: ${openDays.length}`
        : 'Tööaegu ei ole määratud',
      fix: 'Veebibroneeringu ajad allpool. Päev ilma kellaaegadeta on KINNI — '
        + 'see on tahtlik, et unustatud seade ei avaks päevikut.',
    },
    {
      ok: (broneering?.visiiditasu ?? 0) === 0,
      soft: true,
      label: (broneering?.visiiditasu ?? 0) === 0
        ? 'Visiiditasu ei küsita — sobib demoks'
        : `Visiiditasu ${broneering?.visiiditasu} € on sees`,
      fix: 'Ilma Montonio võtmeteta jäetakse tasu vaikselt vahele ja taotlus tuleb '
        + 'ikka kohale. Demo ajaks võib tasu 0 peale jätta.',
    },
  ]

  const blocking = checks.filter(c => !c.ok && !c.soft)

  return (
    <div className="rounded-xl border border-ink-faint/25 p-3">
      <p className="text-xs font-semibold text-ink-soft mb-2">
        Veebibroneeringu valmidus
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
            ? 'Wivo pool on valmis. Jääb kaks käsku sinu terminalis:'
            : 'Kui ülal olevad punased on tehtud, siis terminalis:'}
        </p>
        <pre className="text-[10px] bg-bg-sidebar rounded-lg p-2 overflow-x-auto text-ink-muted leading-relaxed">
{`supabase secrets set \\
  PUBLIC_BOOKING_ORIGINS="https://sinu-leht.ee" \\
  IP_HASH_PEPPER="$(openssl rand -hex 32)"

supabase functions deploy public-booking --no-verify-jwt`}
        </pre>
        <p className="text-[10px] text-ink-faint mt-1">
          Montonio võtmeid ei ole demoks vaja — ilma nendeta jäetakse makse vahele
          ja taotlus tuleb ikka kohale.
        </p>
      </div>
    </div>
  )
}
