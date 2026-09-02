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
 *   GET  /public-booking/slots?clinic=<slug>&service=<id>
 *   POST /public-booking/quote?clinic=<slug>
 *   POST /public-booking/request?clinic=<slug>
 *
 * `/request` takes an appointment REQUEST, not a booking. It answers "received"
 * and nothing else — no id, no status, no link back. A patient-facing view of
 * their own care is the MDR line this product does not cross, and a status link
 * is exactly that view wearing a convenience's clothes.
 *
 * `/slots` DOES offer real times, from Wivo's own diary and the clinic's own
 * rules (opening hours, breaks, closed days, how much big work a day may take).
 * A chosen time is HELD on the request and checked again at write time — a list
 * is a snapshot, a booking is a decision, and between the two somebody else may
 * have taken it.
 *
 * What it still does not do is put anything in the calendar. A request becomes a
 * visit when a person confirms it in the Wivo inbox. That step is deliberate:
 * the calendar is what the practice runs on, and it must not fill itself.
 */
import { preflight, corsHeaders } from '../_shared/cors.ts'
import { ok, fail, failWith, ERRORS } from '../_shared/respond.ts'
import { ipKey, take } from '../_shared/ratelimit.ts'
import {
  clinicBySlug, publicServicesOf, insertVisitRequest, recentRequestCount,
  bookingSettingsOf, attachPayment, requestByOrderUuid, settlePayment,
} from '../_shared/settings.ts'
import { createOrder, verifyOrderToken, montonioConfigured } from '../_shared/montonio.ts'
import {
  localDate, isoWeekday, dayDiff, dateRange, loadOf, pendingHolds, toInstant,
} from '../_shared/slotData.ts'
import { freeSlots, slotsByDay, slotStillFree } from '@shared/portal/slots.ts'
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

/**
 * One place where a token becomes a settled payment — used by both the browser
 * return and the webhook. True when this call, or an earlier one, left the
 * request paid.
 *
 * The expected AMOUNT comes from the row we wrote when the order was created,
 * so a token claiming a different figure is refused rather than believed.
 */
async function settleFromToken(token: string): Promise<boolean> {
  if (!token) return false

  // Which row is this about? Read the claimed uuid WITHOUT trusting it — it
  // only chooses the row; nothing is written on its strength.
  const uuid = claimedUuid(token)
  if (!uuid) return false

  const row = await requestByOrderUuid(uuid)
  if (!row) return false
  if (row.makse_staatus === 'makstud') return true    // already settled: no-op

  const { verdict, staatus } = await verifyOrderToken(token, {
    uuid,
    summa: Number(row.makse_summa ?? 0),
    valuuta: 'EUR',
  })
  if (!verdict.ok) console.error('makse tagasi lükatud:', verdict.reason, verdict.selgitus)
  await settlePayment(row.id, staatus)
  return verdict.ok
}

/** The uuid a token CLAIMS. Used only to look up the row to verify against. */
function claimedUuid(token: string): string | null {
  try {
    const body = token.split('.')[1]
    if (!body) return null
    const pad = body.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
    return (JSON.parse(json) as { uuid?: string }).uuid ?? null
  } catch { return null }
}

