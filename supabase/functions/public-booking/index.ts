/**
 * The public surface — the only thing a patient's browser talks to.
 *
 * ONE function, not three. Three would mean three cold starts, three CORS
 * policies, three rate limiters and three copies of the allowlist mapper, and
 * having one of each is the entire point.
 *
 * Deployed with --no-verify-jwt: the alternative is shipping the anon key inside
 * a public Framer bundle. RLS makes that survivable but it hands the world a
 * working PostgREST credential for no benefit. The origin allowlist plus rate
 * limiting is the smaller surface.
 *
 * ROUTES
 *   GET  /public-booking/services?clinic=<slug>
 *   POST /public-booking/quote?clinic=<slug>
 *   POST /public-booking/request?clinic=<slug>
 *
 * `/request` takes an appointment REQUEST, not a booking. It answers "received"
 * and nothing else — no id, no status, no link back. A patient-facing view of
 * their own care is the MDR line this product does not cross, and a status link
 * is exactly that view wearing a convenience's clothes.
 *
 * Real slots and confirmed bookings would need the practice calendar, which
 * lives in Dentas. The inbox in Wivo is what closes that loop by hand, and it
 * needs no Dentas at all.
 */
import { preflight, corsHeaders } from '../_shared/cors.ts'
import { ok, fail, failWith, ERRORS } from '../_shared/respond.ts'
import { ipKey, take } from '../_shared/ratelimit.ts'
import {
  clinicBySlug, publicServicesOf, insertVisitRequest, recentRequestCount,
} from '../_shared/settings.ts'
import { toPublicCatalogue } from '@shared/portal/publicQuote.ts'
import {
  visitRequestProblems, looksLikeSpam, toVisitRequestRow,
} from '@shared/portal/visitRequest.ts'
import { calculatePublic } from '@shared/portal/publicCalculator.ts'
import type { CalculatorSelection } from '@shared/portal/publicCalculator.ts'
import type { VisitRequestInput } from '@shared/portal/visitRequest.ts'

/**
 * Requests per hour per hashed IP per clinic, counted in the DATABASE.
 *
 * Six is generous for a person — a family booking one after another — and
 * nowhere near enough to be worth automating. The in-memory bucket still runs
 * in front of it to keep obvious floods off the database entirely.
 */
