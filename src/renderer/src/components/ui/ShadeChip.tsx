import { VITA_SHADES } from '../../config/vita'
import { dieShadeOf } from '../../config/dieShades'

interface ShadeChipProps {
  shade: string | null
  size?: 'sm' | 'md'
}

export function ShadeChip({ shade, size = 'sm' }: ShadeChipProps) {
  if (!shade) return null

  // Stump shades reuse this chip, so ND codes have to resolve too — otherwise
  // an ND8 stump renders with the default light-tooth swatch, which is the one
  // thing that shade is telling you it is not.
  const hex = VITA_SHADES.find(s => s.code === shade)?.hex
    ?? dieShadeOf(shade)?.hex
    ?? '#F5E6C8'

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border border-black/10 ${
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'
      }`}
      style={{ backgroundColor: `${hex}40` }}
    >
      <span
        className="rounded-full inline-block"
        style={{
          width: size === 'sm' ? 8 : 10,
          height: size === 'sm' ? 8 : 10,
          backgroundColor: hex,
          border: '1px solid rgba(0,0,0,0.15)'
        }}
      />
      <span className="text-ink-soft">{shade}</span>
    </span>
  )
}
