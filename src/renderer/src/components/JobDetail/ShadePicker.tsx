import { useState } from 'react'
import { VITA_SHADES, VITA_GROUPS } from '../../config/vita'

interface ShadePickerProps {
  value: string | null
  onChange: (value: string) => void
  disabled?: boolean
}

export function ShadePicker({ value, onChange, disabled }: ShadePickerProps) {
  const [freeText, setFreeText] = useState('')
  const isCustom = value != null && !VITA_SHADES.find((s) => s.code === value)

  return (
    <div className="space-y-2">
      {/* VITA swatch grid grouped by A/B/C/D */}
      <div className="space-y-1.5">
        {VITA_GROUPS.map((group) => {
          const shades = VITA_SHADES.filter((s) => s.group === group)
          return (
            <div key={group} className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-ink-muted w-4">{group}</span>
              <div className="flex gap-1 flex-wrap">
                {shades.map((shade) => {
                  const active = value === shade.code
                  return (
                    <button
                      key={shade.code}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(shade.code)}
                      title={shade.code}
                      className={`relative flex flex-col items-center gap-0.5 rounded-lg p-1.5 border-2 transition-all duration-100 ${
                        active
                          ? 'border-accent shadow-sm scale-110'
                          : 'border-transparent hover:border-ink-faint/40'
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span
                        className="w-6 h-6 rounded-md block"
                        style={{
                          backgroundColor: shade.hex,
                          border: '1px solid rgba(0,0,0,0.12)'
                        }}
                      />
                      <span className="text-xs text-ink-muted font-medium leading-none">
                        {shade.code}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Free-text fallback */}
      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          placeholder="Vaba tekst (nt Bleach 1)"
          disabled={disabled}
          value={isCustom ? value : freeText}
          onChange={(e) => {
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
