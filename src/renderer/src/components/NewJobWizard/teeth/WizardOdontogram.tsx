/**
 * The wizard's odontogram — a WRAPPER around the existing
 * JobDetail/MultiOdontogramPicker, never a second drawing of an arch. Four live
 * screens already depend on that picker's geometry; a copy would drift.
 *
 * The wrapper adds four things the picker does not do:
 *
 *  1. A width clamp. The SVG has no maxHeight and stretches to its container, so
 *     in the wizard's wide column it would render roughly 645 px tall and push
 *     the controls off screen.
 *  2. The refuse-to-steal rule WITH a spoken reason. JobDetailPanel silently
 *     `return`s when a tooth belongs to another work item (JobDetailPanel:1081-
 *     1096); on the Edit page you can see why, in an onboarding wizard a click
 *     that does nothing and says nothing is the single most confusing thing the
 *     step can do.
 *  3. A keyboard path. The picker's teeth are SVG <g> elements with onClick —
 *     not focusable, not operable without a mouse. Not in the contract, but
 *     keyboard operation is a hard requirement and fixing it inside the picker
 *     would mean editing a file four other screens render. The FDI button grid
 *     is that path, and it doubles as the readable fallback on a narrow screen.
 *  4. THE FIELD. The picker paints a blush SVG; on its own in a grey box that
 *     read as a picture someone had dropped in. The blush is carried out to the
 *     surround, with the legend as pills over it, so the chart and its
 *     explanation are one surface.
 *
 * The picker's own chrome is sized up FROM THE OUTSIDE (the `[&_button]` block
 * below): its orientation toggle is a 10px label in a ~22px target with no
 * focus ring, which is less than half this product's floor. Patching it here
 * rather than in the picker keeps the other four screens untouched.
 *
 * Known defects inherited from the picker, deliberately NOT fixed here:
 *   · its orientation toggle writes the app-wide 'wivo_odonto_mirror' key, so
 *     flipping it in the wizard also flips JobDetailPanel;
 *   · its R/L edge labels are dead ternaries (`mirror ? 'R' : 'R'`);
 *   · in mirrored view each tooth's rotation is computed from the UNmirrored
 *     index, so the teeth lean the wrong way while bridge connectors do not.
 */
import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Keyboard } from 'lucide-react'
import { FDI_LOWER, FDI_UPPER, hambadToTeeth } from '@shared/wizard'
import type { WorkItem } from '@/types/job'
import { MultiOdontogramPicker } from '@/components/JobDetail/MultiOdontogramPicker'
import { FOCUS_RING, WIZARD_BLUSH, WIZARD_FALLBACK_HEX } from '../wizardTheme'
import { teethCountLabel } from './WorkTypeTabs'
import type { ToothLegendEntry } from './ToothControls'

export interface WizardOdontogramProps {
  /** wizardWorkItems(state, types) — built by the rules module, not here. */
  items: WorkItem[]
  /** The work type currently receiving clicks. null makes every click a no-op,
   *  so step 2 must always keep one selected while items exist. */
  activeType: string | null
  /** WorkType.nimi → hex, exact-name keyed. */
  colorMap: Record<string, string>
  onToggleTooth: (fdi: number) => void
  /** Colour key drawn as pills over the field. */
  legend?: ToothLegendEntry[]
  /** FDI → arch-level work type that covers it. These teeth are NOT painted
   *  (the chart would fill in a whole jaw) but they are reserved, and the
   *  refusal has to name the arch rather than a tooth nobody can see. */
  reservedByArch?: Map<number, string>
  disabled?: boolean
}

