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
 *   GET /public-booking/services?clinic=<slug>
 *
 * Slots and booking arrive once the Dentas API is mapped — see the plan. This
 * route deliberately ships first because it needs no Dentas at all, and because
 * deploying it answers the one open question about `shared/` imports.
 */
import { preflight, corsHeaders } from '../_shared/cors.ts'
import { ok, fail, ERRORS } from '../_shared/respond.ts'
import { ipKey, take } from '../_shared/ratelimit.ts'
import { clinicBySlug, publicServicesOf } from '../_shared/settings.ts'
import { toPublicCatalogue } from '@shared/portal/publicQuote.ts'

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

    return fail(404, ERRORS.NOT_FOUND, cors)
  } catch (err) {
    // Never let an internal message reach the page: it can name a column.
    console.error('public-booking failed', err)
    return fail(500, ERRORS.SERVER, cors)
  }
})
