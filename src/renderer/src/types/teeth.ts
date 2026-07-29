// Manual per-patient tooth status. 'toodeldud' is NEVER stored — it is derived
// from job history (see components/Patients/derive.ts). A row in patient_teeth
// is an explicit override and always wins over the derived value.
export type ToothStatus = 'toodeldud' | 'ravi' | 'puudub' | 'terve'
export type ManualToothStatus = Exclude<ToothStatus, 'toodeldud'>

// One row of the `patient_teeth` table (migration 003)
export interface PatientTooth {
  patient_id: string
  fdi: number                    // 11-18, 21-28, 31-38, 41-48
  staatus: ManualToothStatus
  markus: string | null          // Märkus — optional per-tooth note
  updated_at: string
}
