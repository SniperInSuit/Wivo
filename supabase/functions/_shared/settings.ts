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
