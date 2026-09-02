/**
 * Per-tooth pricing for the website calculator.
 *
 * Optional per service, and off until somebody enters a price. "Hügieen" has
 * one price and nothing to calculate; "Kroon" is priced per tooth and is exactly
 * what a patient wants to add up before ringing anybody. Forcing every service
 * to be calculable would mean inventing per-tooth prices for services that do
 * not have them.
 *
 * ── This editor computes nothing that reaches a patient ──────────────────────
 * The preview below runs `calculatePublic` — the SAME function the edge function
 * serves from. It is here so the owner can see what a patient will see, not to
 * produce a second answer. If this file ever multiplies a price itself, the
 * website and this screen can disagree, which is the whole failure mode the
 * shared module exists to prevent.
 */
import { useState } from 'react'
import { Plus, Trash2, Calculator } from 'lucide-react'
import type { PublicService, PublicPriceTier, PublicAddOn } from '@shared/portal/publicService'
import { calculatePublic } from '@shared/portal/publicCalculator'

export function CalculatorEditor({ teenus, onPatch }: {
  teenus: PublicService
  onPatch: (patch: Partial<PublicService>) => void
}) {
  const k = teenus.kalkulaator
  const [previewTeeth, setPreviewTeeth] = useState(3)

  const patchCalc = (p: Partial<NonNullable<PublicService['kalkulaator']>>) =>
    onPatch({ kalkulaator: { hambaHind: 0, ...(k ?? {}), ...p } })

  if (!k) {
    return (
      <div className="rounded-xl border border-dashed border-ink-faint/30 p-3">
        <p className="text-xs text-ink-muted">
          Kalkulaator on väljas — veebis näidatakse ainult hinnavahemikku
          „{teenus.hinnaAlates}–{teenus.hinnaKuni} €".
        </p>
        <button
          type="button"
          onClick={() => patchCalc({ hambaHind: teenus.hinnaAlates || 0 })}
          className="btn-ghost text-xs border border-ink-faint/30 mt-2 flex items-center gap-1.5"
        >
          <Calculator size={12} /> Luba hamba kaupa arvutamine
        </button>
      </div>
    )
  }

  const tiers = k.astmed ?? []
  const addOns = k.lisad ?? []

  // The same call the website makes. Deliberately not a local multiplication.
  const preview = calculatePublic([teenus], [{
    serviceId: teenus.id,
    hambad: Array.from({ length: Math.max(0, previewTeeth) }, (_, i) => String(i + 11)),
  }])

  return (
    <div className="rounded-xl border border-ink-faint/25 bg-bg-sidebar/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
          <Calculator size={12} /> Kalkulaator
        </p>
        <button
          type="button"
          onClick={() => onPatch({ kalkulaator: undefined })}
          className="text-[10px] text-ink-faint hover:text-red-500"
        >
          Lülita välja
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Hind ühe hamba eest (€)</label>
          <input
            type="number" min={0} step="0.01" value={k.hambaHind || ''}
            onChange={e => patchCalc({ hambaHind: parseFloat(e.target.value) || 0 })}
            className="input text-sm"
          />
        </div>
        <div>
          <label className="label">Kuni mitu hammast</label>
          <input
            type="number" min={0} value={k.maxHambaid ?? ''}
            onChange={e => patchCalc({ maxHambaid: parseInt(e.target.value, 10) || undefined })}
            placeholder="piirita"
            className="input text-sm"
          />
          {/* A calculator that confidently prices 28 crowns is worse than one
              that admits its limit and asks the person to get in touch. */}
          <p className="text-[10px] text-ink-faint mt-1">
            Üle selle ei anna veeb summat, vaid palub ühendust võtta.
          </p>
        </div>
      </div>

      {/* ── Volume tiers ──────────────────────────────────────────────────── */}
      <div>
        <label className="label">Kogusehinnad</label>
        <p className="text-[10px] text-ink-faint mb-1.5">
          Mitme hamba puhul on hind hamba kohta väiksem. Kõrgeim sobiv aste võidab —
          järjekord ei loe.
        </p>
        <div className="space-y-1">
          {tiers.map((t: PublicPriceTier, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted">alates</span>
              <input
                type="number" min={1} value={t.alates || ''}
                onChange={e => {
                  const next = [...tiers]
                  next[i] = { ...next[i], alates: parseInt(e.target.value, 10) || 0 }
                  patchCalc({ astmed: next })
                }}
                className="input text-sm py-1 w-16"
              />
              <span className="text-[11px] text-ink-muted">hambast</span>
              <input
                type="number" min={0} step="0.01" value={t.hind || ''}
                onChange={e => {
                  const next = [...tiers]
                  next[i] = { ...next[i], hind: parseFloat(e.target.value) || 0 }
                  patchCalc({ astmed: next })
                }}
                className="input text-sm py-1 w-24"
              />
              <span className="text-[11px] text-ink-muted">€ / hammas</span>
              <button
                type="button"
                onClick={() => patchCalc({ astmed: tiers.filter((_, j) => j !== i) })}
                className="ml-auto text-ink-faint hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => patchCalc({ astmed: [...tiers, { alates: 0, hind: 0 }] })}
          className="text-[11px] text-accent hover:text-accent/80 mt-1 flex items-center gap-1"
        >
          <Plus size={11} /> Lisa aste
        </button>
      </div>

      {/* ── Add-ons ───────────────────────────────────────────────────────── */}
      <div>
        <label className="label">Lisavalikud</label>
        <p className="text-[10px] text-ink-faint mb-1.5">
          Mida patsient saab juurde valida — toonivalik, pikendatud garantii.
        </p>
        <div className="space-y-1">
          {addOns.map((a: PublicAddOn, i: number) => (
            <div key={a.id} className="flex items-center gap-2">
              <input
                value={a.nimi}
                onChange={e => {
                  const next = [...addOns]
                  next[i] = { ...next[i], nimi: e.target.value }
                  patchCalc({ lisad: next })
                }}
                placeholder="Nimi"
                className="input text-sm py-1 flex-1 min-w-0"
              />
              <input
                type="number" min={0} step="0.01" value={a.hind || ''}
                onChange={e => {
                  const next = [...addOns]
                  next[i] = { ...next[i], hind: parseFloat(e.target.value) || 0 }
                  patchCalc({ lisad: next })
                }}
                className="input text-sm py-1 w-20"
              />
              <button
                type="button"
                onClick={() => {
                  const next = [...addOns]
                  next[i] = { ...next[i], hambaKohta: !next[i].hambaKohta }
                  patchCalc({ lisad: next })
                }}
                title="Kas hind käib ühe hamba kohta või kogu töö kohta"
                className={`text-[10px] px-1.5 py-1 rounded whitespace-nowrap ${
                  a.hambaKohta ? 'bg-accent/15 text-accent font-medium' : 'bg-bg-sidebar text-ink-muted'
                }`}
              >
                {a.hambaKohta ? '€ / hammas' : '€ / töö'}
              </button>
              <button
                type="button"
                onClick={() => patchCalc({ lisad: addOns.filter((_, j) => j !== i) })}
                className="text-ink-faint hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => patchCalc({
            lisad: [...addOns, { id: crypto.randomUUID().slice(0, 8), nimi: '', hind: 0 }],
          })}
          className="text-[11px] text-accent hover:text-accent/80 mt-1 flex items-center gap-1"
        >
          <Plus size={11} /> Lisa valik
        </button>
      </div>

      {/* ── Preview, from the shared function ─────────────────────────────── */}
      <div className="rounded-lg bg-bg-card border border-ink-faint/20 p-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] text-ink-muted">Näidis:</span>
          <input
            type="number" min={1} max={32} value={previewTeeth}
            onChange={e => setPreviewTeeth(parseInt(e.target.value, 10) || 0)}
            className="input text-sm py-0.5 w-16"
          />
          <span className="text-[11px] text-ink-muted">hammast</span>
        </div>
        {preview.probleemid.length > 0 ? (
          <p className="text-[11px] text-orange-600">{preview.probleemid[0]}</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-ink tabular-nums">{preview.kokkuTekst}</p>
            {preview.read[0] && (
              <p className="text-[11px] text-ink-muted">
                {preview.read[0].tekst}
                {preview.read[0].astmeAlates
                  && ` · kogusehind alates ${preview.read[0].astmeAlates} hambast`}
              </p>
            )}
          </>
        )}
        <p className="text-[10px] text-ink-faint mt-1">
          Veebis kuvatakse selle kõrval alati: „{preview.hoiatus}"
        </p>
      </div>
    </div>
  )
}
