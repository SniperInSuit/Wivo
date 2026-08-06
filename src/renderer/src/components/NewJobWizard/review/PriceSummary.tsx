import { useState } from 'react'
import { Euro, Zap, AlertTriangle, RotateCcw, Tag } from 'lucide-react'
import type { Quote } from '@shared/pricing/quote'
import type { WizardPricing } from '@shared/wizard'
import { WizardField } from '../ui/WizardField'
import { FOCUS_RING, WIZARD_BTN, WIZARD_INPUT } from '../wizardTheme'

export interface PriceSummaryProps {
  /** quoteJob(wizardQuoteInput(state, types), priceBookOf(settings)). */
  quote: Quote
  /** state.pricing — the manual override and the design fee. */
  pricing: WizardPricing
  /** Omit to render the panel read-only. */
  onChange?: (pricing: WizardPricing) => void
  /** true when at least one selected work type has a `soodushind` configured.
   *  Without it the discount toggle is not offered, because there is nothing
   *  for it to discount. */
  discountAvailable?: boolean
}

/**
 * '' is an empty answer. A comma is a decimal point — Estonian types "12,50".
 * A negative is refused rather than stored: `min={0}` on an input is not
 * enforced for a typed value, and `-50` used to be written to the job verbatim.
 */
const parseEur = (raw: string): number | null => {
  const cleaned = raw.trim().replace(',', '.')
  const n = Number(cleaned)
  return cleaned === '' || Number.isNaN(n) || n < 0 ? null : n
}

const eur = (n: number): string => `${n.toFixed(2)} €`
const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * A money field you can actually type into.
 *
 * The previous version was `type="number"` with its value re-derived through
 * `String(Number(raw))` on every keystroke, which made a decimal impossible to
 * enter: a number input drops the comma before onChange ever sees it, and the
 * round-trip through Number() ate the "." of "12." so the next digit landed on
 * the integer. Holding the RAW text locally and parsing it only for the caller
 * is the whole fix — the field shows what was typed, the state gets a number.
 */
function EuroInput({
  id, value, placeholder, onChange,
}: {
  id: string
  value: number | null
  placeholder: string
  onChange: (value: number | null) => void
}): JSX.Element {
  const [raw, setRaw] = useState(value == null ? '' : String(value))
  const [seen, setSeen] = useState(value)

  // Re-sync only when the value changed from OUTSIDE (the Autoarvutus reset).
  // Typing must never have its own text rewritten under the cursor.
  if (value !== seen) {
    setSeen(value)
    if (parseEur(raw) !== value) setRaw(value == null ? '' : String(value))
  }

  return (
    <input
      id={id}
      // text, not number: `type="number"` filters the comma out on the way in
      // and refuses a half-typed "12.". inputMode keeps the numeric keypad.
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={raw}
      placeholder={placeholder}
      onChange={e => {
        setRaw(e.target.value)
        onChange(parseEur(e.target.value))
      }}
      className={WIZARD_INPUT}
    />
  )
}

/**
 * What the job will cost, and — more importantly — when it will not say.
 *
 * `quote.unpriced` being non-empty means the quote could not see part of the
 * job. `toJobInput()` writes `hind: null` in that case, so this panel must not
 * show a number that looks like the price: the user would leave believing the
 * job is priced and find an empty field on the job page.
 *
 * The effective-price rule below is a deliberate MIRROR of toJobInput()'s
 * `hind` mapping. If one of the two ever changes, the other has to change in
 * the same commit — a summary that disagrees with what is saved is worse than
 * no summary.
 */
