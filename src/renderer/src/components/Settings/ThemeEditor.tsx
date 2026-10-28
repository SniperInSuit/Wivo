/**
 * The colour editor for the user's own theme.
 *
 * ── Why "start from" is a required first step and not a nicety ──────────────
 * An empty custom theme falls through to the base `:root` block for every
 * token it does not set, which is the light theme. So a person who sets one
 * colour gets that colour on top of Hele, whatever they had on screen before —
 * and the first impression of the editor is the app changing in a way they did
 * not ask for. Seeding every token from the theme they were already using makes
 * the first state of the editor identical to what they are looking at.
 *
 * ── Why the values are read off the document ────────────────────────────────
 * See `lib/customTheme`: the stylesheet is the only honest source, and a second
 * hand-kept table of starting colours would drift from it silently. `seedFrom`
 * applies the base theme to a throwaway element and reads what the browser
 * computes — which cannot be out of date with the stylesheet that produced it.
 */
import { useState } from 'react'
import { Palette, AlertTriangle, Check, RotateCcw } from 'lucide-react'
import { useSettings, THEMES, type ThemeKey } from '../../stores/useSettings'
import {
  THEME_TOKENS, CONTRAST_CHECKS, checkContrast, parseTriple, rgbToHex, hexToRgb,
  type CustomTheme,
} from '../../lib/customTheme'

/** Built-in themes, in picker order, that a custom theme can be seeded from. */
const SEEDS = THEMES.filter(t => t.key !== 'oma')

/**
 * Every token's value as the stylesheet computes it for `theme`.
 *
 * The element is attached to the document because an unattached one inherits
 * nothing and `getComputedStyle` would answer with empty strings. It is kept
 * out of sight and removed in the same tick, so nothing is ever painted.
 */
function seedFrom(theme: ThemeKey): CustomTheme {
  const probe = document.createElement('div')
  probe.dataset.theme = theme
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0'
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe)
  const out: CustomTheme = {}
  for (const token of THEME_TOKENS) {
    const rgb = parseTriple(computed.getPropertyValue(token.css))
    if (rgb) out[token.key] = rgbToHex(rgb)
  }
  // Two built-in themes use a GRADIENT for the page background, which a custom
  // theme cannot hold, so `app-bg` comes back unreadable for them. Leaving it
  // unset is worse than it sounds: an unset token falls through to the base
  // `:root` block, which is the light theme — so seeding from Navy Cloud would
  // put its dark cards on a white page.
  //
  // `--c-bg` is the flat equivalent of that same surface and exists in every
  // theme, which is exactly the colour to start from.
  if (!out['app-bg']) {
    const flat = parseTriple(computed.getPropertyValue('--c-bg'))
    if (flat) out['app-bg'] = rgbToHex(flat)
  }
  probe.remove()
  return out
}

