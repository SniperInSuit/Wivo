// A patient visit — someone arriving at a time, for a duration, referred by a
// dentist. Introduced in 1.3.0 (migration 007); before that the calendar could
// only show job deadlines.
export type VisitStatus =
  | 'planeeritud'   // booked, nothing has happened yet
  | 'saabunud'      // the patient is here now
  | 'toimunud'      // handed over / done
  | 'ei_tulnud'     // no-show — work is still sitting on the bench
  | 'tuhistatud'    // cancelled in advance — bench is clear

export interface Visit {
  id: string
  // The FK is the truth; `patsient` keeps the row readable when the patient
  // record has not been created or linked yet — same idiom as jobs.
  patient_id: string | null
  patsient: string
  arst: string | null          // Suunav arst
  algus: string                // ISO datetime — start
  kestus_min: number           // Kestus minutites
  markus: string | null
  staatus: VisitStatus
  created_at: string
  updated_at: string
}

export type VisitInput = Omit<Visit, 'id' | 'created_at' | 'updated_at'>

export const EMPTY_VISIT: VisitInput = {
  patient_id: null,
  patsient: '',
  arst: null,
  algus: '',
  kestus_min: 30,
  markus: null,
  staatus: 'planeeritud'
}

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  planeeritud: 'Planeeritud',
  saabunud: 'Saabunud',
  toimunud: 'Toimunud',
  ei_tulnud: 'Ei tulnud',
  tuhistatud: 'Tühistatud'
}

// Colour per state. `ei_tulnud` is amber rather than red on purpose: it is not a
// cancellation, it is an unresolved thing needing attention.
export const VISIT_STATUS_HEX: Record<VisitStatus, string> = {
  planeeritud: '#94A3B8',
  saabunud: '#0AB6C4',
  toimunud: '#10B981',
  ei_tulnud: '#F59E0B',
  tuhistatud: '#EF4444'
}

// The state is settled — nothing further is expected to happen
export const VISIT_STATUS_CLOSED: VisitStatus[] = ['toimunud', 'ei_tulnud', 'tuhistatud']

// Which one-click actions to offer, per current state. Contextual rather than
// five buttons always on screen — a visit that already happened does not need a
// "did not come" button.
export const VISIT_ACTIONS: Record<VisitStatus, VisitStatus[]> = {
  planeeritud: ['saabunud', 'ei_tulnud', 'tuhistatud'],
  saabunud:    ['toimunud', 'tuhistatud'],
  toimunud:    ['planeeritud'],
  ei_tulnud:   ['planeeritud'],
  tuhistatud:  ['planeeritud']
}

// Verb form for the action button, which reads better than the state name
export const VISIT_ACTION_LABEL: Record<VisitStatus, string> = {
  planeeritud: 'Taasta',
  saabunud: 'Saabus',
  toimunud: 'Üle antud',
  ei_tulnud: 'Ei tulnud',
  tuhistatud: 'Tühista'
}
