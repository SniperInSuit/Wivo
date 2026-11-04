/**
 * Pay and tax settings (sql/117): employment type, pay basis, pension
 * percentage, tax-free income and rush multiplier. Not readable from
 * `profiles`; pay_settings() returns one's own, and everyone's (former
 * members included) for Manage payroll, the owner and admins.
 */
import { supabase } from './supabase'
import type { Profile } from './supabase'

export const PAY_FIELDS = ['toosuhe', 'tasu_arvestus', 'kogumispension_protsent', 'maksuvaba_tulu', 'kiirtoo_kordaja'] as const

export type PaySettings = { profile_id: string } & Pick<Profile, (typeof PAY_FIELDS)[number]>

/**
 * What the database lets this person see. A database without sql/117 has no
 * pay_settings(): the fields are read from the table as before, so payroll
 * keeps its numbers until the migration is applied.
 */
export async function fetchPaySettings(clinicId: string): Promise<PaySettings[]> {
  const { data, error } = await supabase.rpc('pay_settings')
  if (!error) return (data ?? []) as PaySettings[]
  if (error.code !== 'PGRST202' && error.code !== '42883') throw error
  const old = await supabase.from('profiles').select(`id, ${PAY_FIELDS.join(', ')}`).eq('clinic_id', clinicId)
  if (old.error) throw old.error
  return ((old.data ?? []) as unknown as (Record<string, unknown> & { id: string })[])
    .map(({ id, ...rest }) => ({ profile_id: id, ...rest }) as PaySettings)
}

/** Each profile with its pay settings where they are known; the others without. */
export function withPaySettings<P extends { id: string }>(profiles: P[], pay: PaySettings[]): (P & Partial<PaySettings>)[] {
  const byId = new Map(pay.map(p => [p.profile_id, p]))
  return profiles.map(p => {
    const settings = byId.get(p.id)
    if (!settings) return p
    const { profile_id: _, ...fields } = settings
    return { ...p, ...fields }
  })
}