export function PriceSummary({ quote, pricing, onChange, discountAvailable }: PriceSummaryProps) {
  const manual = pricing.overridden ? pricing.hind : null
  const auto = quote.unpriced.length === 0 && quote.production !== 0 ? quote.production : null
  const production = manual ?? auto

  const disain = pricing.disainHind ?? 0
  const total = production == null ? null : round2(production + disain)

  return (
    <section
      className="rounded-xl border border-ink-faint/25 bg-bg-card p-5 shadow-card"
      aria-labelledby="review-price-heading"
    >
      <h3
        id="review-price-heading"
        className="flex items-center gap-2 text-base font-semibold text-ink mb-4"
      >
        <Euro className="w-5 h-5 text-accent" aria-hidden="true" />
        Hind
      </h3>

      {/* Same wording as the job page's pricing block on purpose — the user
          meets this message twice and it should read as one message. */}
      {quote.unpriced.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 mb-4">
          <p className="flex items-center gap-2 text-base font-semibold text-amber-500">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            Hinda ei arvutatud automaatselt
          </p>
          <ul className="mt-2 space-y-1">
            {quote.unpriced.map((reason, i) => (
              <li key={i} className="text-base text-ink-muted">· {reason}</li>
            ))}
          </ul>
          <p className="text-base text-ink-faint mt-2">
            Töö saab ikka luua. Hinna saad lisada töö lehel või määrata Seaded → Hinnad all.
          </p>
        </div>
      )}

      {quote.lines.length > 0 && (
        <div className="bg-bg-sidebar rounded-xl p-4 space-y-2 mb-4">
          <p className="text-base font-semibold text-ink-muted">Autoarvutus</p>
          {quote.lines.map((line, i) => (
            <div
              key={i}
              className={`flex items-baseline justify-between gap-4 text-base ${
                line.source === 'kiirtöö' ? 'text-amber-500 font-medium' : 'text-ink-muted'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {line.source === 'kiirtöö' && <Zap className="w-4 h-4" aria-hidden="true" />}
                {line.label}
              </span>
              <span className="font-medium text-ink tabular-nums">{eur(line.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <dl className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-base text-ink-soft">Laborihind</dt>
          <dd className="text-base font-medium text-ink tabular-nums">
            {production == null ? <span className="text-ink-faint">Määramata</span> : eur(production)}
          </dd>
        </div>

        {manual != null && (
          <p className="text-base text-ink-muted">
            Hind on käsitsi määratud — autoarvutust ei kasutata.
          </p>
        )}

        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-base text-ink-soft">Disainihind</dt>
          <dd className="text-base font-medium text-ink tabular-nums">
            {disain > 0 ? eur(disain) : <span className="text-ink-faint">—</span>}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 pt-3 border-t border-ink-faint/25">
          <dt className="text-sm font-medium uppercase tracking-wide text-ink-muted">Kokku</dt>
          {/* The one number on this page anybody actually looks for. An unpriced
              job deliberately does NOT get the big teal treatment — a large
              confident figure is exactly the wrong thing to show when the quote
              could not see half the job. */}
          <dd className="text-3xl font-bold leading-none text-accent tabular-nums">
            {total == null
              ? <span className="text-base font-medium text-ink-faint">Hind lisatakse hiljem</span>
              : eur(total)}
          </dd>
        </div>
      </dl>

      {/* The two prices the wizard can actually set. Without them `disain_hind`
          would have no way in at all and the manual override would be dead
          state that toJobInput() reads and nothing writes. Both stay optional —
          an unpriced job is a legitimate job. */}
      {onChange && (
        <div className="mt-5 pt-5 border-t border-ink-faint/25 grid gap-4 sm:grid-cols-2">
          <WizardField
            label="Laborihind"
            htmlFor="wizard-hind"
            help={
              auto == null
                ? 'Automaatset hinda ei arvutatud. Võid selle siia ise kirjutada.'
                : `Automaatne hind on ${eur(auto)}. Kirjuta siia ainult siis, kui hind on kokku lepitud teisiti.`
            }
          >
            <div className="flex gap-2">
              <EuroInput
                id="wizard-hind"
                value={pricing.overridden && pricing.hind != null ? pricing.hind : null}
                placeholder={auto == null ? 'Määramata' : auto.toFixed(2)}
                // Clearing the field returns the job to the autoarvutus rather
                // than pinning it at "manually null", which would silently
                // discard a price the book could work out.
                onChange={hind => onChange({ ...pricing, hind, overridden: hind != null })}
              />
              {pricing.overridden && (
                <button
                  type="button"
                  onClick={() => onChange({ ...pricing, hind: null, overridden: false })}
                  className={`${WIZARD_BTN} shrink-0 inline-flex items-center gap-2 border border-ink-faint/40 bg-bg-card text-ink-soft`}
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  Autoarvutus
                </button>
              )}
            </div>
          </WizardField>

          <WizardField
            label="Disainihind"
            htmlFor="wizard-disain-hind"
            help="Disaini eest eraldi küsitav tasu. Jäta tühjaks, kui seda ei ole."
          >
            <EuroInput
              id="wizard-disain-hind"
              value={pricing.disainHind}
              placeholder="0.00"
              onChange={disainHind => onChange({ ...pricing, disainHind })}
            />
          </WizardField>
        </div>
      )}

      {/* The soodushind switch. `pricing.useDiscount` is threaded all the way
          into quoteJob and used to be permanently false, so a second price the
          lab had configured in Seaded was unreachable from the wizard. Only
          offered when some selected type actually has one. */}
      {onChange && discountAvailable && (
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-ink-faint/30 bg-bg-sidebar p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={pricing.useDiscount}
            onChange={e => onChange({ ...pricing, useDiscount: e.target.checked })}
            className={`mt-0.5 h-5 w-5 shrink-0 accent-accent ${FOCUS_RING}`}
          />
          <span>
            <span className="flex items-center gap-2 text-base font-medium text-ink">
              <Tag className="h-4 w-4 text-accent" aria-hidden="true" />
              Kasuta soodushinda
            </span>
            <span className="mt-0.5 block text-base text-ink-muted">
              Mõnel valitud töö tüübil on Seadetes teine, soodsam hind. Märgi see,
              kui selle tööga on nii kokku lepitud.
            </span>
          </span>
        </label>
      )}

      {/* Paid status is deliberately absent: nothing is paid at the moment a job
          is created, and asking would invite a wrong answer. */}
      <p className="mt-4 text-base text-ink-faint">
        Maksmise saad märkida hiljem töö lehel.
      </p>
    </section>
  )
}