export function ThemeEditor() {
  const { settings, setTeema, setOmaTeema, setOmaTeemaToken } = useSettings()
  const theme = settings.omaTeema ?? {}
  const started = Object.keys(theme).length > 0
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  const results = checkContrast(theme)
  const failing = results.filter(r => !r.passes)
  // Pairs we could not score because a token is still following the base theme.
  // Named rather than hidden: "no warnings" must not be able to mean "nothing
  // was checked".
  const unchecked = CONTRAST_CHECKS.length - results.length

  const groups = [...new Set(THEME_TOKENS.map(t => t.group))]

  function start(from: ThemeKey) {
    setOmaTeema(seedFrom(from))
    setTeema('oma')
  }

  if (!started) {
    return (
      <section>
        <div className="mb-1 flex items-center gap-2">
          <Palette size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-ink">Oma teema</h3>
        </div>
        <p className="mb-3 text-xs text-ink-muted">
          Alusta olemasolevast teemast ja muuda seda. Nii näeb redaktor alguses
          välja täpselt nii, nagu rakendus praegu — ja sa muudad ainult seda, mida
          tahad.
        </p>
        <div className="flex flex-wrap gap-2">
          {SEEDS.map(t => (
            <button key={t.key} type="button" onClick={() => start(t.key)}
              className="btn-ghost border border-ink-faint/25 text-xs">
              Alusta: {t.label}
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <Palette size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">Oma teema</h3>
        {settings.teema !== 'oma' && (
          <button type="button" onClick={() => setTeema('oma')}
            className="btn-ghost border border-accent/40 text-[11px] text-accent">
            Lülita sisse
          </button>
        )}
        <button
          type="button"
          onClick={() => setOmaTeema(undefined)}
          className="ml-auto flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-ink"
          title="Kustuta oma teema ja alusta uuesti"
        >
          <RotateCcw size={11} /> Algseisu
        </button>
      </div>

      {/* Before the pickers, not after. The whole point is to be told while the
          colour can still be changed cheaply. */}
      <div className={`mb-3 rounded-lg border p-2.5 ${
        failing.length > 0
          ? 'border-orange-500/40 bg-orange-500/5'
          : 'border-emerald-500/40 bg-emerald-500/5'
      }`}>
        <div className="flex items-center gap-2">
          {failing.length > 0
            ? <AlertTriangle size={13} className="flex-shrink-0 text-orange-500" />
            : <Check size={13} className="flex-shrink-0 text-emerald-600" />}
          <p className="text-xs font-semibold text-ink">
            {failing.length > 0
              ? `${failing.length} ${failing.length === 1 ? 'kombinatsioon' : 'kombinatsiooni'} on raskesti loetav`
              : 'Kõik kontrollitud kombinatsioonid on loetavad'}
          </p>
        </div>
        {failing.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {failing.map(r => (
              <li key={`${r.fg}-${r.bg}`} className="text-[11px] text-ink-muted">
                <span className="text-ink">{r.label}</span> — kontrast{' '}
                <span className="font-semibold tabular-nums text-orange-600">{r.ratio.toFixed(2)} : 1</span>,
                vaja vähemalt {r.min} : 1
              </li>
            ))}
          </ul>
        )}
        {unchecked > 0 && (
          <p className="mt-1.5 text-[11px] text-ink-faint">
            {unchecked} paari ei kontrollitud — üks nende värvidest järgib veel
            alusteemat.
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Mõõt on WCAG kontrastisuhe. 4,5 : 1 on tavateksti alampiir — just see
          kontroll oleks ära hoidnud teemavea, kus lehe pealkirjad olid
          1,06 : 1 ja praktiliselt nähtamatud.
        </p>
      </div>

      <div className="space-y-2">
        {groups.map(group => {
          const open = openGroup === group
          const tokens = THEME_TOKENS.filter(t => t.group === group)
          return (
            <div key={group} className="overflow-hidden rounded-lg border border-ink-faint/20">
              <button
                type="button"
                onClick={() => setOpenGroup(g => (g === group ? null : group))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-sidebar/50"
              >
                <span className="text-xs font-semibold text-ink">{group}</span>
                <span className="ml-auto flex gap-1">
                  {tokens.map(t => (
                    <span
                      key={t.key}
                      className="h-3.5 w-3.5 rounded-sm border border-ink-faint/30"
                      style={{ background: theme[t.key] ?? 'transparent' }}
                    />
                  ))}
                </span>
              </button>
              {open && (
                <div className="space-y-1.5 border-t border-ink-faint/10 px-3 py-2">
                  {tokens.map(t => (
                    <div key={t.key} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={theme[t.key] ?? '#000000'}
                        onChange={e => setOmaTeemaToken(t.key, e.target.value)}
                        className="h-7 w-10 flex-shrink-0 cursor-pointer rounded border border-ink-faint/30 bg-transparent"
                        aria-label={t.label}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-ink">{t.label}</p>
                        {t.hint && <p className="truncate text-[10px] text-ink-faint">{t.hint}</p>}
                      </div>
                      {/* Typed as well as picked: a brand colour arrives as a
                          hex code on a page, and retyping it into a colour
                          wheel by eye is not a thing anybody can do. */}
                      <input
                        value={theme[t.key] ?? ''}
                        onChange={e => {
                          const v = e.target.value
                          if (hexToRgb(v)) setOmaTeemaToken(t.key, v.startsWith('#') ? v : `#${v}`)
                        }}
                        placeholder="alusteema"
                        spellCheck={false}
                        className="input w-24 font-mono text-[11px]"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
