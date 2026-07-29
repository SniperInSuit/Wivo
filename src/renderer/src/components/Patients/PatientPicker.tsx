import { useState, useRef, useEffect, useMemo } from 'react'
import { User, UserPlus, Check, Loader2, Link2Off } from 'lucide-react'
import { usePatients, useCreatePatient } from '../../hooks/usePatients'
import { EMPTY_PATIENT } from '../../types/patient'
import { describeError } from './errors'

interface PatientPickerProps {
  name: string                                   // current form.patsient
  patientId: string | null                       // current form.patient_id
  onChange: (name: string, patientId: string | null) => void
  required?: boolean
}

/**
 * Combobox for the Patsient field.
 * Typing filters existing patient records; picking one links the job via
 * patient_id and copies the name into `patsient`. A free-typed name still saves
 * fine (patient_id stays null) so nothing breaks if the record does not exist —
 * "Loo patsient" creates it on the spot.
 */
export function PatientPicker({ name, patientId, onChange, required }: PatientPickerProps) {
  const { data: patients = [], isError } = usePatients()
  const createPatient = useCreatePatient()
  const [open, setOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const query = name.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!query) return patients.slice(0, 8)
    return patients.filter(p => p.nimi.toLowerCase().includes(query)).slice(0, 8)
  }, [patients, query])

  const exact = patients.find(p => p.nimi.trim().toLowerCase() === query)
  const linked = patientId ? patients.find(p => p.id === patientId) : undefined

  function handleType(value: string) {
    // Typing a different name breaks the link unless it matches a record exactly
    const hit = patients.find(p => p.nimi.trim().toLowerCase() === value.trim().toLowerCase())
    onChange(value, hit?.id ?? null)
    setOpen(true)
  }

  async function handleCreate() {
    const nimi = name.trim()
    if (!nimi) return
    setCreateError(null)
    try {
      const created = await createPatient.mutateAsync({ ...EMPTY_PATIENT, nimi })
      onChange(created.nimi, created.id)
      setOpen(false)
    } catch (err) {
      // Surface it — a rejected insert must not look like a dead button
      setCreateError(describeError(err))
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <label className="label flex items-center justify-between">
        <span>Patsient {required && '*'}</span>
        {linked ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-accent">
            <Check size={10} /> seotud
          </span>
        ) : name.trim() && !isError ? (
          <span className="flex items-center gap-1 text-[10px] font-medium text-ink-faint">
            <Link2Off size={10} /> sidumata
          </span>
        ) : null}
      </label>

      <input
        type="text"
        value={name}
        onChange={e => handleType(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Nimi või ID"
        required={required}
        autoComplete="off"
        className="input"
      />

      {open && !isError && (matches.length > 0 || (query && !exact)) && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-bg-card border border-ink-faint/25 rounded-xl shadow-panel overflow-hidden max-h-64 overflow-y-auto">
          {matches.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.nimi, p.id); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-sidebar transition-colors ${
                p.id === patientId ? 'bg-accent/10' : ''
              }`}
            >
              <User size={13} className="text-ink-faint flex-shrink-0" />
              <span className="text-sm text-ink truncate flex-1">{p.nimi}</span>
              {(p.arst || p.kliinik) && (
                <span className="text-[10px] text-ink-faint truncate max-w-[45%]">
                  {[p.arst, p.kliinik].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          ))}

          {query && !exact && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={createPatient.isPending}
              className="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-ink-faint/15 hover:bg-accent/10 transition-colors disabled:opacity-50"
            >
              {createPatient.isPending
                ? <Loader2 size={13} className="text-accent animate-spin" />
                : <UserPlus size={13} className="text-accent" />}
              <span className="text-sm text-accent font-medium truncate">
                Loo patsient „{name.trim()}"
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
