/**
 * THE ONLY PLACE THIS FUNCTION QUERIES `clinic_settings`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GUARANTEE
 *
 *   .select('public_services')
 *
 * That column list is the strongest of the three defences against leaking the
 * lab's margin, and it is the reason this file exists as a chokepoint. The other
 * two — the allowlist mapper in shared/portal/publicQuote.ts, and the leak test
 * beside it — are belt and braces. THIS one means a mapper bug cannot leak a
 * column that was never fetched.
 *
 * NEVER add to that select. In particular never `select('*')`. The following all
 * live in the same row and are margin or internal:
 *
 *   work_types (incl. kulud, hind, soodushind), material_costs, material_prices,
 *   materials, pricing (designFee, hambaHind, kiirtooKordaja, fixedCostsPerJob,
 *   yldkulud, lisateenused, kmMaar, makseTahtaegPaevades), payroll, machines,
 *   pipeline_stages, features, calendar
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SERVICE KEY
 *
 * `clinic_settings` RLS is `clinic_id = my_clinic_id()`, which reads `profiles`
 * by `auth.uid()`. An anonymous visitor matches nothing. HANDOFF.md forbids the
 * obvious workaround: "Do not enable Supabase anonymous sign-in… Public surfaces
 * go through an edge function holding the service key, never through an anon
 * session." This is that function.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { PublicService } from '@shared/portal/publicService.ts'
import type { BookingRules } from '@shared/portal/slots.ts'

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export interface ClinicPublic {
  id: string
  nimi: string
  telefon: string | null
  email: string | null
}

/** Resolve a public slug to a clinic. Null when the slug is unknown. */
export async function clinicBySlug(slug: string): Promise<ClinicPublic | null> {
  const { data, error } = await admin()
    .from('clinics')
    // Named columns, not '*': a clinic row also carries reg code and IBAN, and
    // there is no reason for those to be one careless spread away from a
    // patient's browser.
    .select('id, name, phone, email')
    .eq('public_slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return { id: data.id, nimi: data.name, telefon: data.phone, email: data.email }
}

/** The catalogue, straight from the column. Nothing else is fetched. */
export async function publicServicesOf(clinicId: string): Promise<PublicService[]> {
  const { data, error } = await admin()
    .from('clinic_settings')
    .select('public_services')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error || !data) return []
  return Array.isArray(data.public_services) ? data.public_services as PublicService[] : []
}

/**
 * Store a visit request. Returns the NEW row's id, or null when this exact
 * submission was already stored.
 *
 * `on conflict do nothing` on (clinic_id, idempotency_key): the same submission
 * twice is one request. The patient sees success either way — telling somebody
 * "you already sent this" when they pressed the button twice is a worse answer
 * than simply agreeing, and it leaks that the first one landed.
 *
 * Null therefore also means "do not create a second payment order": the first
 * submission already got one, and charging twice for one double-click is the
 * exact failure the idempotency key exists to prevent.
 */
