import { useState } from 'react'
import { DIE_SHADES, dieShadeOf } from '../../config/dieShades'

interface DieShadePickerProps {
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Stump shade picker — one row, because ND1–ND9 is a single ordered scale with
 * no groups, unlike VITA Classical's A/B/C/D. Deliberately smaller than
 * ShadePicker: this is a secondary field that only some jobs answer, and it
 * should not out-shout the tooth shade sitting above it.
 */
export function DieShadePicker({ value, onChange, disabled }: DieShadePickerProps) {
  const [freeText, setFreeText] = useState('')
  const isCustom = !!value && !dieShadeOf(value)

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {DIE_SHADES.map(shade => {
          const active = value === shade.code
          return (
            <button
              key={shade.code}
              type="button"
              disabled={disabled}
              onClick={() => onChange(active ? '' : shade.code)}
              title={`${shade.code} — ${shade.note}`}
              className={`flex flex-col items-center gap-0.5 rounded-lg p-1.5 border-2 transition-all duration-100 ${
                active
                  ? 'border-accent shadow-sm scale-110'
                  : 'border-transparent hover:border-ink-faint/40'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className="w-6 h-6 rounded-md block"
                style={{ backgroundColor: shade.hex, border: '1px solid rgba(0,0,0,0.12)' }}
              />
              <span className="text-[10px] text-ink-muted font-medium leading-none">
                {shade.code}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Vaba tekst (nt titaan)"
          disabled={disabled}
          value={isCustom ? value : freeText}
          onChange={e => {
            setFreeText(e.target.value)
            if (e.target.value) onChange(e.target.value)
          }}
          className="input flex-1 text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setFreeText('') }}
            disabled={disabled}
            className="text-xs text-ink-muted hover:text-red-500 transition-colors"
          >
            Tühjenda
          </button>
        )}
      </div>
    </div>
  )
}