/** Estonian, plain, and it never claims more than it knows. */
function returnPage(paid: boolean, back: string | null): string {
  const style = 'body{font:16px/1.6 system-ui,sans-serif;margin:3rem auto;max-width:34rem;padding:0 1rem}'
  const link = back
    ? `<p><a href="${back.replace(/"/g, '&quot;')}">Tagasi kodulehele</a></p>`
    : ''
  const inner = paid
    ? `<h1>Aitäh, makse on laekunud.</h1>
       <p>Sinu taotlus on meil kirjas ja võtame peagi ühendust, et aeg kokku leppida.</p>`
    // Says the useful thing rather than only the bad thing: the request is
    // stored either way, so nobody needs to fill the form in again.
    : `<h1>Makset ei õnnestunud kinnitada.</h1>
       <p><strong>Sinu taotlus on siiski meil kirjas</strong> — võtame ühendust ka
       siis, kui makse jäi pooleli. Kui raha läks kontolt välja, anna palun teada.</p>`
  return `<!doctype html><html lang="et"><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Wivo</title><style>${style}</style>${inner}${link}`
}

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
     * Free times for one service.
     *
     * The rules, the diary and the load limit all live on the server. The widget
     * renders the list it is given and never works out for itself whether an
     * hour is free — two answers to that question is a double booking.
     */
    if (req.method === 'GET' && (route === '/slots' || route === '/slots/')) {
      if (!take(`s:${await ipKey(req)}`, 60)) return fail(429, ERRORS.RATE_LIMITED, cors)

      const slug = (url.searchParams.get('clinic') ?? '').trim()
      const clinic = slug ? await clinicBySlug(slug) : null
      if (!clinic) return fail(404, ERRORS.UNKNOWN_CLINIC, cors)

      const wanted = (url.searchParams.get('service') ?? '').trim()
      const services = await publicServicesOf(clinic.id)
      const service = services.find(s => s.id === wanted && s.avalik)
      if (!service) return fail(400, ERRORS.UNKNOWN_SERVICE, cors)

      // How long the BOOKABLE visit of this service takes. Not the whole
      // treatment plan: the website books one appointment, and the plan's later
      // visits are arranged when that one happens.
      const step = service.samm?.[service.broneeritavSamm]
      const kestus = Number(step?.kestusMin) || 0
      if (!(kestus > 0)) {
        // A service with no stated duration cannot be offered a time. Saying so
        // beats offering a guess and booking the wrong length of chair.
        return ok({ paevad: [], pohjus: 'Teenusel ei ole kestust määratud.' }, cors)
      }

      const rules = await bookingSettingsOf(clinic.id)
      const today = localDate(new Date())
      const horizon = Math.min(rules.kuni ?? 60, 120)
      const dates = dateRange(today, horizon + 1)

      const load = await loadOf(clinic.id, dates, rules.koormus?.suurMin ?? 0)
      // Requests that already hold a time count as busy. Without this, two
      // visitors an hour apart are offered the same slot and the clinic finds
      // out afterwards.
      for (const hold of await pendingHolds(clinic.id, dates)) {
        const day = load.find(d => d.kuupaev === hold.kuupaev)
        if (day) day.hoivatud.push({ algus: hold.algus, lopp: hold.algus + hold.kestus })
      }

      const slots = freeSlots({
        rules, kestus, paevad: load,
        nadalapaev: isoWeekday,
        tana: today,
        paevaVahe: d => dayDiff(today, d),
      })

      return ok({
        kestus,
        paevad: slotsByDay(slots).slice(0, 30),
      }, { ...cors, 'Cache-Control': 'no-store' })
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

      // What they priced, RE-PRICED here. The browser sends only the selection;
      // the total is computed from the clinic's own list, because a figure a
      // public page could name is a figure anybody can name.
      const valik = Array.isArray((body as { valik?: CalculatorSelection[] }).valik)
        ? (body as { valik: CalculatorSelection[] }).valik
        : []
      const quote = valik.length > 0
        ? calculatePublic(await publicServicesOf(clinic.id), valik)
        : null

      // The chosen time, CHECKED AGAIN. The list the patient saw is a snapshot;
      // this is the decision. Between the two, somebody else may have taken it.
      const wish = (body as { aeg?: { kuupaev: string; kell: string; serviceId: string } }).aeg
      let hold: { soovitud_algus: string; soovitud_kestus: number } | null = null
      if (wish?.kuupaev && wish.kell) {
        const services = await publicServicesOf(clinic.id)
        const svc = services.find(s => s.id === wish.serviceId && s.avalik)
        const kestus = Number(svc?.samm?.[svc.broneeritavSamm]?.kestusMin) || 0
        const rules = await bookingSettingsOf(clinic.id)
        const today = localDate(new Date())
        const dates = dateRange(today, (rules.kuni ?? 60) + 1)
        const load = await loadOf(clinic.id, dates, rules.koormus?.suurMin ?? 0)
        for (const h of await pendingHolds(clinic.id, dates)) {
          const day = load.find(d => d.kuupaev === h.kuupaev)
          if (day) day.hoivatud.push({ algus: h.algus, lopp: h.algus + h.kestus })
        }
        const stillFree = kestus > 0 && slotStillFree({
          rules, kestus, paevad: load,
          nadalapaev: isoWeekday, tana: today, paevaVahe: d => dayDiff(today, d),
        }, wish.kuupaev, wish.kell)

        if (!stillFree) {
          // Refuse rather than store a time the clinic cannot honour. The
          // patient can pick another; a double booking they only find out about
          // on the day is far worse than being asked to choose again.
          return failWith(409, ERRORS.INVALID,
            ['See aeg läks vahepeal kinni. Palun vali teine.'], cors)
        }
        hold = {
          soovitud_algus: toInstant(wish.kuupaev, wish.kell).toISOString(),
          soovitud_kestus: kestus,
        }
      }

      const created = await insertVisitRequest({
        ...toVisitRequestRow(body),
        clinic_id: clinic.id,
        ip_hash: ip,
        // Stored the way an invoice line stores its price: what the person was
        // SHOWN must not change later because the price list did.
        ...(quote ? { valik, hinnang: quote.kokku } : {}),
        ...(hold ?? {}),
      })

      // A visit fee, when the clinic asks for one. The amount is read HERE from
      // the clinic's own settings and NEVER from `body`: a public form that can
      // name its own price is a form where everybody pays one cent.
      const booking = await bookingSettingsOf(clinic.id)
      if (created && booking.visiiditasu > 0 && montonioConfigured()) {
        try {
          const order = await createOrder({
            merchantReference: created,
            summa: booking.visiiditasu,
            valuuta: booking.valuuta,
            returnUrl: `${url.origin}/public-booking/return?clinic=${encodeURIComponent(slug)}`,
            notificationUrl: `${url.origin}/public-booking/webhook`,
            kirjeldus: `Visiiditasu — ${clinic.nimi}`,
          })
          await attachPayment(created, order.uuid, booking.visiiditasu)
          // The request is ALREADY stored. The payment URL is an invitation, not
          // a condition: if the patient never pays, the clinic still has their
          // name and number. Losing the request because a bank page failed would
          // be the worse trade.
          return ok({ saadetud: true, maksmiseks: order.paymentUrl }, cors)
        } catch (err) {
          console.error('montonio order failed', err)
          // Fall through: they asked for an appointment and we have it.
        }
      }

      // Deliberately says nothing more than "received". No id, no status, no
      // link to follow: a patient-facing view of their own care is the MDR line
      // this product does not cross (project_no_patient_portal).
      return ok({ saadetud: true }, cors)
    }

    /**
     * Where Montonio sends the patient's BROWSER. Not proof of anything — a
     * person can type this URL — so it runs the same signed-token check the
     * webhook does, and only then shows a page.
     *
     * It exists alongside the webhook because the webhook can be late, and a
     * patient reading "aitäh" while the clinic still sees "ootel" is a support
     * call. Both paths settle; settling twice is a no-op.
     */
    if (req.method === 'GET' && (route === '/return' || route === '/return/')) {
      const slug = (url.searchParams.get('clinic') ?? '').trim()
      const clinic = slug ? await clinicBySlug(slug) : null
      const paid = await settleFromToken(url.searchParams.get('order-token') ?? '')
      const back = clinic ? (await bookingSettingsOf(clinic.id)).tagasiUrl : null
      return new Response(returnPage(paid, back), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    /**
     * Montonio → us. The authoritative path.
     *
     * Always answers 200, even for a token it refuses: a non-200 makes Montonio
     * retry, and retrying cannot fix a token that belongs to another merchant.
     * What went wrong goes on the row and into the log, where a person can see
     * it.
     */
    if (req.method === 'POST' && (route === '/webhook' || route === '/webhook/')) {
      let token = url.searchParams.get('order-token') ?? ''
      try {
        const body = await req.json() as Record<string, string>
        token = body.orderToken ?? body['order-token'] ?? token
      } catch { /* keep whatever the query string had */ }
      await settleFromToken(token)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }

    return fail(404, ERRORS.NOT_FOUND, cors)
  } catch (err) {
    // Never let an internal message reach the page: it can name a column.
    console.error('public-booking failed', err)
    return fail(500, ERRORS.SERVER, cors)
  }
})