export async function insertVisitRequest(row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await admin()
    .from('visit_requests')
    .upsert(row, { onConflict: 'clinic_id,idempotency_key', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  const id = (data?.[0] as { id?: string } | undefined)?.id
  return id ?? null
}

/**
 * How many requests this hashed IP has made to this clinic in the last hour.
 *
 * Read from the TABLE, not from memory. The in-memory bucket in ratelimit.ts
 * resets on every cold start, which is fine for reading a catalogue and useless
 * for a write: a script that pauses long enough for the instance to recycle
 * gets a fresh allowance every time. This one survives, because it counts the
 * rows the abuse actually created.
 */
export async function recentRequestCount(clinicId: string, ipHash: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString()
  const { count, error } = await admin()
    .from('visit_requests')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .eq('ip_hash', ipHash)
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}

/**
 * (removed) `acceptsRequests` used to require a PUBLISHED PRICE LIST before a
 * request could be sent. That conflated two unrelated decisions: publishing
 * prices, and being willing to take an appointment request. A clinic that wants
 * the form without a public price list would have met a 403 it could not
 * explain, on a form that looked completely fine.
 *
 * What actually gates this surface, and is enough:
 *   1. `clinics.public_slug` — set by hand in Seaded. No slug, no address, and
 *      `clinicBySlug` answers 404.
 *   2. `PUBLIC_BOOKING_ORIGINS` — the browser cannot even reach the route from
 *      a page the owner has not listed.
 * Both are deliberate acts by the owner. That is the opt-in.
 */

/**
 * Everything the public surface needs about booking: the fee AND the diary
 * rules. One column, one read — the slot route and the payment step ask the
 * same question and must not get two different answers.
 */
export interface BookingSettings extends BookingRules {
  /** 0 = no fee is asked for. The default, deliberately. */
  visiiditasu: number
  valuuta: string
  /** Where the patient is sent after paying. The clinic's own page. */
  tagasiUrl: string | null
}

/**
 * The booking settings — its OWN named column, so `clinic_settings`' narrow
 * select discipline survives. See the guarantee at the top of this file: no
 * function here may widen a select to `*`, and adding a second named column is
 * how a new setting arrives without weakening that.
 */
export async function bookingSettingsOf(clinicId: string): Promise<BookingSettings> {
  const { data, error } = await admin()
    .from('clinic_settings')
    .select('broneering')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  const b = (!error && data?.broneering) ? data.broneering as Record<string, unknown> : {}
  const fee = Number(b.visiiditasu)
  return {
    // Anything unparseable means no fee. Failing towards "do not charge" is the
    // only safe direction: the opposite would invent a price.
    visiiditasu: Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) / 100 : 0,
    valuuta: typeof b.valuuta === 'string' && b.valuuta.trim() ? b.valuuta.trim().toUpperCase() : 'EUR',
    tagasiUrl: typeof b.tagasiUrl === 'string' && b.tagasiUrl.trim() ? b.tagasiUrl.trim() : null,
    // The diary rules, straight through. `freeSlots` treats a missing weekday
    // as CLOSED, so an unconfigured clinic offers no times rather than all of
    // them — the safe direction for a setting nobody has filled in yet.
    tooajad: (b.tooajad as BookingRules['tooajad']) ?? {},
    pausid: b.pausid as BookingRules['pausid'],
    puhkused: b.puhkused as string[] | undefined,
    samm: Number(b.samm) > 0 ? Number(b.samm) : undefined,
    ette: Number.isFinite(Number(b.ette)) ? Number(b.ette) : undefined,
    kuni: Number(b.kuni) > 0 ? Number(b.kuni) : undefined,
    kohti: Number(b.kohti) > 0 ? Number(b.kohti) : undefined,
    koormus: b.koormus as BookingRules['koormus'],
  }
}

/** Attach a created Montonio order to the request row. */
export async function attachPayment(
  requestId: string, uuid: string, summa: number,
): Promise<void> {
  const { error } = await admin()
    .from('visit_requests')
    .update({ montonio_uuid: uuid, makse_summa: summa, makse_staatus: 'ootel' })
    .eq('id', requestId)
  if (error) throw error
}

/** The row a payment token is about, found by Montonio's own order id. */
export async function requestByOrderUuid(uuid: string): Promise<
  { id: string; makse_summa: number | null; makse_staatus: string } | null
> {
  const { data, error } = await admin()
    .from('visit_requests')
    .select('id, makse_summa, makse_staatus')
    .eq('montonio_uuid', uuid)
    .maybeSingle()
  if (error || !data) return null
  return data as { id: string; makse_summa: number | null; makse_staatus: string }
}

/**
 * Record what the token said.
 *
 * Idempotent by design: a row already `makstud` is left alone. Montonio may
 * call the webhook more than once, and the browser return hits the same code
 * path — settling twice must be a no-op, not a second event.
 */
export async function settlePayment(
  requestId: string, staatus: 'makstud' | 'ootel' | 'ebaonnestus' | 'tuhistatud',
): Promise<void> {
  const patch: Record<string, unknown> = { makse_staatus: staatus }
  if (staatus === 'makstud') patch.makstud_at = new Date().toISOString()
  const { error } = await admin()
    .from('visit_requests')
    .update(patch)
    .eq('id', requestId)
    .neq('makse_staatus', 'makstud')
  if (error) throw error
}
