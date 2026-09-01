// A single dated note on the patient card. Mirrors the Revision shape on jobs
// (types/job.ts:5-17) — same id/ts/free-text idiom, stored as JSONB.
export interface PatientNote {
  id: string      // crypto.randomUUID()
  ts: string      // ISO datetime
  autor: string   // author name, from useSettings().kasutajaNimi
  tekst: string
}

// Full Patient record matching the Supabase `patients` table (migrations 001 + 003)
export interface Patient {
  id: string
  // --- Identity ---
  nimi: string                 // Nimi — full name (required)
  synniaeg: string | null      // Sünniaeg — date of birth (YYYY-MM-DD)
  // --- Contact ---
  telefon: string | null       // Telefon
  email: string | null         // E-post
  // --- Referrer ---
  arst: string | null          // Saatev arst
  kliinik: string | null       // Kliinik
  // --- Ravikaart (health data — GDPR Art. 9 special category) ---
  ravikaart: string | null     // Ravikaart — treatment notes
  allergiad: string | null     // Allergiad
  eelistused: string | null    // Materjali eelistused
  varvi_eelistus: string | null // Värvi eelistused — VITA shade preferences
  lougad: string | null        // Hambumus — occlusion notes
  lougaliiges: string | null   // Lõualiiges — TMJ notes
  // --- Turundus (sql/053) ---
  /**
   * Whether this person may be sent marketing.
   *
   * `kysimata` is NOT `ei`. Every patient predating this column is `kysimata`,
   * because nobody has asked them — and a refusal has to stay distinguishable
   * from "we never got round to it", or the first data tidy-up erases it.
   * A default of `jah` would be consent nobody gave.
   */
  turundusnousolek: 'jah' | 'ei' | 'kysimata'
  /** When it was given or withdrawn. Consent without a time is not provable. */
  nousoleku_aeg: string | null
  // --- Free-form ---
  markmed: string | null       // Üldised märkmed (non-clinical)
  markused: PatientNote[]      // Märkused — timestamped notes (JSONB)
  // --- Metadata ---
  created_at: string
  updated_at: string
}

// Partial type for create/edit forms (id and timestamps are server-generated)
export type PatientInput = Omit<Patient, 'id' | 'created_at' | 'updated_at'>

export const EMPTY_PATIENT: PatientInput = {
  nimi: '',
  synniaeg: null,
  telefon: null,
  email: null,
  arst: null,
  kliinik: null,
  ravikaart: null,
  allergiad: null,
  eelistused: null,
  varvi_eelistus: null,
  lougad: null,
  lougaliiges: null,
  // Not 'jah'. A new patient has not been asked, and a default that says
  // otherwise is consent nobody gave.
  turundusnousolek: 'kysimata',
  nousoleku_aeg: null,
  markmed: null,
  markused: []
}

export const CONSENT_LABEL: Record<Patient['turundusnousolek'], string> = {
  jah:      'Tohib saata',
  ei:       'Ei soovi',
  kysimata: 'Küsimata',
}

export const CONSENT_HEX: Record<Patient['turundusnousolek'], string> = {
  jah:      '#22C55E',
  ei:       '#EF4444',
  kysimata: '#94A3B8',
}

/** May this person be sent marketing? The one place that question is answered. */
export const mayMarket = (p: Pick<Patient, 'turundusnousolek' | 'email'>): boolean =>
  p.turundusnousolek === 'jah' && !!p.email?.trim()

// Fields that hold health data — used to badge the ravikaart section in the UI
export const HEALTH_FIELDS = ['ravikaart', 'allergiad', 'eelistused', 'varvi_eelistus', 'lougad', 'lougaliiges'] as const
