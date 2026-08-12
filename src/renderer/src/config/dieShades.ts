// VITA Natural Die Material (ND) — the STUMP shade, not the tooth shade.
//
// Why this is a separate scale from VITA Classical: a translucent ceramic lets
// the prepared stump underneath show through, so the same A2 ingot comes out
// looking different over a vital tooth than over a dead one, a metal post or a
// titanium abutment. The technician needs the stump's colour to choose the
// ingot's opacity — an A2 crown on an ND8 stump has to be built differently to
// land on A2.
//
// ND1 is the lightest and the scale runs to grey/dark at ND9. Display colours
// are approximate, exactly as in config/vita.ts.
export interface DieShade {
  code: string
  hex: string
  /** What kind of stump this usually is — shown as the swatch tooltip. */
  note: string
}

export const DIE_SHADES: DieShade[] = [
  { code: 'ND1', hex: '#F7EFDF', note: 'Väga hele' },
  { code: 'ND2', hex: '#F2E5CB', note: 'Hele' },
  { code: 'ND3', hex: '#EBD9B4', note: 'Hele kollakas' },
  { code: 'ND4', hex: '#E2CB9C', note: 'Kollakas' },
  { code: 'ND5', hex: '#D5B884', note: 'Kollakaspruun' },
  { code: 'ND6', hex: '#C0A170', note: 'Pruun' },
  { code: 'ND7', hex: '#A78D66', note: 'Pruunikashall' },
  { code: 'ND8', hex: '#8A7A66', note: 'Hall — nt surnud hammas' },
  { code: 'ND9', hex: '#6E6459', note: 'Tume hall — nt metallitihvt' },
]

/** Look up a stump shade by code. Free text returns undefined. */
export const dieShadeOf = (code: string | null | undefined): DieShade | undefined =>
  code ? DIE_SHADES.find(s => s.code === code.trim().toUpperCase()) : undefined
