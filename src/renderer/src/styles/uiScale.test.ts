/**
 * The UI-scale rules in `styles/index.css`, guarded as text.
 *
 * ── Why a test for a stylesheet ─────────────────────────────────────────────
 * These three rules look inconsistent with each other and the inconsistency is
 * correct, which is the worst combination there is: the obvious tidy-up —
 * "make #root divide by --ui-scale like the other two" — is exactly the bug
 * that was just fixed, and it is invisible at 100%, which is where everybody
 * develops.
 *
 * Measured in Electron 32 / Chromium 128, viewport 984 × 735, zoom 1.25:
 *
 *   width: 100%               → 984   percentages already account for zoom
 *   width: calc(100% / 1.25)  → 787   so dividing applies it TWICE
 *   width: 100vw              → 1230  viewport units do not
 *   width: calc(100vw / 1.25) → 984
 *
 * There is no DOM in this suite and `zoom` is not something jsdom implements,
 * so this cannot check the rendering. It checks the decision — which is the
 * part that was wrong, and the part somebody will want to change back.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'index.css'), 'utf8')

/**
 * Every declaration that applies to `selector`, from every rule naming it.
 *
 * All of them, not the first: `#root` is sized by one rule as part of
 * `html, body, #root` and zoomed by another of its own. The cascade applies
 * both, so a test that reads only one can pass while the file says the
 * opposite — and the first match is the one that says nothing about zoom.
 */
function ruleBody(selector: string): string {
  // At-rule openers go too. `@layer components {` otherwise parses as a
  // selector whose body runs to the first `}` — which swallows the first rule
  // inside the layer whole, and `.h-panel` happens to be that rule.
  const live = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@[a-z-]+[^{;]*\{/gi, '')
  const bodies: string[] = []
  for (const m of live.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const names = m[1].split(',').map(s => s.trim())
    if (names.includes(selector)) bodies.push(m[2])
  }
  if (bodies.length === 0) throw new Error(`no rule for ${selector}`)
  return bodies.join('\n')
}

describe('#root', () => {
  it('applies the zoom', () => {
    expect(ruleBody('#root')).toContain('zoom: var(--ui-scale, 1)')
  })

  it('does NOT divide its own size by the scale', () => {
    // Re-adding this leaves a band of empty window below the app at every text
    // size except 100% — the exact bug this guards.
    expect(ruleBody('#root')).not.toMatch(/calc\(\s*100%\s*\/\s*var\(--ui-scale/)
  })
})

describe('viewport-sized elements inside the zoom', () => {
  it('.h-panel divides, because vh does not account for zoom', () => {
    expect(ruleBody('.h-panel')).toMatch(/calc\(\s*70vh\s*\/\s*var\(--ui-scale/)
  })

  it('.max-w-dialog divides for the same reason', () => {
    expect(ruleBody('.max-w-dialog')).toMatch(/calc\(\s*92vw\s*\/\s*var\(--ui-scale/)
  })

  it('every vh/vw length in the file is divided by the scale', () => {
    // A new panel sized in bare vh would spill past the window at 125%, and
    // whoever adds it will not be thinking about zoom. Comments are stripped
    // so the worked example above does not count as a violation.
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const bare = [...live.matchAll(/[^/(\s]*\d+(?:\.\d+)?v[hw]\b/g)]
      .map(m => m[0])
      .filter(found => {
        const at = live.indexOf(found)
        return !live.slice(at, at + found.length + 40).includes('var(--ui-scale')
      })
    expect(bare).toEqual([])
  })
})
