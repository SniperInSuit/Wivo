/**
 * Line-art tooth glyphs for the wizard.
 *
 * The job-type grid used to draw lucide's `Crown` (a royal crown), `Anchor`,
 * `Link2` and — for anything a lab invented — `Shapes`, a triangle/circle/square
 * cluster with nothing dental about it. Nothing on the busiest screen in the
 * wizard said "teeth". These do.
 *
 * Two rules hold this together:
 *
 *  1. The MATCHER is the same permissive identity-token rule the rest of the
 *     wizard uses — the resolved type's own name plus the `match` synonyms the
 *     lab configured in Seaded. It never compares against a hardcoded work-type
 *     name, because that list is user-editable.
 *  2. The FALLBACK is a plain outline tooth, never a generic shape. A lab that
 *     adds "Zirkoonkroon XL" gets something dental rather than something
 *     abstract, and an icon being approximately right costs nothing.
 *
 * Every path is stroke-only (`currentColor`) so the caller tints it with the
 * work type's own hex, and every one is drawn in the same 24×24 box so a grid
 * of them lines up.
 */
import type { SVGProps } from 'react'

export type ToothGlyphName =
  | 'tooth' | 'crown' | 'implant' | 'bridge' | 'inlay'
  | 'veneer' | 'arch' | 'appliance' | 'model' | 'guide'

/** The molar silhouette every crown-ish glyph is built on. */
const TOOTH_BODY =
  'M8.4 2.9c-2.4 0-3.9 1.8-3.9 4.1 0 1.7.5 2.8.8 4.3.3 1.5.3 3.3.6 5.7.2 1.6.7 4.1 1.8 4.1 1.2 0 1.3-2.6 1.5-4.5.2-1.4.5-2.5 1.2-2.5s1 1.1 1.2 2.5c.2 1.9.3 4.5 1.5 4.5 1.1 0 1.6-2.5 1.8-4.1.3-2.4.3-4.2.6-5.7.3-1.5.8-2.6.8-4.3 0-2.3-1.5-4.1-3.9-4.1-1.3 0-2 .5-2.7.5s-1.4-.5-2.7-.5z'

/** A single upper incisor — the shape a veneer is drawn on. */
const INCISOR_BODY =
  'M12 2.8c-3.2 0-4.9 2.1-4.9 4.9 0 2.5.9 5.3 1.6 8 .7 2.4 1.4 5.5 3.3 5.5s2.6-3.1 3.3-5.5c.7-2.7 1.6-5.5 1.6-8 0-2.8-1.7-4.9-4.9-4.9z'

/** The dental arch, used by everything that covers a whole jaw. */
const ARCH_BODY = 'M3.5 5.5c0 8.4 3.8 13.5 8.5 13.5s8.5-5.1 8.5-13.5'

function Paths({ name }: { name: ToothGlyphName }): JSX.Element {
  switch (name) {
    case 'crown':
      // A tooth wearing a cap: the body, plus the margin line where the crown
      // ends — the one detail that tells a crown from a natural tooth.
      return (
        <>
          <path d={TOOTH_BODY} />
          <path d="M5 10.6c1.6.8 3.4 1.2 7 1.2s5.4-.4 7-1.2" />
        </>
      )

    case 'implant':
      // Crown above, threaded post below. The threads are what read as an
      // implant at 40px — the post alone looks like a root.
      return (
        <>
          <path d="M6.6 3.2c0-.2 1.6-.9 5.4-.9s5.4.7 5.4.9c0 1.9-1.1 4.3-2.4 5.4H9c-1.3-1.1-2.4-3.5-2.4-5.4z" />
          <path d="M10.4 9.2 10 21.2M13.6 9.2 14 21.2" />
          <path d="M9.6 12.4h4.8M9.7 15.4h4.6M9.9 18.4h4.2" />
        </>
      )

    case 'bridge':
      // Three units joined at the shoulder — a pontic between two abutments.
      return (
        <>
          <path d="M4.2 7.6c0-1.9 1-3 2.4-3s2.4 1.1 2.4 3c0 1.3-.2 2.4-.4 3.6-.3 1.7-.4 4.6-1 6.6-.2.8-.5 1.4-1 1.4s-.8-.6-1-1.4c-.6-2-.7-4.9-1-6.6-.2-1.2-.4-2.3-.4-3.6z" />
          <path d="M14.6 7.6c0-1.9 1-3 2.4-3s2.4 1.1 2.4 3c0 1.3-.2 2.4-.4 3.6-.3 1.7-.4 4.6-1 6.6-.2.8-.5 1.4-1 1.4s-.8-.6-1-1.4c-.6-2-.7-4.9-1-6.6-.2-1.2-.4-2.3-.4-3.6z" />
          <path d="M9.6 8.4c0-1.4.9-2.3 2.4-2.3s2.4.9 2.4 2.3c0 1.1-.2 2.1-.4 3.1-.3 1.5-.5 4-1 5.7-.2.7-.5 1.2-1 1.2s-.8-.5-1-1.2c-.5-1.7-.7-4.2-1-5.7-.2-1-.4-2-.4-3.1z" />
          <path d="M8.8 9h1.2M14 9h1.2" />
        </>
      )

    case 'inlay':
      // The tooth with the cavity it fills drawn into the occlusal surface.
      return (
        <>
          <path d={TOOTH_BODY} />
          <path d="M8.6 6.4h6.8v3.2c0 .9-.7 1.6-1.6 1.6h-3.6c-.9 0-1.6-.7-1.6-1.6z" />
        </>
      )

    case 'veneer':
      // An incisor with the facing shell peeled forward off its front surface.
      return (
        <>
          <path d={INCISOR_BODY} />
          <path d="M9.4 4.6c-.9 1-1.3 2.2-1.3 3.6 0 2.4.8 5 1.5 7.5" />
        </>
      )

    case 'arch':
      // The jaw itself, with the tooth positions marked along it.
      return (
        <>
          <path d={ARCH_BODY} />
          <path d="M3.6 8.6h2.2M4.5 12.2h2.2M6.6 15.6h2.2M9.8 17.9h2.2M14 17.9h2.2M17.2 15.6h2.2M19.3 12.2h2.2M20.2 8.6h2.2" />
        </>
      )

    case 'appliance':
      // A splint: one smooth band lying over the arch, no individual teeth.
      return (
        <>
          <path d={ARCH_BODY} />
          <path d="M6.4 6c0 6 2.6 9.6 5.6 9.6S17.6 12 17.6 6" />
        </>
      )

    case 'model':
      // An arch standing on its plaster base.
      return (
        <>
          <path d="M4.4 4.5c0 6.6 3.4 10.6 7.6 10.6s7.6-4 7.6-10.6" />
          <path d="M3.4 17.4h17.2v3.4H3.4z" />
          <path d="M8 15.1v2.3M16 15.1v2.3" />
        </>
      )

    case 'guide':
      // A surgical guide: the arch with a drill sleeve through it.
      return (
        <>
          <path d={ARCH_BODY} />
          <circle cx="12" cy="13.4" r="2.6" />
          <path d="M12 8.2v2.6" />
        </>
      )

    case 'tooth':
    default:
      return <path d={TOOTH_BODY} />
  }
}

