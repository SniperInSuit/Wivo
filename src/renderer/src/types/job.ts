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
  status?: StageKey   // pipeline stage for this revision (default: 'disain')
  print_id?: string   // SprintRay job number for this revision's print
}

// A dated note on a job. Same shape as PatientNote — kept as its own type so the
// two can diverge (a job note may later carry a stage, a patient note will not).
export interface JobNote {
  id: string      // crypto.randomUUID()
  ts: string      // ISO datetime
  autor: string   // author name, from useSettings().kasutajaNimi
  tekst: string
}

// Full Job record matching the Supabase `jobs` table
export interface Job {
  id: string
  status: StageKey
  // --- Core fields (Estonian UI labels) ---
  kuupaev: string           // Kuupäev — date received (YYYY-MM-DD)
  patsient: string          // Patsient — patient name (kept denormalised for display + legacy rows)
  patient_id: string | null // FK → patients.id (null = not linked to a patient record yet)
  too: string | null        // Töö — work type (crown, bridge, veneer…)
  materjal: string | null   // Materjal — resin material (may include shade, e.g. "Ceramic Crown HT A2")
  masina: string | null     // Masin — printer (Pro2, Midas)
  print_id: string | null   // Print ID — SprintRay job number for lookup
  varv: string | null       // Värv — VITA shade
  hambad: string | null     // Ham — FDI tooth numbers, e.g. "11,21"
  valmis_aeg: string | null // Valmis aeg — deadline (ISO timestamp)
  kiirtoo: boolean          // Kiirtöö — rush job, price × 2
  // --- Revision list ---
  revisions: Revision[]     // Multiple revision entries (stored as JSONB)
  // --- Notes (migration 005) ---
  markused: JobNote[]       // Märkused — timestamped notes with an author (JSONB)
  // --- Legacy single-revision fields (kept for backward compat, no longer written) ---
  muudatused?: string | null
  rev_hambad?: string | null
  rev_varv?: string | null
  uus_valmis?: string | null
  // --- Pricing / payment ---
  hind: number | null          // Hind — total price in EUR
  disain_hind: number | null   // Disain hind — design fee (own or third-party)
  makstud: boolean             // Makstud — paid yes/no
  makse_kuupaev: string | null // Makse kuupäev — payment date
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
