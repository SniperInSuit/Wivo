import { useState } from 'react'
import { Eraser } from 'lucide-react'
import { DIE_SHADES, dieShadeOf } from '@/config/dieShades'
import { SelectableCard } from '../ui/SelectableCard'
import { ToothSwatch } from '../jobtype/ToothGlyph'
import { WIZARD_HELP, WIZARD_INPUT, WIZARD_BTN } from '../wizardTheme'

export interface WizardDieShadePickerProps {
  /** state.dieShade — an ND code or free text. */
  value: string | null
  onChange: (value: string | null) => void
}

/**
 * Wizard-sized stump shade picker.
 *
 * No tabs, unlike WizardShadePicker: ND1–ND9 is one ordered scale, and nine
 * cards fit on a row without hiding any behind a group. The order is the
 * information — light to dark, left to right — so it is never re-sorted.
 *
 * Unanswered is a real answer here and the copy says so. A dentist who did not
 * record the stump shade must not be nudged into inventing one: a wrong ND is
 * worse than a missing one, because the technician would act on it.
 */
export function WizardDieShadePicker({ value, onChange }: WizardDieShadePickerProps) {
  const known = dieShadeOf(value)
  const [freeText, setFreeText] = useState(known || value == null ? '' : value)

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Köndivärvi toonid" className="flex flex-wrap gap-3">
        {DIE_SHADES.map(s => (
          <SelectableCard
            key={s.code}
            selected={value === s.code}
            onToggle={() => {
              // A swatch overrides whatever was typed, or the free-text box
              // would keep showing a shade the job no longer has.
              setFreeText('')
              onChange(value === s.code ? null : s.code)
            }}
            multi={false}
            size="tile"
            label={s.code}
            sublabel={s.note}
            icon={<ToothSwatch hex={s.hex} width={44} height={56} />}
            className="text-ink-faint"
          />
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-ink-faint/30 bg-bg-card p-4">
        <span
          aria-hidden="true"
          className="block w-12 h-12 rounded-lg shrink-0 border border-ink-faint/40"
          style={{ backgroundColor: known?.hex ?? 'transparent' }}
        />
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink-soft">Valitud köndivärv</p>
          <p className="text-base text-ink font-medium truncate" aria-live="polite">
            {value ?? 'Ei ole teada'}
          </p>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => { onChange(null); setFreeText('') }}
            className={`${WIZARD_BTN} ml-auto`}
          >
            <Eraser className="w-5 h-5" aria-hidden="true" />
            Tühjenda
          </button>
        )}
      </div>

      <div>
        <label htmlFor="wizard-kondivarv-vaba" className={WIZARD_HELP}>
          Või kirjelda sõnadega, kui skaalal vastet ei ole
        </label>
        <input
          id="wizard-kondivarv-vaba"
          type="text"
          value={known ? '' : freeText}
          onChange={e => {
            setFreeText(e.target.value)
            onChange(e.target.value.trim() ? e.target.value : null)
          }}
          placeholder="Nt titaanabutment, metallitihvt"
          className={`${WIZARD_INPUT} mt-1`}
        />
      </div>
    </div>
  )
}
