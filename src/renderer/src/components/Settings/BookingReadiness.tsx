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
      label: t('settings.theClinicHasAPublicAddress'),
      fix: t('settings.settingsClinicPublicAddressWithoutIt'),
    },
    {
      ok: published.length > 0,
      label: t('settings.publishedServices', { publishedCount: published.length }),
      fix: t('settings.markAtLeastOneServiceAs'),
    },
    {
      ok: withDuration.length > 0,
      label: t('settings.servicesWithADuration', { withDurationCount: withDuration.length }),
      fix: t('settings.aServiceNeedsAVisitLength'),
    },
    {
      ok: openDays.length > 0,
      label: openDays.length > 0
        ? t('settings.openDaysPerWeek', { openDaysCount: openDays.length })
        : t('settings.noOpeningHoursSet'),
      fix: t('settings.onlineBookingHoursBelowADay'),
    },
    {
      ok: (broneering?.visiiditasu ?? 0) === 0,
      soft: true,
      label: (broneering?.visiiditasu ?? 0) === 0
        ? t('settings.noVisitFeeIsChargedFine')
        : t('settings.visitFeeOfIsOn', { visiiditasu: broneering?.visiiditasu }),
      fix: t('settings.withoutMontonioKeysTheFeeIs'),
    },
  ]

  const blocking = checks.filter(c => !c.ok && !c.soft)

  return (
    <div className="rounded-xl border border-ink-faint/25 p-3">
      <p className="text-xs font-semibold text-ink-soft mb-2">
        {t('settings.onlineBookingReadiness')}
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
            ? t('settings.wivoSSideIsReadyTwo')
            : t('settings.onceTheRedItemsAboveAre')}
        </p>
        <pre className="text-[10px] bg-bg-sidebar rounded-lg p-2 overflow-x-auto text-ink-muted leading-relaxed">
{`supabase secrets set \\
  PUBLIC_BOOKING_ORIGINS="${t('settings.httpsYourSiteCom')}" \\
  IP_HASH_PEPPER="$(openssl rand -hex 32)"

supabase functions deploy public-booking --no-verify-jwt`}
        </pre>
        <p className="text-[10px] text-ink-faint mt-1">
          {t('settings.aDemoDoesnTNeedMontonio')}
        </p>
      </div>
    </div>
  )
}
