import { useCustomers } from '@/hooks/useCustomers'
import { WizardSelect } from '../ui/WizardSelect'

export interface WizardCustomerSelectProps {
  id?: string
  value: string | null
  onChange: (value: string | null) => void
  invalid?: boolean
}

/**
 * Which practice ordered the case.
 *
 * Archived customers are filtered out but the CURRENTLY SELECTED one is kept in
 * the list even if archived — the same rule JobDetailPanel's CustomerSelect
 * follows. Dropping it would silently blank a choice the user already made
 * (a draft resumed after the customer was archived), and a picker that erases
 * its own value is worse than one that shows a retired name.
 *
 * Deliberately a plain select rather than a typeahead: the lab's customer list
 * is short, and a native listbox is the one control every keyboard and screen
 * reader already knows. That matters more here than search.
 */
export function WizardCustomerSelect({ id, value, onChange, invalid }: WizardCustomerSelectProps) {
  const { data: customers = [], isLoading } = useCustomers()

  const options = customers
    .filter(c => !c.archived_at || c.id === value)
    .map(c => ({
      value: c.id,
      label: c.archived_at ? `${c.name} (arhiveeritud)` : c.name,
    }))

  return (
    <WizardSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={isLoading ? 'Laen tellijaid…' : 'Tellija määramata'}
      disabled={isLoading}
      invalid={invalid}
    />
  )
}
