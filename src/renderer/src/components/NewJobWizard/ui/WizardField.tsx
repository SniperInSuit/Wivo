/**
 * One labelled control: label ABOVE, helper text always visible, error below.
 *
 * The label never floats and the help is never a tooltip. Both decisions are
 * for the same reason: a placeholder that vanishes on focus and a hint that
 * only exists on hover are invisible to anyone filling the form slowly, and
 * slowly is how this form is filled.
 */
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { WIZARD_ERROR, WIZARD_HELP, WIZARD_LABEL } from '../wizardTheme'

export interface WizardFieldProps {
  /** Rendered as a real <label htmlFor={htmlFor}> ABOVE the control. */
  label: string
  htmlFor?: string
  /** Adds ' *' and aria-required guidance text. */
  required?: boolean
  /** Plain-language helper under the label — always visible, never a tooltip. */
  help?: string
  /** Estonian error text; renders red and wires aria-describedby/aria-invalid. */
  error?: string | null
  children: ReactNode
  className?: string
}

type Describable = {
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

export function WizardField({
  label, htmlFor, required, help, error, children, className = '',
}: WizardFieldProps): JSX.Element {
  const auto = useId()
  const base = htmlFor ?? auto
  const labelId = `${base}-label`
  const helpId = `${base}-help`
  const errorId = `${base}-error`

  const describedBy = [help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  // Only a real form control can be pointed at by htmlFor. When the "control"
  // is a group of cards there is nothing to label, so the group is labelled by
  // its heading instead — a <label> wrapping six buttons is a lie to the AT.
  const control =
    htmlFor && isValidElement(children)
      ? cloneElement(children as ReactElement<Describable>, {
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy || undefined,
          'aria-required': required || undefined,
        })
      : children

  return (
    <div className={className}>
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className={WIZARD_LABEL}>
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="text-rose-500"> *</span>
              <span className="sr-only"> (kohustuslik)</span>
            </>
          )}
        </label>
      ) : (
        <div id={labelId} className={WIZARD_LABEL}>
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="text-rose-500"> *</span>
              <span className="sr-only"> (kohustuslik)</span>
            </>
          )}
        </div>
      )}

      {help && <p id={helpId} className={`${WIZARD_HELP} !mt-0 mb-2`}>{help}</p>}

      {htmlFor ? (
        control
      ) : (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy || undefined}>
          {control}
        </div>
      )}

      {/* role="alert" as well as the describedby wiring. showErrors flips on a
          blocked Continue press, and focus is on the Continue button at that
          moment — without a live region the errors that just appeared are
          announced to nobody. */}
      {error && (
        <p id={errorId} role="alert" className={WIZARD_ERROR}>
          <AlertCircle size={16} aria-hidden="true" className="flex-shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
