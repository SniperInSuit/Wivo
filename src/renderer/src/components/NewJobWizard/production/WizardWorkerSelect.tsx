import { useClinicProfiles } from '@/hooks/useClinicProfiles'
import { WizardField } from '../ui/WizardField'
import { WizardSelect } from '../ui/WizardSelect'

export interface WizardWorkerSelectProps {
  /** Used for the <label for> / <select id> pair. */
  id: string
  label: string
  help?: string
  /** profiles.id, or null when nobody is assigned. */
  value: string | null
  onChange: (value: string | null) => void
}

/**
 * Designer / technician picker.
 *
 * The 22-line pattern is copied from JobDetailPanel's private WorkerSelect
 * rather than exported from it: that component is bound to the Edit page's
 * .label/.input classes, which are too small for this wizard, and exporting it
 * would mean editing a file four live screens depend on.
 *
 * Empty stays a real answer — plenty of work is outsourced or done by someone
 * who is not in the system, and forcing a name puts fictional people on the
 * payroll report.
 */
export function WizardWorkerSelect({ id, label, help, value, onChange }: WizardWorkerSelectProps) {
  const { data: workers = [] } = useClinicProfiles()

  return (
    <WizardField label={label} htmlFor={id} help={help}>
      <WizardSelect
        id={id}
        value={value}
        onChange={onChange}
        placeholder="Määramata"
        options={workers.map(w => ({ value: w.id, label: w.full_name || 'Nimeta' }))}
      />
    </WizardField>
  )
}
