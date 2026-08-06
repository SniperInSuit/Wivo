/**
 * A native <select>, sized for the wizard.
 *
 * Native rather than a custom listbox on purpose: the OS dropdown is already
 * keyboard-operable, already scales with the user's system font, and already
 * works with a screen reader — three things a hand-rolled popup gets wrong far
 * more often than it gets right.
 */
import { ChevronDown } from 'lucide-react'
import { FOCUS_RING, WIZARD_INPUT } from '../wizardTheme'

export interface WizardSelectOption {
  value: string
  label: string
  hex?: string
}

export interface WizardSelectProps {
  id?: string
  value: string | null
  onChange: (value: string | null) => void
  options: WizardSelectOption[]
  /** Shown as the empty option; '' maps back to null. */
  placeholder: string
  disabled?: boolean
  invalid?: boolean
  /* WizardField clones its child to attach these. Declared and forwarded
   * explicitly rather than swallowed: without them the helper text and the
   * error under a select are drawn but never announced, which is exactly the
   * failure the field component exists to prevent. */
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
  'aria-label'?: string
}

export function WizardSelect({
  id, value, onChange, options, placeholder, disabled, invalid, ...aria
}: WizardSelectProps): JSX.Element {
  const current = options.find(o => o.value === value)

  return (
    <div className="relative">
      {/* A native <option> cannot hold a swatch on any platform we ship to, so
          the colour of the CURRENT choice is drawn beside the closed control
          instead. Better one honest dot than a list that is colourless anyway. */}
      {current?.hex && (
        <span
          aria-hidden="true"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
          style={{ backgroundColor: current.hex }}
        />
      )}
      <select
        {...aria}
        id={id}
        value={value ?? ''}
        disabled={disabled}
        // `invalid` is the caller's own signal; aria-invalid may also arrive
        // from WizardField. Either one means the same thing to a reader.
        aria-invalid={aria['aria-invalid'] ?? (invalid || undefined)}
        onChange={e => onChange(e.target.value || null)}
        className={[
          WIZARD_INPUT,
          'appearance-none pr-10',
          current?.hex ? 'pl-9' : '',
          invalid ? 'border-rose-500' : '',
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
          FOCUS_RING,
        ].join(' ')}
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown
        size={18}
        aria-hidden="true"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"
      />
    </div>
  )
}