const REQUESTS_PER_HOUR = 6

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre

  const cors = corsHeaders(req.headers.get('origin'))
  const url = new URL(req.url)
  // The deployed path is /public-booking/<route>; strip the function name so the
  // same file works when invoked directly in local dev.
  const route = url.pathname.replace(/^\/public-booking/, '') || '/'

  try {
    if (req.method === 'GET' && (route === '/services' || route === '/services/')) {
      if (!take(await ipKey(req), 60)) {
        return fail(429, ERRORS.RATE_LIMITED, cors)
      }

      const slug = (url.searchParams.get('clinic') ?? '').trim()
      if (!slug) return fail(400, ERRORS.UNKNOWN_CLINIC, cors)

      const clinic = await clinicBySlug(slug)
      if (!clinic) return fail(404, ERRORS.UNKNOWN_CLINIC, cors)

      const services = await publicServicesOf(clinic.id)

      // toPublicCatalogue is the SAME function the desktop preview renders from
      // (shared/portal/publicQuote.ts). It drops unpublished and unpublishable
      // services and builds the DTO field by field — see its doc comment for why
      // it is an allowlist and not a delete-the-cost-fields pass.
      const data = toPublicCatalogue(services, {
        nimi: clinic.nimi,
        telefon: clinic.telefon,
        email: clinic.email,
      })

      return ok(data, {
        ...cors,
        // The catalogue changes when someone edits Seaded, which is rare. Five
        // minutes keeps a busy page off the database without making a price
        // correction feel stuck.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      })
    }

    /**
     * What the patient's selection costs. A READ that happens to be a POST,
     * because the selection is a list and a query string is the wrong place
     * for one.
     *
     * The arithmetic lives here and not in the widget on purpose: a price on a
     * public page is a commercial statement, and two implementations of it will
     * one day disagree in front of a patient. The widget renders the strings
     * this returns.
     */
    if (req.method === 'POST' && (route === '/quote' || route === '/quote/')) {
      const ip = await ipKey(req)
      // Looser than /request — this one only reads, and a person moving teeth
      // around on the map legitimately asks many times in a minute.
      if (!take(`q:${ip}`, 60)) return fail(429, ERRORS.RATE_LIMITED, cors)

      const slug = (url.searchParams.get('clinic') ?? '').trim()
      const clinic = slug ? await clinicBySlug(slug) : null
      if (!clinic) return fail(404, ERRORS.UNKNOWN_CLINIC, cors)

      let selection: CalculatorSelection[]
      try {
        const body = await req.json() as { valik?: CalculatorSelection[] }
        selection = Array.isArray(body?.valik) ? body.valik : []
      } catch {
        return fail(400, ERRORS.INVALID, cors)
      }

      // Straight from the published catalogue. A price the patient sees is by
      // construction a price the clinic published — there is no second list.
      const quote = calculatePublic(await publicServicesOf(clinic.id), selection)
      // Never cached: a stale price is the one thing this route must not serve.
      return ok(quote, { ...cors, 'Cache-Control': 'no-store' })
    }

    if (req.method === 'POST' && (route === '/request' || route === '/request/')) {
      // Much tighter than the catalogue's 60/min: this one writes.
      const ip = await ipKey(req)
      if (!take(`w:${ip}`, 5)) return fail(429, ERRORS.RATE_LIMITED, cors)

      const slug = (url.searchParams.get('clinic') ?? '').trim()
      const clinic = slug ? await clinicBySlug(slug) : null
      if (!clinic) return fail(404, ERRORS.UNKNOWN_CLINIC, cors)

      let body: VisitRequestInput
      try {
        body = await req.json() as VisitRequestInput
      } catch {
        return fail(400, ERRORS.INVALID, cors)
      }

      // A bot gets the same 200 a person gets. Telling it that it was caught is
      // free information for whoever is writing the next one, and the patient
      // who somehow tripped it is not helped by an error either.
      if (looksLikeSpam(body)) return ok({ saadetud: true }, cors)

      // The SAME validator the widget runs. The widget's copy is a courtesy;
      // this one is the rule, because the widget is public code.
      const problems = visitRequestProblems(body)
      if (problems.length > 0) return failWith(400, ERRORS.INVALID, problems, cors)

      // Only a PUBLISHED service may be asked for. Without this the field is an
      // arbitrary string a stranger writes into the clinic's inbox.
      const wanted = (body.serviceId ?? '').trim()
      if (wanted) {
        const published = toPublicCatalogue(
          await publicServicesOf(clinic.id),
          { nimi: clinic.nimi, telefon: clinic.telefon, email: clinic.email },
        )
        if (!published.services.some(t => t.id === wanted)) {
          return fail(400, ERRORS.UNKNOWN_SERVICE, cors)
        }
      }

      // The durable half of the rate limit — see recentRequestCount.
      if (await recentRequestCount(clinic.id, ip) >= REQUESTS_PER_HOUR) {
        return fail(429, ERRORS.RATE_LIMITED, cors)
      }

      await insertVisitRequest({
        ...toVisitRequestRow(body),
        clinic_id: clinic.id,
        ip_hash: ip,
      })

      // Deliberately says nothing more than "received". No id, no status, no
      // link to follow: a patient-facing view of their own care is the MDR line
      // this product does not cross (project_no_patient_portal).
      return ok({ saadetud: true }, cors)
    }

    return fail(404, ERRORS.NOT_FOUND, cors)
  } catch (err) {
    // Never let an internal message reach the page: it can name a column.
    console.error('public-booking failed', err)
    return fail(500, ERRORS.SERVER, cors)
  }
})
