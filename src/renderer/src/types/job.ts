import type { DeliveryStatus } from './customer'

// Pipeline stage keys — now an open string so custom stages are possible
export type StageKey = string

// A single revision / change request on a job
export interface Revision {
  id: string          // crypto.randomUUID()
  ts: string          // ISO datetime — when revision was logged
  note: string        // description of what needs to change
  hambad?: string     // revised tooth selection (FDI comma-separated)
  varv?: string       // revised shade code
  materjal?: string   // revised material
  deadline?: string   // new deadline (ISO datetime)
  price?: number      // cost charged for this revision (€)
  kiirtoo?: boolean   // fast/rush revision — price × 2
  mudel?: boolean     // revision requires a model
  taspidev?: boolean  // billable? undefined/true = paid per rules, false = lab fault, skip earnings
  status?: StageKey   // pipeline stage for this revision (default: 'disain')
  // Millal muudatus tegelikult valmis sai. Nagu tööl: deadline on plaan, palka
  // makstakse selle järgi, mis juhtus. Pannakse valmis-etappi liikumisel.
  valmis_kuupaev?: string
  print_id?: string   // SprintRay job number for this revision's print
  // Why the revision was needed. A remake often has more than one cause — the
  // shade was wrong AND the fit was poor — and forcing a single choice made the
  // reason statistics quietly lossy.
  reasons?: string[]
  /** Legacy single reason, written before 1.24.0. Read through revisionReasons(). */
  reason?: string
  /** Teeth that broke — recorded when "Purunemine" reason is selected */
  purunenud_hambad?: string
  /** Work items affected by this revision — same structure as Job.work_items */
  work_items?: WorkItem[]
  /**
   * Who redid it, and who redesigned it. Undefined means "whoever is on the
   * job" — which is what every revision written before these existed meant,
   * so nothing had to be backfilled.
   *
   * They exist because a remake is often not done by the person who did the
   * original: the pay engine used to hand every revision to `job.assigned_to`,
   * so the wrong technician was paid whenever someone else picked it up.
   * `revisions` is a JSONB column, so this needed no migration.
   */
  assigned_to?: string | null
  designed_by?: string | null
}

/** Every reason on a revision, old shape or new. Use this, never `rev.reason`. */
export function revisionReasons(rev: Pick<Revision, 'reasons' | 'reason'>): string[] {
  if (Array.isArray(rev.reasons) && rev.reasons.length > 0) {
    return rev.reasons.map(r => r.trim()).filter(Boolean)
  }
  return rev.reason?.trim() ? [rev.reason.trim()] : []
}

/** For labels and tooltips. */
export const revisionReasonLabel = (rev: Pick<Revision, 'reasons' | 'reason'>): string =>
  revisionReasons(rev).join(', ')

// Pre-defined revision reasons — free text is also allowed
export const REVISION_REASONS = [
  'Vale disain',
  'Vale värv',
  'Vale materjal',
  'Vale hammas',
  'Halb passivus',
  'Purunemine',
  'Patsiendi soov',
  'Arsti soov',
  'Muu',
] as const

// A dated note on a job. Same shape as PatientNote — kept as its own type so the
// two can diverge (a job note may later carry a stage, a patient note will not).
export interface JobNote {
  id: string      // crypto.randomUUID()
  ts: string      // ISO datetime
  autor: string   // author name, from useSettings().kasutajaNimi
  tekst: string
}

// A single piece of work within a job — one work type applied to specific teeth.
// A job can have multiple: e.g. 10 crowns + 4 bridges on different teeth.
export interface WorkItem {
  id: string              // crypto.randomUUID()
  too: string             // work type name (matches WorkType.nimi)
  hambad: string          // FDI comma-separated for this item, e.g. "14,15,16"
  bridge?: boolean        // true = teeth form a connected bridge unit
  materjal?: string       // material for this specific work item
  note?: string           // optional per-item note
}

/** Canonical work items for a job, whether it uses the new or old shape. */
export function jobWorkItems(job: Pick<Job, 'work_items' | 'too' | 'hambad'>): WorkItem[] {
  if (Array.isArray(job.work_items) && job.work_items.length > 0) {
    // SPREAD each stored object — never rebuild field by field (see HANDOFF.md)
    return job.work_items.map(item => ({ ...item }))
  }
  if (!job.too && !job.hambad) return []
  return [{ id: 'legacy', too: job.too ?? '', hambad: job.hambad ?? '' }]
}

/** All distinct work type names across a job's items. */
export function jobWorkTypeNames(job: Pick<Job, 'work_items' | 'too' | 'hambad'>): string[] {
  return jobWorkItems(job).map(i => i.too).filter(Boolean)
}

/**
 * The date a job counts as happening on. THE answer for every period filter.
 *
 * The COMPLETION date first, because that is when the work happened. The
 * deadline is the fallback for anything still on the bench — a job due on
 * Thursday belongs in Thursday's week even though nobody has finished it — and
 * the received date the fallback after that, for rows predating both.
 *
 * One function because three screens were each deciding this for themselves:
 * the Ülevaade counted by arrival date, Rahandus and Töötasud by completion.
 * The same "See kuu" button therefore meant two different things depending on
 * which tab you were on, and neither was labelled.
 */
export const jobPeriodDate = (
  job: Pick<Job, 'valmis_kuupaev' | 'valmis_aeg' | 'kuupaev'>
): string => (job.valmis_kuupaev ?? job.valmis_aeg ?? job.kuupaev ?? '').slice(0, 10)

