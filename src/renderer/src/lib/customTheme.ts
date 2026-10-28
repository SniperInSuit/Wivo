/**
 * The user's own theme — every decision that can be made without a DOM.
 *
 * ── Why the contrast check is not decoration ────────────────────────────────
 * v1.91.0 fixed page titles rendering at about 1.1 : 1 — near-black ink on a
 * navy page — and that was OUR mistake, made once, by somebody who knew the
 * token system. A colour picker hands the same mistake to everybody, with no
 * review step and no release to catch it in. So the editor has to say it before
 * the colour is saved, not after somebody cannot read their own invoices.
 *
 * ── Why the base values are READ and not listed here ────────────────────────
 * The obvious design is a table of starting colours per theme. `THEMES` already
 * has one for its preview swatches, with a comment admitting it is kept in sync
 * by hand and is decoration rather than the source. A second hand-kept copy
 * would be the one people actually start their theme from, and it would drift
 * from the stylesheet silently. So the editor reads the live computed values off
 * the document — see `readLiveTokens` — and everything here takes them as input.
 */

/** One editable colour. `css` is the custom property the stylesheet reads. */
export interface ThemeToken {
  key: string
  css: string
  label: string
  group: string
  hint?: string
}

/**
 * Every colour the stylesheet exposes, grouped the way somebody thinks about
 * them rather than the order they appear in the file.
 *
 * `app-bg` is last in its group and is the odd one: the stylesheet treats it as
 * a full background shorthand so two built-in themes can use a gradient. A
 * custom theme gets a flat colour, which is a real limit and an honest one —
 * a gradient editor is a different feature, and a one-colour page that is
 * readable beats a gradient that is not.
 */
export const THEME_TOKENS: ThemeToken[] = [
  { key: 'accent', css: '--c-accent', group: 'Rõhuvärv', label: 'Rõhuvärv',
    hint: 'Nupud, aktiivsed valikud, lingid' },
  { key: 'accent-hover', css: '--c-accent-hover', group: 'Rõhuvärv', label: 'Rõhuvärv (hover)' },
  { key: 'accent-light', css: '--c-accent-light', group: 'Rõhuvärv', label: 'Rõhuvärv (hele)' },
  { key: 'accent-dark', css: '--c-accent-dark', group: 'Rõhuvärv', label: 'Rõhuvärv (tume)' },

  { key: 'bg-card', css: '--c-bg-card', group: 'Taustad', label: 'Kaardi taust' },
  { key: 'bg-sidebar', css: '--c-bg-sidebar', group: 'Taustad', label: 'Süvistatud pind',
    hint: 'Sisestusväljad ja süvendid kaardi sees' },
  { key: 'bg', css: '--c-bg', group: 'Taustad', label: 'Üldine taust' },
  { key: 'app-bg', css: '--app-bg', group: 'Taustad', label: 'Lehe taust',
    hint: 'See, mille peal kaardid hõljuvad' },

  { key: 'ink', css: '--c-ink', group: 'Tekst kaardil', label: 'Põhitekst' },
  { key: 'ink-soft', css: '--c-ink-soft', group: 'Tekst kaardil', label: 'Pehme tekst' },
  { key: 'ink-muted', css: '--c-ink-muted', group: 'Tekst kaardil', label: 'Vaikne tekst' },
  { key: 'ink-faint', css: '--c-ink-faint', group: 'Tekst kaardil', label: 'Ääred ja vihjed' },

  { key: 'page-ink', css: '--c-page-ink', group: 'Tekst lehe taustal', label: 'Lehe pealkiri',
    hint: 'Otse lehe taustal, mitte kaardi sees' },
  { key: 'page-ink-muted', css: '--c-page-ink-muted', group: 'Tekst lehe taustal', label: 'Lehe alltekst' },

  { key: 'nav-bg', css: '--c-nav-bg', group: 'Külgriba', label: 'Külgriba taust' },
  { key: 'nav', css: '--c-nav', group: 'Külgriba', label: 'Külgriba tekst' },
  { key: 'nav-muted', css: '--c-nav-muted', group: 'Külgriba', label: 'Külgriba vaikne tekst' },

  { key: 'chrome', css: '--c-chrome', group: 'Ülariba', label: 'Ülariba taust' },
  { key: 'chrome-text', css: '--c-chrome-text', group: 'Ülariba', label: 'Ülariba tekst' },
  { key: 'chrome-muted', css: '--c-chrome-muted', group: 'Ülariba', label: 'Ülariba vaikne tekst' },
  { key: 'chrome-faint', css: '--c-chrome-faint', group: 'Ülariba', label: 'Ülariba ääred' },

  { key: 'chip-plate', css: '--c-chip-plate', group: 'Muu', label: 'Logoplaat' },
]

export const THEME_TOKEN_KEYS = THEME_TOKENS.map(t => t.key)

/** key → '#rrggbb'. Any key absent simply falls through to the base theme. */
export type CustomTheme = Record<string, string>

// ── Colour maths ─────────────────────────────────────────────────────────────

const HEX = /^#?([0-9a-f]{6})$/i

/** '#1b2a4b' → [27, 42, 75]. Null for anything that is not a 6-digit hex. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c)))
    .toString(16).padStart(2, '0')).join('')
}

/**
 * '27 42 75' → [27, 42, 75], the channel-triple form the stylesheet stores.
 *
 * Also accepts `rgb(27 42 75)` and the comma form, because that is what
 * `getComputedStyle` hands back for `--app-bg`, which is a full background
 * shorthand rather than a triple.
 */