export interface ToothGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: ToothGlyphName
  /** Pixel size of the square box. Defaults to 28 (the card grid uses 44). */
  size?: number
}

export function ToothGlyph({ name, size = 28, ...rest }: ToothGlyphProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <Paths name={name} />
    </svg>
  )
}

// ── Which glyph for which type ───────────────────────────────────────────────
// Order matters: the SPECIFIC families are tested before the general ones, so
// "Implantkroon" lands on the implant rather than on the crown. This mirrors
// ICON_FAMILIES' old ordering and workTypeRules' own keyword families.
const GLYPH_FAMILIES: { glyph: ToothGlyphName; tokens: string[] }[] = [
  { glyph: 'implant',   tokens: ['implant', 'abutment', 'abutmendile', 'all-on', 'allon', 'all on', 'hübriid', 'hybrid'] },
  { glyph: 'arch',      tokens: ['proteez', 'denture', 'terve lõualuu'] },
  { glyph: 'bridge',    tokens: ['sild', 'bridge'] },
  { glyph: 'veneer',    tokens: ['viniir', 'veneer', 'laminaat', 'laminate'] },
  { glyph: 'inlay',     tokens: ['inlay', 'onlay', 'täidis', 'taidis', 'filling'] },
  { glyph: 'appliance', tokens: ['splint', 'kaitse', 'nightguard', 'öökaitse', 'ookaitse', 'lahas', 'splaad', 'retainer', 'traat', 'kapp', 'tray', 'ibt'] },
  { glyph: 'model',     tokens: ['mudel', 'model'] },
  { glyph: 'guide',     tokens: ['kirurg', 'surgic', 'guide'] },
  { glyph: 'crown',     tokens: ['kroon', 'crown'] },
]

/**
 * Picks a glyph from a type's identity tokens — its own name plus the synonyms
 * Seaded stores. Anything unrecognised gets the plain tooth, never a shape.
 */
export function toothGlyphFor(tokens: readonly string[]): ToothGlyphName {
  const lower = tokens.map(t => t.toLowerCase())
  const hit = GLYPH_FAMILIES.find(f => f.tokens.some(k => lower.some(tok => tok.includes(k))))
  return hit?.glyph ?? 'tooth'
}

/**
 * A FILLED tooth silhouette — the shade swatch, not an icon.
 *
 * The VITA block previously showed each shade as a 44px square of colour, which
 * is the one thing a shade is not: a technician matches a tooth, so the swatch
 * has to be tooth-shaped to be comparable at all.
 */
export function ToothSwatch({
  hex, width = 52, height = 66,
}: { hex: string; width?: number; height?: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* A hairline in the ink token rather than a black alpha: on the navy card
          of 'cloudy-navy' a black edge disappears and the palest shades float
          with no outline at all. */}
      <path
        d={INCISOR_BODY}
        fill={hex}
        stroke="currentColor"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
