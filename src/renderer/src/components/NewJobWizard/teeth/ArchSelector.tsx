/**
 * Ülemine / Alumine / Mõlemad — the arch answer for work types that have no
 * individual teeth (All-on-X, proteesid) and for appliances that still need to
 * know which jaw they sit on.
 *
 * ONE answer is shared by every arch-level type on the job. Asking per type
 * would be more expressive and, for the 99 % case of a single All-on-X, pure
 * friction — the Edit page is where a job that really needs two different
 * arches gets split into two work items.
 */
import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import type { ArchSelection } from '@shared/wizard'
import { SelectableCard } from '../ui/SelectableCard'
import { WIZARD_ERROR } from '../wizardTheme'
import upperImg from '@/assets/jobs/Upper.png'
import lowerImg from '@/assets/jobs/Lower.png'

export interface ArchSelectorProps {
  value: ArchSelection | null
  onChange: (value: ArchSelection) => void
  /** Renders as an error when true and value is null. */
  invalid?: boolean
}

const OPTIONS: { value: ArchSelection; label: string; sublabel: string; icon: ReactNode }[] = [
  {
    value: 'upper',
    label: 'Ülemine lõualuu',
    sublabel: 'Hambad 18–28',
    icon: <img src={upperImg} alt="" className="h-10 w-10 object-contain" aria-hidden="true" />,
  },
  {
    value: 'lower',
    label: 'Alumine lõualuu',
    sublabel: 'Hambad 48–38',
    icon: <img src={lowerImg} alt="" className="h-10 w-10 object-contain" aria-hidden="true" />,
  },
  {
    value: 'both',
    label: 'Mõlemad lõualuud',
    sublabel: 'Kõik 32 hammast',
    icon: (
      <div className="flex flex-col items-center gap-0.5" aria-hidden="true">
        <img src={upperImg} alt="" className="h-7 w-7 object-contain" />
        <img src={lowerImg} alt="" className="h-7 w-7 object-contain" />
      </div>
    ),
  },
]

export function ArchSelector({ value, onChange, invalid }: ArchSelectorProps) {
  // Only shout once the shell has asked us to: an untouched step must not open
  // in red. `invalid` already carries that decision from validateStep().
  const showError = Boolean(invalid) && value === null

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Lõualuu"
        aria-required="true"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {OPTIONS.map(o => (
          <SelectableCard
            key={o.value}
            selected={value === o.value}
            onToggle={() => onChange(o.value)}
            label={o.label}
            sublabel={o.sublabel}
            icon={o.icon}
            multi={false}
          />
        ))}
      </div>

      {showError && (
        <p className={WIZARD_ERROR} role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Vali lõualuu: ülemine, alumine või mõlemad.
        </p>
      )}
    </div>
  )
}
