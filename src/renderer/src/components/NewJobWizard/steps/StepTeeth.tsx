/**
 * Step 2 — "Vali hambad".
 *
 * What this step renders is decided entirely by the rules module, never by a
 * work-type name written here:
 *
 *   teethStepMode 'tooth' → odontogram + chip row + bulk controls
 *                           (plus the arch question, if the job ALSO carries an
 *                            arch-level type such as All-on-X)
 *   teethStepMode 'arch'  → the arch question only — no individual teeth exist
 *                           for a full-arch job
 *   teethStepMode 'none'  → the shell skips this step; the branch below only
 *                           catches a restored draft that lands here anyway
 *
 * The step holds exactly one piece of local state: which work type the next
 * click belongs to. Everything else lives in NewJobState so Back never loses it.
 */
import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import type { ArchSelection, ValidationError } from '@shared/wizard'
import { hambadToTeeth, sortTeeth, baseTypeName, makeTypeKey, archTeeth } from '@shared/wizard'
import { useWorkTypes } from '@/stores/useSettings'
import type { WizardStepComponent } from '../types'
import { wizardWorkItems } from '../state/workItems'
import { WizardErrors } from '../ui/WizardErrors'
import { ArchSelector } from '../teeth/ArchSelector'
import { ToothControls, type ToothLegendEntry } from '../teeth/ToothControls'
import { WizardOdontogram } from '../teeth/WizardOdontogram'
import { WorkTypeTabs, type WorkTypeTab } from '../teeth/WorkTypeTabs'
import { AbutmentPicker } from '../teeth/AbutmentPicker'
import { WIZARD_FALLBACK_HEX } from '../wizardTheme'

