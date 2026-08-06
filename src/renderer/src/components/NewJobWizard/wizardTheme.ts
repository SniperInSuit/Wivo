/**
 * The wizard's shared class strings.
 *
 * These exist because the wizard has a HARDER accessibility floor than the rest
 * of the app: the product serves older users, so every control is at least 44px
 * tall and every body string is 16px. The global `.input` (text-sm, py-2) and
 * `.label` (text-xs) are deliberately smaller — they are right for the dense
 * Edit page and wrong here. Rather than let six builders each invent their own
 * "but bigger" variant, the variants live here once.
 *
 * Nothing in this file is a component. Import the strings, do not re-declare
 * them: a focus ring that only MOSTLY matches is worse than none, because the
 * user learns one shape and then meets another.
 *
 * COLOUR RULE: every colour here has to survive all four themes. The app themes
 * through CSS variables on :root[data-theme], NOT through a `dark` class —
 * tailwind.config.js declares no `darkMode`, so a `dark:` variant in this tree
 * fires on the viewer's OS setting and is therefore always wrong. Anything that
 * is not a token is either an alpha tint over the card surface (which follows
 * the surface) or a mid-tone shade that clears 4.5:1 on both white and the
 * #162340 card of 'cloudy-navy' — the 500 shades do, the 700s do not.
 */

/* The wizard's magenta is the tailwind token `stage.varvi` (#EC4899) and is
 * used as `bg-stage-varvi` / `text-stage-varvi` / `ring-stage-varvi`. There is
 * deliberately no hex constant for it: the exported `WIZARD_MAGENTA` string
 * forced every consumer into an inline `style`, where opacity modifiers and
 * hover variants do not exist and the value could drift from the palette. */

/** The blush field the odontogram sits on — the same `#FFF5F6` the picker's own
 *  SVG paints, so the chart and its surround read as one surface rather than a
 *  pink picture dropped into a grey box. A literal and not a token because it
 *  must match the SVG exactly in every theme. */
export const WIZARD_BLUSH = '#FFF5F6'

/** Work type with no colour of its own. One constant so a theme change does
 *  not leave stale slate dots in four different files. */
export const WIZARD_FALLBACK_HEX = '#94A3B8'

/** THE focus-visible string. Append verbatim to EVERY interactive element.
 *  focus-visible rather than focus so a mouse click does not leave a ring
 *  behind, but a Tab always does. */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-stage-varvi focus-visible:ring-offset-bg-card'

/** Label ABOVE the input. 16px — the floor this file exists to hold. */
export const WIZARD_LABEL = 'block text-base font-semibold text-ink-soft mb-1.5'

/** 16px body text, 44px tall. Do NOT use the global `.input` (text-sm/py-2). */
export const WIZARD_INPUT =
  'w-full min-h-[44px] px-3.5 py-2.5 text-base bg-bg-card text-ink ' +
  'border border-ink-faint/40 rounded-xl placeholder:text-ink-faint ' +
  'transition-colors duration-150 ' + FOCUS_RING

export const WIZARD_HELP = 'mt-1.5 text-base text-ink-muted'
/** rose-500 and not rose-600/700: an error message is the one string that must
 *  be legible on every surface, and only the 500 clears 4.5:1 on navy. */
export const WIZARD_ERROR = 'mt-1.5 flex items-center gap-1.5 text-base font-medium text-rose-500'
export const WIZARD_BTN = 'min-h-[44px] px-5 text-base font-medium rounded-xl ' + FOCUS_RING
export const WIZARD_CARD_MIN = 'min-h-[104px]'
export const WIZARD_HIT_MIN = 'min-h-[44px] min-w-[44px]'