export function parseTriple(value: string): [number, number, number] | null {
  // Anchored, and only these two shapes. The loose version — pull the first
  // three numbers out of whatever this is — looks equivalent and quietly
  // accepts a gradient: `linear-gradient(90deg,#000 0%,#fff 100%)` yields
  // 90, 0, 0, which is in range, is a real colour, and is nowhere in that
  // gradient. Two built-in themes use a gradient for --app-bg, so this is the
  // normal case, not a hostile one.
  const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/.exec(value)
    ?? /^\s*rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,/)]/.exec(value)
  if (!m) return null
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]
  return rgb.some(n => n > 255) ? null : rgb
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(
  fg: [number, number, number], bg: [number, number, number],
): number {
  const a = luminance(fg)
  const b = luminance(bg)
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  return Math.round(ratio * 100) / 100
}

// ── What must stay readable ──────────────────────────────────────────────────

export interface ContrastCheck {
  fg: string
  bg: string
  label: string
  /** WCAG AA: 4.5 for body text, 3 for large text and non-text edges. */
  min: number
}

/**
 * The pairs that decide whether the app can be used at all.
 *
 * Deliberately short. Checking all 22 tokens against all 22 would produce a
 * wall of warnings about combinations that never appear on screen, and a wall
 * of warnings is read as noise and dismissed — taking the two that mattered
 * with it. These are the pairs the stylesheet actually puts together.
 */
export const CONTRAST_CHECKS: ContrastCheck[] = [
  { fg: 'page-ink', bg: 'app-bg', label: 'Lehe pealkiri lehe taustal', min: 4.5 },
  { fg: 'page-ink-muted', bg: 'app-bg', label: 'Lehe alltekst lehe taustal', min: 4.5 },
  { fg: 'ink', bg: 'bg-card', label: 'Põhitekst kaardil', min: 4.5 },
  { fg: 'ink-muted', bg: 'bg-card', label: 'Vaikne tekst kaardil', min: 4.5 },
  { fg: 'ink-faint', bg: 'bg-card', label: 'Ääred ja vihjed kaardil', min: 3 },
  { fg: 'ink', bg: 'bg-sidebar', label: 'Tekst sisestusväljal', min: 4.5 },
  { fg: 'nav', bg: 'nav-bg', label: 'Külgriba tekst', min: 4.5 },
  { fg: 'nav-muted', bg: 'nav-bg', label: 'Külgriba vaikne tekst', min: 4.5 },
  { fg: 'chrome-text', bg: 'chrome', label: 'Ülariba tekst', min: 4.5 },
  { fg: 'chrome-muted', bg: 'chrome', label: 'Ülariba vaikne tekst', min: 4.5 },
  { fg: 'accent', bg: 'bg-card', label: 'Rõhuvärv kaardil', min: 3 },
]

export interface ContrastResult extends ContrastCheck {
  ratio: number
  passes: boolean
}

/**
 * Every pair scored against the theme as it stands.
 *
 * A pair whose colours cannot be read is SKIPPED rather than scored zero: a
 * missing token means "use the base theme's value", which is a theme we already
 * ship and already know is readable. Reporting it as a failure would warn about
 * the part the user has not touched.
 */
export function checkContrast(theme: CustomTheme): ContrastResult[] {
  const out: ContrastResult[] = []
  for (const check of CONTRAST_CHECKS) {
    const fg = hexToRgb(theme[check.fg] ?? '')
    const bg = hexToRgb(theme[check.bg] ?? '')
    if (!fg || !bg) continue
    const ratio = contrastRatio(fg, bg)
    out.push({ ...check, ratio, passes: ratio >= check.min })
  }
  return out
}

// ── Storage and output ───────────────────────────────────────────────────────

/**
 * Accepts only what we recognise, and drops the rest.
 *
 * The opposite of `uiPrefs`'s "render the intersection, store the union" rule,
 * and on purpose: an unknown panel id is somebody's future layout and costs
 * nothing to carry, while an unknown entry here would be injected into a live
 * stylesheet. Whatever arrives, what leaves is a known token name and six hex
 * digits.
 */
export function normaliseCustomTheme(raw: unknown): CustomTheme | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: CustomTheme = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!THEME_TOKEN_KEYS.includes(key)) continue
    if (typeof value !== 'string') continue
    const rgb = hexToRgb(value)
    if (!rgb) continue
    out[key] = rgbToHex(rgb)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The stylesheet text for a custom theme.
 *
 * Tokens are emitted as CHANNEL TRIPLES, not as `rgb(...)`, because the whole
 * codebase leans on Tailwind's alpha modifiers — `bg-accent/10`,
 * `border-ink-faint/15` — and those compile to `rgb(var(--c-accent) / 0.1)`.
 * A finished `rgb()` in the variable makes that invalid and the colour silently
 * disappears. `--app-bg` is the exception and must be a complete value, since
 * it is used as a background shorthand.
 *
 * An absent token emits nothing, so it keeps the base theme's value rather than
 * resolving to transparent.
 */
export function customThemeCss(theme: CustomTheme): string {
  const lines: string[] = []
  for (const token of THEME_TOKENS) {
    const hex = theme[token.key]
    const rgb = hex ? hexToRgb(hex) : null
    if (!rgb) continue
    lines.push(token.key === 'app-bg'
      ? `  ${token.css}: rgb(${rgb.join(' ')});`
      : `  ${token.css}: ${rgb.join(' ')};`)
  }
  if (lines.length === 0) return ''
  return `:root[data-theme='oma'] {\n${lines.join('\n')}\n}`
}
