/**
 * The custom theme's decisions, tested without a browser.
 *
 * The contrast maths is the part worth guarding. It is the one thing standing
 * between a colour picker and the bug v1.91.0 fixed — page titles at 1.06 : 1
 * — only this time made by somebody who cannot read the stylesheet to find out
 * what went wrong.
 */
import { describe, it, expect } from 'vitest'
import {
  hexToRgb, rgbToHex, parseTriple, contrastRatio, checkContrast,
  normaliseCustomTheme, customThemeCss, THEME_TOKENS, CONTRAST_CHECKS,
} from './customTheme'

describe('colour parsing', () => {
  it('reads a hex colour with or without the hash', () => {
    expect(hexToRgb('#1b2a4b')).toEqual([27, 42, 75])
    expect(hexToRgb('1b2a4b')).toEqual([27, 42, 75])
  })

  it('REFUSES a short hex, a name, and anything else', () => {
    // Three digits is valid CSS and is NOT accepted, because every value here
    // goes out as a channel triple and a half-parsed colour would be injected
    // into a live stylesheet.
    expect(hexToRgb('#abc')).toBeNull()
    expect(hexToRgb('red')).toBeNull()
    expect(hexToRgb('')).toBeNull()
    expect(hexToRgb('#1b2a4bzz')).toBeNull()
  })

  it('round-trips through hex', () => {
    expect(rgbToHex(hexToRgb('#0eb6c4')!)).toBe('#0eb6c4')
  })

  it('pads single-digit channels', () => {
    expect(rgbToHex([0, 5, 255])).toBe('#0005ff')
  })

  it('reads the channel-triple form the stylesheet stores', () => {
    expect(parseTriple('14 17 22')).toEqual([14, 17, 22])
    expect(parseTriple('  247 249 250  ')).toEqual([247, 249, 250])
  })

  it('also reads what getComputedStyle returns for --app-bg', () => {
    // That token is a background shorthand, not a triple, so it comes back
    // already wrapped — in either of the two spellings browsers use.
    expect(parseTriple('rgb(247 249 250)')).toEqual([247, 249, 250])
    expect(parseTriple('rgb(247, 249, 250)')).toEqual([247, 249, 250])
  })

  it('REFUSES a gradient rather than taking its first three numbers', () => {
    // Two built-in themes use a gradient for --app-bg. Reading '135' off
    // `linear-gradient(135deg,#16284B...)` would seed a custom theme with a
    // colour that appears nowhere in it.
    expect(parseTriple('linear-gradient(135deg,#16284B 0%,#0F1D3A 100%)')).toBeNull()
  })

  it('REFUSES channel values outside 0–255', () => {
    expect(parseTriple('300 10 10')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('gives 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21)
    expect(contrastRatio([18, 24, 38], [18, 24, 38])).toBe(1)
  })

  it('is symmetric — which colour is the text does not change the ratio', () => {
    const a = contrastRatio([14, 17, 22], [247, 249, 250])
    const b = contrastRatio([247, 249, 250], [14, 17, 22])
    expect(a).toBe(b)
  })

  it('scores the bug that caused this feature at about 1 : 1', () => {
    // Navy Cloud's real values: --c-ink 12 18 30 on --app-bg 12 24 48. This is
    // what shipped, and what nobody saw until it was on screen.
    expect(contrastRatio([12, 18, 30], [12, 24, 48])).toBeLessThan(1.2)
  })

  it('passes the colour that replaced it', () => {
    // Light page ink on the same navy.
    expect(contrastRatio([226, 236, 250], [12, 24, 48])).toBeGreaterThan(4.5)
  })
})

describe('checkContrast', () => {
  it('fails a dark page title on a dark page', () => {
    const got = checkContrast({ 'page-ink': '#0c121e', 'app-bg': '#0c1830' })
    expect(got).toHaveLength(1)
    expect(got[0].passes).toBe(false)
  })

  it('passes once the title is light', () => {
    expect(checkContrast({ 'page-ink': '#e2ecfa', 'app-bg': '#0c1830' })[0].passes).toBe(true)
  })

  it('SKIPS a pair whose colours are not both set, rather than failing it', () => {
    // A missing token follows the base theme, which we ship and know is
    // readable. Reporting it would warn about the part nobody has touched.
    expect(checkContrast({ 'page-ink': '#e2ecfa' })).toEqual([])
  })

  it('holds borders to 3 : 1 and body text to 4.5 : 1', () => {
    const faint = CONTRAST_CHECKS.find(c => c.fg === 'ink-faint')!
    const body = CONTRAST_CHECKS.find(c => c.fg === 'ink' && c.bg === 'bg-card')!
    expect(faint.min).toBe(3)
    expect(body.min).toBe(4.5)
  })

  it('names only pairs that are real tokens', () => {
    const keys = THEME_TOKENS.map(t => t.key)
    for (const c of CONTRAST_CHECKS) {
      expect(keys).toContain(c.fg)
      expect(keys).toContain(c.bg)
    }
  })
})

describe('normaliseCustomTheme', () => {
  it('keeps known tokens with valid colours', () => {
    expect(normaliseCustomTheme({ accent: '#0eb6c4' })).toEqual({ accent: '#0eb6c4' })
  })

  it('REFUSES an unknown token name', () => {
    // Unlike ui_prefs, which carries unknown keys through on purpose: this
    // value is injected into a live stylesheet, so what leaves is only ever a
    // name we recognise.
    expect(normaliseCustomTheme({ 'evil--x': '#000000' })).toBeUndefined()
  })

  it('REFUSES a value that is not a colour', () => {
    expect(normaliseCustomTheme({ accent: 'red; } body { display:none' })).toBeUndefined()
    expect(normaliseCustomTheme({ accent: 42 })).toBeUndefined()
  })

  it('drops the bad entries and keeps the good ones', () => {
    expect(normaliseCustomTheme({ accent: '#0eb6c4', nope: '#fff000', ink: 'x' }))
      .toEqual({ accent: '#0eb6c4' })
  })

  it('returns undefined for an empty result, which means "no custom theme"', () => {
    expect(normaliseCustomTheme({})).toBeUndefined()
    expect(normaliseCustomTheme(null)).toBeUndefined()
    expect(normaliseCustomTheme([])).toBeUndefined()
    expect(normaliseCustomTheme('#fff')).toBeUndefined()
  })
})

describe('customThemeCss', () => {
  it('emits channel triples, not rgb(), so alpha modifiers keep working', () => {
    // `bg-accent/10` compiles to `rgb(var(--c-accent) / 0.1)`. A finished
    // rgb() in the variable makes that invalid and the colour vanishes.
    const css = customThemeCss({ accent: '#0eb6c4' })
    expect(css).toContain('--c-accent: 14 182 196;')
    expect(css).not.toContain('--c-accent: rgb')
  })

  it('wraps --app-bg, which is a background shorthand and not a triple', () => {
    expect(customThemeCss({ 'app-bg': '#f7f9fa' })).toContain('--app-bg: rgb(247 249 250);')
  })

  it('scopes everything to the custom theme and nothing else', () => {
    expect(customThemeCss({ accent: '#0eb6c4' })).toContain(":root[data-theme='oma']")
  })

  it('emits nothing for a token that is not set, so it keeps the base value', () => {
    const css = customThemeCss({ accent: '#0eb6c4' })
    expect(css).not.toContain('--c-ink:')
  })

  it('is empty when there is nothing to say', () => {
    expect(customThemeCss({})).toBe('')
  })
})

describe('parseTriple refuses gradients for the right reason', () => {
  it('REFUSES a gradient whose leading numbers happen to be in range', () => {
    // The loose "first three numbers" version accepts this: 90, 0, 0 — a real
    // colour that appears nowhere in the gradient. Two built-in themes use a
    // gradient for --app-bg, so seeding from one would have silently invented
    // a dark red page.
    expect(parseTriple('linear-gradient(90deg,#000 0%,#fff 100%)')).toBeNull()
  })

  it('REFUSES a bare hex, which is not the stored form', () => {
    expect(parseTriple('#0eb6c4')).toBeNull()
  })

  it('still reads both forms the browser actually returns', () => {
    expect(parseTriple('14 17 22')).toEqual([14, 17, 22])
    expect(parseTriple('rgb(14 17 22)')).toEqual([14, 17, 22])
    expect(parseTriple('rgba(14, 17, 22, 0.5)')).toEqual([14, 17, 22])
  })
})