export const StepTeeth: WizardStepComponent = ({ state, patch, rules, errors, showErrors }) => {
  const { types } = useWorkTypes()

  const items = useMemo(() => wizardWorkItems(state, types), [state, types])

  /**
   * Only tooth-level work reaches the chart.
   *
   * An arch-level type (All-on-X, Proteez) carries the WHOLE arch in its
   * `hambad`, derived from the arch answer. Painting that on the odontogram
   * would colour in all 16 or 32 teeth and — because the wrapper refuses to
   * take a tooth another item owns — leave a crown on the same job with no
   * tooth it could ever be given. The user would sit on a step whose Continue
   * can never go green. The arch answer is already stated by the ArchSelector
   * beside the chart and named in the legend, so nothing is hidden by leaving
   * it off the teeth themselves.
   */
  const toothItems = useMemo(
    () => items.filter(i => rules.perType.find(r => r.too === i.too)?.toothMode === 'tooth'),
    [items, rules]
  )

  const colorMap = useMemo(
    () => Object.fromEntries(types.map(t => [t.nimi, t.hex])),
    [types]
  )
  const rulesByName = useMemo(
    () => new Map(rules.perType.map(r => [r.too, r])),
    [rules]
  )

  // Keys from jobTypes that are tooth-mode (includes duplicates like Sild§2)
  const toothTypeKeys = useMemo(
    () => state.jobTypes.filter(key => {
      const nimi = baseTypeName(key)
      return rulesByName.get(nimi)?.toothMode === 'tooth'
    }),
    [state.jobTypes, rulesByName]
  )
  const toothKey = toothTypeKeys.join('|')
  const [activeType, setActiveType] = useState<string | null>(() => toothTypeKeys[0] ?? null)

  useEffect(() => {
    if (toothTypeKeys.length === 0) {
      setActiveType(null)
      return
    }
    setActiveType(prev => (prev && toothTypeKeys.includes(prev) ? prev : toothTypeKeys[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toothKey])

  // ─── Ownership ─────────────────────────────────────────────────────────────
  // Built from EVERY work item, not just the ones the chart paints. An arch
  // type carries its 16 or 32 teeth in `hambad`, and leaving them out meant a
  // crown could be assigned to a tooth the All-on-X already owned: the same FDI
  // shipped on two work items and was priced twice. The arch teeth are still
  // not PAINTED (see toothItems above) — they are only reserved.
  // Map each tooth to the key (not base name) that owns it
  const owners = useMemo(() => {
    const m = new Map<number, string>()
    for (const key of state.jobTypes) {
      for (const t of (state.selectedTeeth[key] ?? [])) m.set(t, key)
    }
    return m
  }, [state.jobTypes, state.selectedTeeth])

  const blocked = useMemo(() => {
    const s = new Set<number>()
    for (const [fdi, key] of owners) if (key !== activeType) s.add(fdi)
    return s
  }, [owners, activeType])

  /** Teeth the user picked BY HAND, across every tooth-mode type. This and not
   *  `owners.size` is what the action bar counts and what "Tühjenda" clears —
   *  an arch type's 16 or 32 teeth are derived from the arch answer, so
   *  counting them would promise a Tühjenda that cannot remove them. */
  const pickedCount = useMemo(() => {
    const s = new Set<number>()
    for (const key of toothTypeKeys) for (const t of (state.selectedTeeth[key] ?? [])) s.add(t)
    return s.size
  }, [toothTypeKeys, state.selectedTeeth])

  /** Teeth an arch-level type has reserved, and the type that reserved them.
   *  Named separately so the refusal can say "terve lõualuu" rather than
   *  pointing at a tooth the user cannot see on the chart. */
  const archOwners = useMemo(() => {
    const m = new Map<number, string>()
    for (const item of items) {
      if (rulesByName.get(item.too)?.toothMode !== 'arch') continue
      for (const t of hambadToTeeth(item.hambad)) m.set(t, item.too)
    }
    return m
  }, [items, rulesByName])

  const activeTeeth = useMemo(
    () => (activeType ? (state.selectedTeeth[activeType] ?? []) : []),
    [activeType, state.selectedTeeth]
  )

  // ─── Error visibility ──────────────────────────────────────────────────────
  // showErrors only flips after a blocked Continue, which would leave a user who
  // has already picked a broken bridge staring at a dead button. So a type the
  // user has actually touched reports its own problems immediately, and
  // everything else waits for Continue. Warnings are never gated — they are
  // information, not accusations.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set<string>())

  const isVisible = (e: ValidationError): boolean =>
    e.severity === 'warning' || showErrors || (e.workType != null && touched.has(e.workType))

  const visibleErrors = useMemo(
    () => errors.filter(isVisible),
    // isVisible closes over showErrors + touched; both are in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errors, showErrors, touched]
  )

  const archInvalid = visibleErrors.some(e => e.field === 'arch' && e.severity === 'error')

  const errorFor = (nimi: string): string | null =>
    visibleErrors.find(e => e.field === 'teeth' && e.workType === nimi && e.severity === 'error')
      ?.message ?? null

  // ─── Writes ────────────────────────────────────────────────────────────────
  function markTouched(nimi: string) {
    setTouched(prev => (prev.has(nimi) ? prev : new Set([...prev, nimi])))
  }

  function setTeethFor(nimi: string, teeth: number[]) {
    markTouched(nimi)
    patch({ selectedTeeth: { ...state.selectedTeeth, [nimi]: sortTeeth(teeth) } })
  }

  function toggleTooth(fdi: number) {
    if (!activeType) return
    const cur = state.selectedTeeth[activeType] ?? []
    setTeethFor(activeType, cur.includes(fdi) ? cur.filter(t => t !== fdi) : [...cur, fdi])
  }

  function clearAll() {
    patch({ selectedTeeth: {} })
  }

  /**
   * Toggle one tooth on an arch-level type.
   *
   * Seeded from the arch on the first click, because until then the selection
   * is "untouched" and taking a tooth off an untouched jaw has to start from
   * the full jaw — not from an empty list, which would drop 15 teeth to remove
   * one. Refuses anything outside the chosen arch: the arch answer is above it
   * on the same screen and the two must not contradict each other.
   */
  // Which arch type the chart's clicks land on. Only ever matters when a job
  // carries more than one — the usual case has exactly one and needs no tabs.
  const [activeArchType, setActiveArchType] = useState<string | null>(null)
  useEffect(() => {
    if (rules.archTypes.length === 0) { setActiveArchType(null); return }
    if (!activeArchType || !rules.archTypes.includes(activeArchType)) {
      setActiveArchType(rules.archTypes[0])
    }
  }, [rules.archTypes, activeArchType])

  const archTabs: WorkTypeTab[] = rules.archTypes.map(key => ({
    key,
    nimi: baseTypeName(key),
    hex: colorMap[baseTypeName(key)] ?? WIZARD_FALLBACK_HEX,
    count: hambadToTeeth(items.find(i => i.too === key)?.hambad ?? '').length,
    // An arch type is never a bridge — the flag exists for the chip row's
    // connector drawing, which a full jaw has no use for.
    isBridge: false,
  }))

  function toggleArchTooth(key: string, tooth: number) {
    if (!state.selectedArch) return
    const inArch = new Set(archTeeth(state.selectedArch))
    if (!inArch.has(tooth)) return
    const current = state.selectedTeeth[key] ?? archTeeth(state.selectedArch)
    const next = current.includes(tooth)
      ? current.filter(t => t !== tooth)
      : [...current, tooth]
    patch({ selectedTeeth: { ...state.selectedTeeth, [key]: next } })
  }

  function changeArch(arch: ArchSelection) {
    // Just the arch, and deliberately nothing else. There is no auto-fill of
    // selectedTeeth for arch-mode types anywhere any more (it used to live in
    // the wizard's patch(), wrote entries nothing read, and was deleted):
    // wizardWorkItems() derives an arch type's teeth straight from
    // `selectedArch`, and archTeeth() in archRules.ts is the one answer to
    // "which teeth does this arch cover".
    //
    // Any per-tooth narrowing IS dropped, though: a selection made against the
    // upper jaw means nothing once the answer becomes "lower", and carrying it
    // over would silently hand the new arch a hole someone chose for the old
    // one. Changing the arch starts the jaw whole again.
    const cleared = { ...state.selectedTeeth }
    for (const key of rules.archTypes) delete cleared[key]
    patch({ selectedArch: arch, selectedTeeth: cleared })
  }

  // ─── View data ─────────────────────────────────────────────────────────────
  const tabs: WorkTypeTab[] = toothTypeKeys.map(key => {
    const nimi = baseTypeName(key)
    // Count how many of this base type exist for labeling (Sild 1, Sild 2)
    const sameType = toothTypeKeys.filter(k => baseTypeName(k) === nimi)
    const idx = sameType.indexOf(key) + 1
    const label = sameType.length > 1 ? `${nimi} ${idx}` : nimi
    return {
      key,
      nimi: label,
      hex: colorMap[nimi] ?? rulesByName.get(nimi)?.hex ?? WIZARD_FALLBACK_HEX,
      count: (state.selectedTeeth[key] ?? []).length,
      isBridge: rulesByName.get(nimi)?.isBridge ?? false,
      error: errorFor(nimi),
    }
  })

  // One entry PER WORK TYPE, not per work item: an arch type on both jaws is
  // two items and the legend must still name it once, with the teeth added up.
  const legend: ToothLegendEntry[] = useMemo(() => {
    const byName = new Map<string, ToothLegendEntry>()
    for (const item of items) {
      const r = rulesByName.get(item.too)
      const existing = byName.get(item.too)
      const count = hambadToTeeth(item.hambad).length
      if (existing) {
        existing.count += count
        continue
      }
      byName.set(item.too, {
        nimi: item.too,
        hex: colorMap[item.too] ?? r?.hex ?? WIZARD_FALLBACK_HEX,
        count,
        isBridge: item.bridge === true,
        fromArch: r?.toothMode === 'arch',
      })
    }
    return [...byName.values()].filter(l => l.count > 0 || toothTypeKeys.some(k => baseTypeName(k) === l.nimi))
  }, [items, rulesByName, colorMap, toothTypeKeys])

  // ─── 'none' — defensive only ───────────────────────────────────────────────
  if (rules.teethStepMode === 'none') {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-bg-sidebar p-4 text-base text-ink-soft">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
        Valitud tööd ei vaja hammaste märkimist. Võid kohe edasi minna.
      </p>
    )
  }

  // ─── 'arch' — the arch question alone ──────────────────────────────────────
  if (rules.teethStepMode === 'arch') {
    return (
      <div className="space-y-6">
        <p className="max-w-prose text-base text-ink-soft">
          {rules.archTypes.length === 1
            ? `„${rules.archTypes[0]}" katab terve lõualuu, seega üksikuid hambaid märkima ei pea.`
            : 'Valitud tööd katavad terve lõualuu, seega üksikuid hambaid märkima ei pea.'}{' '}
          Vali, millist lõualuud see töö puudutab.
        </p>

        <ArchSelector value={state.selectedArch} onChange={changeArch} invalid={archInvalid} />

        {/* The jaw, once one is chosen. The arch buttons are all-or-nothing and
            an All-on-4 routinely stops short of the last molar — until this was
            here there was no way to say so at all. */}
        {state.selectedArch && (
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-ink-soft">Hambad selles lõualuus</h3>
              <p className="text-base text-ink-muted">
                Kõik on vaikimisi kaasas. Klõpsa hambal, mida see töö{' '}
                <strong>ei</strong> puuduta — näiteks viimane molaar.
              </p>
            </div>

            {rules.archTypes.length > 1 && (
              <WorkTypeTabs
                tabs={archTabs}
                activeType={activeArchType}
                onSelect={setActiveArchType}
              />
            )}

            <WizardOdontogram
              items={items.filter(i => i.too === (activeArchType ?? rules.archTypes[0]))}
              activeType={activeArchType ?? rules.archTypes[0]}
              colorMap={colorMap}
              onToggleTooth={t => toggleArchTooth(activeArchType ?? rules.archTypes[0], t)}
            />
          </div>
        )}

        <WizardErrors errors={visibleErrors} />
      </div>
    )
  }

  // ─── 'tooth' — odontogram ──────────────────────────────────────────────────
  // One column, centred. The chart, the pills that explain its colours and the
  // action bar that operates it are one object and are stacked as one; the
  // two-column split put the buttons a chart's width away from the thing they
  // act on.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(180px,1fr)_minmax(480px,3fr)] gap-6 items-start">
        {/* ── Left: tabs + controls ── */}
        <div className="space-y-4">
          {tabs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-soft">Millisele tööle?</h3>
              <WorkTypeTabs
                tabs={tabs}
                activeType={activeType}
                onSelect={setActiveType}
                onDuplicate={key => {
                  const nimi = baseTypeName(key)
                  const existing = state.jobTypes.filter(k => baseTypeName(k) === nimi)
                  const nextIdx = existing.length + 1
                  const newKey = makeTypeKey(nimi, nextIdx)
                  patch({ jobTypes: [...state.jobTypes, newKey] })
                  setActiveType(newKey)
                }}
                onRemove={key => {
                  const next = state.jobTypes.filter(k => k !== key)
                  const { [key]: _, ...rest } = state.selectedTeeth
                  patch({ jobTypes: next, selectedTeeth: rest })
                  if (activeType === key) setActiveType(next[0] ?? null)
                }}
              />
              <p className="text-xs text-ink-muted">
                Üks hammas kuulub korraga ainult ühele tööle.
              </p>
            </div>
          )}

          <ToothControls
            activeType={activeType}
            activeTeeth={activeTeeth}
            blocked={blocked}
            total={pickedCount}
            onSetActiveTeeth={teeth => activeType && setTeethFor(activeType, teeth)}
            onClearAll={clearAll}
          />

          {/* Which abutment each implant sits on. Here rather than on a later
              step because the answer belongs to the teeth that were just
              picked, and the wizard could not record it at all before. */}
          {rules.abutmentTypes.length > 0 && (
            <AbutmentPicker
              types={rules.abutmentTypes.map(too => ({
                too,
                hex: colorMap[baseTypeName(too)] ?? WIZARD_FALLBACK_HEX,
                teeth: state.selectedTeeth[too] ?? [],
              }))}
              byType={state.abutmentByType}
              byTooth={state.abutmentByTooth}
              onChangeType={(too, code) => patch({
                abutmentByType: { ...state.abutmentByType, [too]: code },
              })}
              onChangeTooth={(tooth, code) => patch({
                abutmentByTooth: { ...state.abutmentByTooth, [tooth]: code },
              })}
            />
          )}

          {/* Arch selector if needed */}
          {rules.archTypes.length > 0 && (
            <div className="space-y-2 border-t border-ink-faint/30 pt-3">
              <h3 className="text-sm font-semibold text-ink-soft">
                Lõualuu — {rules.archTypes.join(', ')}
              </h3>
              <ArchSelector value={state.selectedArch} onChange={changeArch} invalid={archInvalid} />
            </div>
          )}

          <WizardErrors errors={visibleErrors} />
        </div>

        {/* ── Right: odontogram ── */}
        <div>
          <WizardOdontogram
            items={toothItems}
            activeType={activeType}
            colorMap={colorMap}
            onToggleTooth={toggleTooth}
            reservedByArch={archOwners}
          />
        </div>
      </div>
    </div>
  )
}