export function WizardOdontogram({
  items, activeType, colorMap, onToggleTooth, legend = [], reservedByArch, disabled,
}: WizardOdontogramProps) {
  // Why refused, in Estonian, for the aria-live region. Cleared on any accepted
  // click so it never lingers as a stale accusation.
  const [refusal, setRefusal] = useState<string | null>(null)
  const [gridOpen, setGridOpen] = useState(false)

  // activeType is a key like 'Sild' or 'Sild§2'. wizardWorkItems sets id to 'wiz:{key}'.
  const activeItem = items.find(i => i.id === `wiz:${activeType}`) ?? items.find(i => i.too === activeType) ?? null

  /** FDI → owning item id. Used to check if a tooth belongs to another item. */
  const owners = useMemo(() => {
    const m = new Map<number, string>()
    for (const item of items) for (const t of hambadToTeeth(item.hambad)) m.set(t, item.id)
    for (const [fdi, too] of reservedByArch ?? []) m.set(fdi, `arch:${too}`)
    return m
  }, [items, reservedByArch])

  function handleToggle(fdi: number) {
    if (disabled) return
    if (!activeType) {
      setRefusal('Vali kõigepealt, millisele tööle hambaid märgid.')
      return
    }
    const arch = reservedByArch?.get(fdi)
    if (arch && arch !== activeType) {
      setRefusal(`Hammas ${fdi} kuulub juba tööle „${arch}" (terve lõualuu). Muuda lõualuu valikut või eemalda see töö tüüp.`)
      return
    }
    const ownerId = owners.get(fdi)
    if (ownerId && ownerId !== activeItem?.id) {
      const ownerItem = items.find(i => i.id === ownerId)
      setRefusal(`Hammas ${fdi} kuulub juba tööle „${ownerItem?.too ?? ownerId}".`)
      return
    }
    setRefusal(null)
    onToggleTooth(fdi)
  }

  return (
    <div className="space-y-3">
      <div
        className="relative rounded-2xl p-2 pt-1"
      >
        {/* The legend belongs ON the chart, where the colours it explains are.
            Fixed light colours and not tokens on purpose: this sits on the
            blush field, which is the same #FFF5F6 in every theme because the
            picker's SVG paints it — `text-ink` would go light here in
            'cloudy-navy' and vanish. */}
        {legend.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {legend.map(l => (
              <li
                key={l.nimi}
                className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-base text-slate-700 shadow-card"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full ring-1 ring-slate-900/15"
                  style={{ background: l.hex }}
                  aria-hidden="true"
                />
                <span className="font-medium">{l.nimi}</span>
                <span className="text-slate-500">
                  {teethCountLabel(l.count)}
                  {l.isBridge && ' · sild'}
                  {l.fromArch && ' · terve lõualuu'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* 460 is the picker's own viewBox width — beyond it the SVG only grows
            taller without becoming any more readable. The `[&_button]` block
            below is the picker's orientation toggle, sized up to this product's
            floor from the outside; see the file header. */}
        <div
          className={
            'mx-auto w-full ' +
            '[&_button]:min-h-[44px] [&_button]:px-3 [&_button]:text-base ' +
            '[&_button]:text-slate-600 [&_button]:rounded-xl [&_button]:bg-white/80 ' +
            // ONE arbitrary variant carrying the pseudo-class, not
            // `[&_button]:focus-visible:…` — that compiles to
            // `.wrapper:focus-visible button`, which puts the ring on the
            // button whenever the WRAPPER is focused, i.e. never.
            '[&_button]:outline-none [&_button:focus-visible]:ring-2 ' +
            '[&_button:focus-visible]:ring-stage-varvi'
          }
          style={{ maxWidth: 600 }}
        >
          <MultiOdontogramPicker
            items={items}
            activeItemId={activeItem?.id ?? null}
            colorMap={colorMap}
            onToggleTooth={handleToggle}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Refusals are announced, not just drawn: the click that triggered one
          produced no visible change anywhere else on screen. amber-500 rather
          than amber-700 — the 700 is unreadable on the navy card of the
          'cloudy-navy' theme. */}
      <p className="min-h-[1.5rem] text-base font-medium text-amber-500" role="status" aria-live="polite">
        {refusal}
      </p>

      {/* The keyboard path, folded away by default so it stops competing with
          the chart. Never REMOVED: the SVG teeth cannot be reached with a Tab. */}
      <div>
        <button
          type="button"
          onClick={() => setGridOpen(o => !o)}
          aria-expanded={gridOpen}
          className={`flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-base font-medium text-ink-soft hover:bg-bg-card ${FOCUS_RING}`}
        >
          <Keyboard className="h-5 w-5" aria-hidden="true" />
          Vali numbriga
          {gridOpen
            ? <ChevronUp className="h-5 w-5" aria-hidden="true" />
            : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
        </button>

        {gridOpen && (
          <div className="mt-3">
            <ToothNumberGrid
              owners={owners}
              activeType={activeType}
              colorMap={colorMap}
              onToggle={handleToggle}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Keyboard-operable FDI grid ──────────────────────────────────────────────

interface ToothNumberGridProps {
  owners: Map<number, string>
  activeType: string | null
  colorMap: Record<string, string>
  onToggle: (fdi: number) => void
  disabled?: boolean
}

function ToothNumberGrid({ owners, activeType, colorMap, onToggle, disabled }: ToothNumberGridProps) {
  return (
    <div className="space-y-3">
      <p className="text-base text-ink-muted">
        Sama valiku saab teha ka nuppudega — klaviatuuriga liigu Tab-klahviga ja
        vali tühikuga.
      </p>
      <ToothRow
        label="Ülemine lõualuu"
        teeth={FDI_UPPER}
        owners={owners}
        activeType={activeType}
        colorMap={colorMap}
        onToggle={onToggle}
        disabled={disabled}
      />
      <ToothRow
        label="Alumine lõualuu"
        teeth={FDI_LOWER}
        owners={owners}
        activeType={activeType}
        colorMap={colorMap}
        onToggle={onToggle}
        disabled={disabled}
      />
    </div>
  )
}

interface ToothRowProps extends ToothNumberGridProps {
  label: string
  teeth: readonly number[]
}

function ToothRow({ label, teeth, owners, activeType, colorMap, onToggle, disabled }: ToothRowProps) {
  return (
    <div>
      <h4 className="mb-1.5 text-base font-semibold text-ink-soft">{label}</h4>
      {/* Four columns until there is room for eight: at eight the cells fall
          under 44px wide on a narrow window, and a 48px-tall target 30px wide
          is not a 44px target. */}
      <div role="group" aria-label={label} className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {teeth.map(fdi => {
          const owner = owners.get(fdi) ?? null
          const mine = owner != null && owner === activeType
          const theirs = owner != null && owner !== activeType
          const hex = owner ? (colorMap[owner] ?? WIZARD_FALLBACK_HEX) : null

          return (
            <button
              key={fdi}
              type="button"
              aria-pressed={mine}
              // Owned by someone else stays pressable on purpose — pressing it
              // is how the user hears WHY it cannot be taken.
              aria-disabled={theirs || undefined}
              disabled={disabled}
              onClick={() => onToggle(fdi)}
              style={mine && hex ? { borderColor: hex, background: `${hex}1f` } : undefined}
              className={[
                FOCUS_RING,
                'flex min-h-[48px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg',
                'font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                mine
                  ? 'border-2 text-base font-bold text-ink'
                  : theirs
                    ? 'border border-dashed border-ink-faint/60 bg-bg-sidebar text-base text-ink-faint'
                    : 'border border-ink-faint/40 bg-bg-card text-base text-ink-soft hover:text-ink',
              ].join(' ')}
            >
              <span>{fdi}</span>
              {mine && <Check className="h-3.5 w-3.5" style={hex ? { color: hex } : undefined} aria-hidden="true" />}
              {mine && <span className="sr-only">Valitud.</span>}
              {theirs && <span className="sr-only">Kuulub tööle {owner}.</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
