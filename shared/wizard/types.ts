/**
 * The state of the "Lisa uus töö" wizard, as one plain object.
 *
 * It lives in `shared/` for the same reason the quote rules do: it is the thing
 * every step, the draft persistence and the JobInput adapter must agree about,
 * and a second declaration of "what the wizard knows so far" is how two halves
 * of a form start disagreeing. Nothing here imports React or npm — see
 * `shared/README.md`.
 *
 * This is deliberately NOT `JobInput`. The wizard asks questions in the order a
 * technician thinks about them; the database stores columns. Every divergence
 * is resolved in exactly one place, `state/toJobInput.ts`.
 */

/** Step numbers are stable and never renumber, even when a step is skipped. */
export type StepId = 1 | 2 | 3 | 4 | 5 | 6

/** Priority is exclusive — a job is standard, OR rush, OR a model. */
export type WizardPriority = 'standard' | 'kiirtoo' | 'mudel'

/** Mirrors the renderer's DeliveryStatus exactly. Redeclared because shared/
 *  may not import from src/. toJobInput() assigns it into a DeliveryStatus
 *  slot, so TS structurally proves the two stay identical. */
export type WizardDeliveryStatus = 'labor' | 'teel' | 'yle_antud'

/** Which arch(es) an arch-level or appliance work type covers. */
export type ArchSelection = 'upper' | 'lower' | 'both'

export type WizardStatus = 'draft' | 'creating' | 'created'

export interface WizardPatient {
  /** Free text as typed; becomes job.patsient. Required to create. */
  name: string
  /** patients.id when linked from PatientPicker, else null. */
  patientId: string | null
}

export interface WizardPricing {
  /** Use the work type's soodushind where configured. Session-only — the DB
   *  has nowhere to store the flag, so it must be resolved into `hind`. */
  useDiscount: boolean
  /** Manual override of the auto price. null = follow the quote. */
  hind: number | null
  /** Design fee → job.disain_hind. */
  disainHind: number | null
  /** true once the user has typed a price by hand; stops auto-repricing. */
  overridden: boolean
}

/**
 * THE wizard state. Persisted verbatim as the draft payload.
 *
 * Deliberate divergences from JobInput, all resolved in toJobInput():
 *  - jobTypes/selectedTeeth replace work_items (one item per selected type)
 *  - materials is a list; only materials[0] reaches job.materjal, because
 *    quoteJob looks materialPrices up by EXACT string
 *  - date/deadline/time are three plain fields; deadline+time compose into
 *    the single ISO timestamptz valmis_aeg
 *  - glaze/texture/notes/materials[1..] have no column and compose into
 *    kirjeldus via composeKirjeldus()
 */
export interface NewJobState {
  /** WorkType.nimi VERBATIM from useWorkTypes().types. Selection order is
   *  render order. Never free text — colorMap is exact-name keyed. */
  jobTypes: string[]
  /** key = a WorkType.nimi present in jobTypes.
   *  value = FDI numbers as NUMBERS, unsorted (sort at read time).
   *  A key with an empty array is legal; a key not in jobTypes is ignored. */
  selectedTeeth: Record<string, number[]>
  /** One arch answer shared by every arch-level / appliance type on the job. */
  selectedArch: ArchSelection | null
  /** materials[0] is the priced material. Extra entries are informational. */
  materials: string[]
  /** VITA code ('A2') or free text. One default for every selected tooth. */
  defaultShade: string | null
  glaze: string | null
  texture: string | null
  /** settings.masinad entry → job.masina. */
  machine: string | null
  /** profiles.id → job.designed_by. */
  designer: string | null
  /** profiles.id → job.assigned_to. */
  technician: string | null
  /** 'YYYY-MM-DD' — date received → job.kuupaev. Never null after init. */
  date: string | null
  /** 'YYYY-MM-DD' — deadline date. */
  deadline: string | null
  /** 'HH:mm' — deadline time of day. Ignored when deadline is null. */
  time: string | null
  printId: string
  designId: string
  priority: WizardPriority
  patient: WizardPatient | null
  /** customers.id → job.customer_id. */
  customer: string | null
  customerReference: string
  description: string
  notes: string
  pricing: WizardPricing
  currentStep: StepId
  status: WizardStatus
}

export interface NewJobStateInit {
  /** 'YYYY-MM-DD'. Defaults to todayISO(). */
  date?: string
  /** 'YYYY-MM-DD'. From the calendar's clicked datetime. */
  deadline?: string
  /** 'HH:mm'. From the calendar's clicked datetime. */
  time?: string
  /** settings.defaultMachine. */
  machine?: string | null
}

/**
 * Local calendar date, not UTC. `toISOString()` would roll the date back an
 * hour before midnight in Estonia (UTC+2/+3) and stamp yesterday onto a job
 * created just after 00:00.
 */
export const todayISO = (): string => {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function createEmptyNewJobState(init: NewJobStateInit = {}): NewJobState {
  return {
    jobTypes: [],
    selectedTeeth: {},
    selectedArch: null,
    materials: [],
    defaultShade: null,
    glaze: null,
    texture: null,
    machine: init.machine ?? null,
    designer: null,
    technician: null,
    date: init.date ?? todayISO(),
    deadline: init.deadline ?? null,
    time: init.time ?? null,
    printId: '',
    designId: '',
    priority: 'standard',
    patient: null,
    customer: null,
    customerReference: '',
    description: '',
    notes: '',
    pricing: { useDiscount: false, hind: null, disainHind: null, overridden: false },
    currentStep: 1,
    status: 'draft',
  }
}
