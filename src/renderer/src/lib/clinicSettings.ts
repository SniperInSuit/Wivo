/**
 * Clinic settings — the shared half of Seaded, stored in Postgres.
 *
 * Everything here was per-machine localStorage until 1.7.15. That was fine for
 * a theme and wrong for a price list: two workstations in the same clinic could
 * quote different prices for the same work type, and Phase 4 is about to build
 * invoices on those numbers.
 *
 * Shape note: the DB row is split into one jsonb column per section, and writes
 * send only the sections that actually changed. Sending the whole row on every
 * edit would mean the person editing the calendar hours overwrites the price
 * someone else changed a second earlier with their own stale copy.
 */
import { supabase } from './supabase'
import type { WivoSettings, MaterialPricing } from '../stores/useSettings'
import type { PipelineStage } from '../config/pipeline'
import type { WorkType } from '../config/workTypes'

export const CLINIC_COLUMNS = [
  'work_types', 'visit_types', 'public_services', 'materials', 'material_prices', 'material_costs', 'machines',
  'pipeline_stages', 'pricing', 'calendar', 'payroll', 'features',
] as const

export type ClinicColumn = (typeof CLINIC_COLUMNS)[number]

export interface ClinicSettingsRow {
  clinic_id: string
  work_types: WorkType[]
  visit_types: import('../config/visitTypes').VisitType[]
  /** Patient-facing catalogue for the public website. See sql/047. */
  public_services: import('@shared/portal/publicService').PublicService[]
  materials: string[]
  material_prices: Record<string, MaterialPricing>
  material_costs: Record<string, MaterialPricing>
  machines: string[]
  pipeline_stages: PipelineStage[]
  pricing: {
    designFee: number
    defaultMachine: string
    hambaHind: number
    muudatusHambaHind: number
    kiirtooKordaja: number
    kmMaar: number
    makseTahtaegPaevades: number
    fixedCostsPerJob: import('../stores/useSettings').FixedCost[]
    lisateenused: import('../stores/useSettings').ExtraService[]
    yldkulud: import('../stores/useSettings').Overhead[]
  }
  payroll: {
    tooandjaMaksudProtsent: number
  }
  // Which halves of the product this lab uses. See sql/037.
  features: {
    /** Patient record + visit booking. Off = WivoLab, the laboratory product. */
    clinical: boolean
    /** Absent on rows written before 1.33 — read as true, they are all labs. */
    laboratory?: boolean
  }
  calendar: {
    ajajoonAlgus: number
    ajajoonLopp: number
    nadalAlgus: number
    nadalLopp: number
    ajaSamm: number
    visiidiKestus: number
  }
  updated_at?: string
}

export type ClinicPatch = Partial<Omit<ClinicSettingsRow, 'clinic_id'>>

/** The clinic-owned slice of the local settings object, as DB columns. */
export function toRow(s: WivoSettings, stages: PipelineStage[]): Omit<ClinicSettingsRow, 'clinic_id'> {
  return {
    work_types: s.tooTuubid,
    visit_types: s.visiidiTyybid,
    public_services: s.avalikudTeenused,
    materials: s.materjalid,
    material_prices: s.materialPrices,
    material_costs: s.materialCosts,
    machines: s.masinad,
    pipeline_stages: stages,
    pricing: {
      designFee: s.designFee,
      defaultMachine: s.defaultMachine,
      hambaHind: s.hambaHind,
      muudatusHambaHind: s.muudatusHambaHind,
      kiirtooKordaja: s.kiirtooKordaja,
      kmMaar: s.kmMaar,
      makseTahtaegPaevades: s.makseTahtaegPaevades,
      // Both were added to WivoSettings and to COLUMN_OF, but never here, so a
      // setter declared `['pricing']`, pushed the pricing column, and wrote it
      // WITHOUT these two fields — the write path silently dropped them while
      // the read path (applyClinicRow spreads row.pricing wholesale) would have
      // taken them fine. Per-job overheads and the extra-service price list
      // therefore never left the machine that typed them.
      fixedCostsPerJob: s.fixedCostsPerJob,
      lisateenused: s.lisateenused,
      yldkulud: s.yldkulud,
    },
    payroll: {
      tooandjaMaksudProtsent: s.tooandjaMaksudProtsent,
    },
    features: {
      clinical: s.kliinilineRezhiim,
      laboratory: s.laboriRezhiim,
    },
    calendar: {
      ajajoonAlgus: s.ajajoonAlgus,
      ajajoonLopp: s.ajajoonLopp,
      nadalAlgus: s.nadalAlgus,
      nadalLopp: s.nadalLopp,
      ajaSamm: s.ajaSamm,
      visiidiKestus: s.visiidiKestus,
    },
  }
}

/** Which DB column each local settings field belongs to. */
export const COLUMN_OF: Record<string, ClinicColumn> = {
  tooTuubid: 'work_types',
  materjalid: 'materials',
  materialPrices: 'material_prices',
  materialCosts: 'material_costs',
  masinad: 'machines',
  designFee: 'pricing',
  defaultMachine: 'pricing',
  hambaHind: 'pricing',
  muudatusHambaHind: 'pricing',
  kiirtooKordaja: 'pricing',
  kmMaar: 'pricing',
  makseTahtaegPaevades: 'pricing',
  tooandjaMaksudProtsent: 'payroll',
  visiidiTyybid: 'visit_types',
  avalikudTeenused: 'public_services',
  kliinilineRezhiim: 'features',
  laboriRezhiim: 'features',
  fixedCostsPerJob: 'pricing',
  lisateenused: 'pricing',
  yldkulud: 'pricing',
  ajajoonAlgus: 'calendar',
  ajajoonLopp: 'calendar',
  nadalAlgus: 'calendar',
  nadalLopp: 'calendar',
  ajaSamm: 'calendar',
  visiidiKestus: 'calendar',
}

export async function fetchClinicSettings(clinicId: string): Promise<ClinicSettingsRow | null> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) throw error
  return (data as ClinicSettingsRow) ?? null
}

/**
 * Seed the clinic's row from whatever this machine already had configured.
 * Deliberately an insert that tolerates a race: if another workstation got
 * there first, theirs wins and we read it back rather than overwriting a
 * colleague's configuration with ours.
 */
export async function seedClinicSettings(
  clinicId: string,
  row: Omit<ClinicSettingsRow, 'clinic_id'>
): Promise<ClinicSettingsRow | null> {
  const { error } = await supabase
    .from('clinic_settings')
    .insert({ clinic_id: clinicId, ...row })
  if (error) {
    // 23505 = unique violation: someone else seeded it between our read and write
    if (error.code !== '23505') throw error
  }
  return fetchClinicSettings(clinicId)
}

export async function pushClinicSettings(clinicId: string, patch: ClinicPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return
  const { error } = await supabase
    .from('clinic_settings')
    .update(patch)
    .eq('clinic_id', clinicId)
  if (error) throw error
}

export function subscribeClinicSettings(
  clinicId: string,
  onChange: (row: ClinicSettingsRow) => void
): () => void {
  const channel = supabase
    .channel(`clinic_settings:${clinicId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'clinic_settings', filter: `clinic_id=eq.${clinicId}` },
      payload => {
        const row = payload.new as ClinicSettingsRow
        if (row?.clinic_id) onChange(row)
      }
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