/** All teeth from all work items, deduplicated. */
export function jobAllTeeth(job: Pick<Job, 'work_items' | 'too' | 'hambad'>): string {
  const items = jobWorkItems(job)
  const set = new Set<string>()
  for (const item of items) {
    for (const t of item.hambad.split(',')) {
      const trimmed = t.trim()
      if (trimmed) set.add(trimmed)
    }
  }
  return [...set].join(',')
}

// An extra service added to a specific job, copied from settings.lisateenused
export interface JobExtra {
  id: string      // matches ExtraService.id
  nimi: string    // copied at add time (so renaming the service doesn't rewrite history)
  hind: number    // € — can be overridden per job
}

// Full Job record matching the Supabase `jobs` table
export interface Job {
  id: string
  status: StageKey
  // --- Core fields (Estonian UI labels) ---
  kuupaev: string           // Kuupäev — date received (YYYY-MM-DD)
  patsient: string          // Patsient — patient name (kept denormalised for display + legacy rows)
  patient_id: string | null // FK → patients.id (null = not linked to a patient record yet)
  // --- Who ordered it (migration 035) ---
  // The dental practice that sent the case. Null on everything predating the
  // customer table, and on work a lab does for itself.
  customer_id: string | null   // FK → customers.id
  // The ordering practice's OWN case number, as they wrote it. The only
  // identifier a public status link may show — see sql/035.
  customer_ref: string | null
  too: string | null        // Töö — work type (crown, bridge, veneer…)
  materjal: string | null   // Materjal — resin material (may include shade, e.g. "Ceramic Crown HT A2")
  masina: string | null     // Masin — printer (Pro2, Midas)
  print_id: string | null   // Print ID — SprintRay job number for lookup
  disain_id: string | null  // Disain ID — design file or job reference
  varv: string | null       // Värv — VITA shade
  hambad: string | null     // Ham — FDI tooth numbers, e.g. "11,21"
  kirjeldus: string | null  // Kirjeldus — free-text description of the work
  valmis_aeg: string | null // Valmis aeg — DEADLINE (ISO timestamp), a plan
  // Millal töö tegelikult valmis sai. Eraldi väli tähtajast, sest palka makstakse
  // selle järgi, mis juhtus, mitte selle järgi, mis oli plaanis (migratsioon 025).
  valmis_kuupaev: string | null
  kiirtoo: boolean          // Kiirtöö — rush job, price × 2
  mudel?: boolean           // Mudel — requires a printed model for try-in
  // Where the work physically is. The pipeline ending at "done" says the bench
  // has finished with it, not that the practice has it (migration 035).
  delivery_status: DeliveryStatus
  delivered_at: string | null
  // --- Work items (migration 0XX) — multiple work types per job ---
  work_items: WorkItem[]    // e.g. [{too:'Kroon', hambad:'11,12'}, {too:'Sild', hambad:'14,15,16'}]
  // --- Revision list ---
  revisions: Revision[]     // Multiple revision entries (stored as JSONB)
  // --- Notes (migration 005) ---
  markused: JobNote[]       // Märkused — timestamped notes with an author (JSONB)
  // --- Legacy single-revision fields (kept for backward compat, no longer written) ---
  muudatused?: string | null
  rev_hambad?: string | null
  rev_varv?: string | null
  uus_valmis?: string | null
  // --- Extra services added to this job (from settings.lisateenused) ---
  extras: JobExtra[]           // e.g. [{id, nimi, hind}]
  // --- Pricing / payment ---
  hind: number | null          // Hind — total price in EUR
  disain_hind: number | null   // Disain hind — design fee (own or third-party)
  makstud: boolean             // Makstud — paid yes/no
  makse_kuupaev: string | null // Makse kuupäev — payment date
  // --- Who did the work (migration 022) — drives worker pay ---
  assigned_to: string | null   // Teostaja — profiles.id
  designed_by: string | null   // Disainija — profiles.id, design is paid separately
  // --- Metadata ---
  created_at: string
  updated_at: string
}

// Partial type for create/edit forms (id and timestamps are server-generated).
// `markused` is omitted deliberately: notes are written by their own panel while
// the job is open, so a form save must never carry a stale snapshot of them back.
export type JobInput = Omit<Job, 'id' | 'created_at' | 'updated_at' | 'markused'>

// Material quick-picks
export const MATERIAL_OPTIONS = [
  'Crown HT',
  'Ceramic Crown',
  'OnX Tough 2',
  'NightGuard Firm 2',
  'Apex Teeth',
  'Apex Base',
  'Retainer',
] as const

// Per-material shade options (shown as sub-selector when material is picked)
export const MATERIAL_SHADES: Partial<Record<string, readonly string[]>> = {
  'Crown HT':      ['A1', 'A2', 'A3', 'BL1', 'BL2'],
  'Ceramic Crown': ['A1', 'A2', 'A3'],
  'OnX Tough 2':   ['A1', 'A2'],
}

// SprintRay printer machines
export const MACHINE_OPTIONS = ['Pro2', 'Midas'] as const

// Work types (suggestions + calendar colours) live in config/workTypes.ts and
// are edited in Seaded → Valikud. Deliberately not duplicated here: two lists
// would drift, and the one the user edits has to be the one the app matches on.
