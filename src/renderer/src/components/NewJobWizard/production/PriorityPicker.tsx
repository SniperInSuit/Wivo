import { AlertTriangle, Cpu, Timer, Zap } from 'lucide-react'
import { WIZARD_STEPS } from '@shared/wizard'
import { useSettings } from '@/stores/useSettings'
import { SelectableCard } from '../ui/SelectableCard'
import { t } from '@/lib/i18n'

export interface PriorityPickerProps {
  rush: boolean
  model: boolean
  onChange: (patch: { rush?: boolean; model?: boolean }) => void
}

/**
 * Rush and Model are two independent switches: a job can be both. Neither on
 * is a standard job. toJobInput() writes them to `kiirtoo` and `mudel`
 * (and `printed_model` follows `mudel`).
 *
 * The multiplier is read from settings and never written as "2×": a lab that
 * charges 1.5× for rush work would otherwise be quoted a number the form
 * promised and the invoice did not.
 */
export function PriorityPicker({ rush, model, onChange }: PriorityPickerProps) {
  const { settings } = useSettings()
  const kordaja = settings.kiirtooKordaja

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('wizard.jobPriority')} className="flex flex-wrap gap-3">
        <SelectableCard
          selected={rush}
          onToggle={() => onChange({ rush: !rush })}
          multi
          label={t('wizard.rushJob')}
          sublabel={t('wizard.price', { kordaja })}
          badge={`× ${kordaja}`}
          icon={<Zap className="w-5 h-5 text-orange-500" aria-hidden="true" />}
        />
        <SelectableCard
          selected={model}
          onToggle={() => onChange({ model: !model })}
          multi
          label={t('wizard.model')}
          // Safe to print now: quoteJob adds `book.mudeliHind` on the mudel
          // flag, so the number on this card is the number the created job
          // carries. It was deliberately hidden while nothing read that setting.
          sublabel={settings.mudeliHind > 0 ? t('wizard.modelOnly', { mudeliHind: settings.mudeliHind }) : t('wizard.modelOnly2')}
          icon={<Cpu className="w-5 h-5 text-amber-500" aria-hidden="true" />}
        />
      </div>

      {/* Shown before Continue, not after: the price doubling is the whole
          consequence of this choice and it must not be a surprise on step 6. */}
      {rush && (
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
              {t('wizard.aRushJobMultipliesTheProduction', { kordaja })}
            </p>
            <p className="text-base text-ink-soft mt-0.5">
              {/* The step's own label, so this follows whatever the tracker calls it. */}
              {t('wizard.youLlSeeTheFinalPrice', { short: WIZARD_STEPS[5].short })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
