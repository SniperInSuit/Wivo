import { AlertTriangle, Cpu, Timer, Zap } from 'lucide-react'
import type { WizardPriority } from '@shared/wizard'
import { useSettings } from '@/stores/useSettings'
import { SelectableCard } from '../ui/SelectableCard'

export interface PriorityPickerProps {
  value: WizardPriority
  onChange: (value: WizardPriority) => void
}

/**
 * Standard / Kiirtöö / Mudel — exclusive, because the three are three different
 * jobs to the price book, not three flags. toJobInput() resolves the choice
 * into the `kiirtoo` and `mudel` booleans the table actually has.
 *
 * The multiplier is read from settings and never written as "2×": a lab that
 * charges 1.5× for rush work would otherwise be quoted a number the form
 * promised and the invoice did not.
 */
export function PriorityPicker({ value, onChange }: PriorityPickerProps) {
  const { settings } = useSettings()
  const kordaja = settings.kiirtooKordaja

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Töö prioriteet" className="flex flex-wrap gap-3">
        <SelectableCard
          selected={value === 'standard'}
          onToggle={() => onChange('standard')}
          multi={false}
          label="Standard"
          sublabel="Tavaline järjekord ja hind"
          icon={<Timer className="w-5 h-5 text-ink-muted" aria-hidden="true" />}
        />
        <SelectableCard
          selected={value === 'kiirtoo'}
          onToggle={() => onChange('kiirtoo')}
          multi={false}
          label="Kiirtöö"
          sublabel={`Hind × ${kordaja}`}
          badge={`× ${kordaja}`}
          icon={<Zap className="w-5 h-5 text-orange-500" aria-hidden="true" />}
        />
        <SelectableCard
          selected={value === 'mudel'}
          onToggle={() => onChange('mudel')}
          multi={false}
          label="Mudel"
          // Safe to print now: quoteJob adds `book.mudeliHind` on the mudel
          // flag, so the number on this card is the number the created job
          // carries. It was deliberately hidden while nothing read that setting.
          sublabel={settings.mudeliHind > 0 ? `Ainult mudel · ${settings.mudeliHind} €` : 'Ainult mudel'}
          icon={<Cpu className="w-5 h-5 text-amber-500" aria-hidden="true" />}
        />
      </div>

      {/* Shown before Continue, not after: the price doubling is the whole
          consequence of this choice and it must not be a surprise on step 6. */}
      {value === 'kiirtoo' && (
        // An alpha tint over whatever the card surface is, never a fixed
        // amber-50: this app themes through CSS variables, and in 'cloudy-navy'
        // a cream panel inside a navy card is a hole punched in the page.
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" aria-hidden="true" />
          <div>
            <p className="text-base font-semibold text-amber-500">
              Kiirtöö korrutab tootmishinna {kordaja}×
            </p>
            <p className="text-base text-ink-soft mt-0.5">
              Lõpliku hinna näed enne töö loomist sammus „Kontroll“.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
