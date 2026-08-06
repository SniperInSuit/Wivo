import { useMemo, useState } from 'react'
import { Eraser } from 'lucide-react'
import { VITA_GROUPS, VITA_SHADES } from '@/config/vita'
import { SelectableCard } from '../ui/SelectableCard'
import { WizardField } from '../ui/WizardField'
import { ToothSwatch } from '../jobtype/ToothGlyph'
import { FOCUS_RING, WIZARD_HELP, WIZARD_INPUT, WIZARD_BTN } from '../wizardTheme'

export interface WizardShadePickerProps {
  /** state.defaultShade — a VITA code or free text. */
  value: string | null
  onChange: (value: string | null) => void
}

const GROUP_HELP: Record<(typeof VITA_GROUPS)[number], string> = {
  A: 'Punakaspruunid toonid',
  B: 'Kollakad toonid',
  C: 'Hallikad toonid',
  D: 'Punakashallid toonid',
}

/**
 * Wizard-sized VITA Classical picker.
 *
 * A rebuild rather than a reuse of JobDetail/ShadePicker: that one draws all
 * four groups at once with 24px swatches and text-xs labels, which is exactly
 * what this product's older users cannot hit or read. Here one group shows at a
 * time behind real tabs, and every swatch is a full SelectableCard, so the
 * selected state carries a border, a check and a bolder label — not colour
 * alone, which would be self-defeating on a colour picker.
 */
export function WizardShadePicker({ value, onChange }: WizardShadePickerProps) {
  const isVita = value != null && VITA_SHADES.some(s => s.code === value)
  const selected = useMemo(() => VITA_SHADES.find(s => s.code === value) ?? null, [value])

  // Open on the selected shade's group so returning to the step shows the
  // choice instead of hiding it behind a tab.
  const [group, setGroup] = useState<(typeof VITA_GROUPS)[number]>(selected?.group ?? 'A')
  const [freeText, setFreeText] = useState(isVita || value == null ? '' : value)

  const shades = VITA_SHADES.filter(s => s.group === group)

  return (
    <div className="space-y-4">
      {/* Group tabs */}
      <div role="tablist" aria-label="VITA värvigrupid" className="flex flex-wrap gap-2">
        {VITA_GROUPS.map(g => {
          const active = group === g
          return (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGroup(g)}
              // The active tab is FILLED, not outlined: four outlined tabs in a
              // row read as four equal options, and the whole point of the tab
              // strip is that one of them is currently open.
              className={`min-h-[44px] px-5 rounded-xl text-base border-2 transition-colors duration-150 ${FOCUS_RING} ${
                active
                  ? 'border-accent bg-accent text-white font-semibold'
                  : 'border-ink-faint/40 bg-bg-card text-ink-muted font-medium hover:border-ink-faint'
              }`}
            >
              Grupp {g}
              {selected?.group === g && <span className="sr-only"> — sisaldab valitud tooni</span>}
            </button>
          )
        })}
      </div>
      <p className={WIZARD_HELP}>{GROUP_HELP[group]}</p>

      {/* radiogroup and not group: the cards inside announce themselves as
          radios, and a radio outside a radiogroup is invalid ARIA — the reader
          cannot say "1 of 6". */}
      <div role="radiogroup" aria-label={`Grupi ${group} toonid`} className="flex flex-wrap gap-3">
        {shades.map(s => (
          <SelectableCard
            key={s.code}
            selected={value === s.code}
            onToggle={() => {
              // A swatch overrides whatever was typed — otherwise the free-text
              // field would keep showing a shade the job no longer has.
              setFreeText('')
              onChange(value === s.code ? null : s.code)
            }}
            multi={false}
            size="tile"
            label={s.code}
            // No sublabel: "VITA grupp A" repeated six times is noise the tab
            // strip above already states, and it stole room from the swatch,
            // which is the only thing on this card the user is actually
            // comparing.
            icon={<ToothSwatch hex={s.hex} width={44} height={56} />}
            className="text-ink-faint"
          />
        ))}
      </div>

      {/* Selected preview — the code in words, so the choice survives a printed
          form and a colour-blind reader. */}
      <div className="flex items-center gap-3 rounded-xl border border-ink-faint/30 bg-bg-card p-4">
        {/* A theme-following hairline, not a black alpha: on the navy card of
            'cloudy-navy' a black edge vanishes and a pale shade like B1 floats
            with no outline at all. */}
        <span
          aria-hidden="true"
          className="block w-12 h-12 rounded-lg shrink-0 border border-ink-faint/40"
          style={{ backgroundColor: selected?.hex ?? 'transparent' }}
        />
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink-soft">Valitud toon</p>
          <p className="text-base text-ink font-medium truncate" aria-live="polite">
            {value ?? 'Toon on valimata'}
          </p>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => { onChange(null); setFreeText('') }}
            className={`${WIZARD_BTN} ml-auto shrink-0 inline-flex items-center gap-2 border border-ink-faint/40 bg-bg-card text-ink-soft`}
          >
            <Eraser className="w-4 h-4" aria-hidden="true" />
            Tühjenda
          </button>
        )}
      </div>

      <WizardField
        label="Muu toon"
        htmlFor="wizard-shade-free"
        help="Kui toon pole VITA skaalal — näiteks Bleach 1 — kirjuta see siia."
      >
        <input
          id="wizard-shade-free"
          type="text"
          value={freeText}
          onChange={e => {
            setFreeText(e.target.value)
            // Typing wins over the swatch grid; an empty field clears back to
            // "no shade" rather than leaving a stale VITA code behind.
            onChange(e.target.value.trim() === '' ? null : e.target.value)
          }}
          placeholder="Nt Bleach 1"
          className={WIZARD_INPUT}
        />
      </WizardField>
    </div>
  )
}
