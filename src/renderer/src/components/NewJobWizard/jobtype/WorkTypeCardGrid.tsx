/**
 * The work-type card grid for wizard step 1.
 *
 * The list is ALWAYS the live one from Seaded → Valikud (passed in as `types`),
 * never a literal array: a lab renames "Kaitse / splint" to "Öine kaitse" and
 * this grid must follow without a code change. That also means the icon lookup
 * below can only ever be a hint — it inspects the type's own identity tokens
 * (nimi + match synonyms, the same signal workTypeRules() classifies on) and
 * falls back to a neutral shape for anything a lab invents. An icon is
 * decoration; getting it "wrong" costs nothing, so the matcher stays permissive.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WorkType } from '@shared/pricing/workTypes'
import { workTypeImage, slugifyWorkType } from '@/lib/workTypeImages'
import { SelectableCard } from '../ui/SelectableCard'
import { WIZARD_BTN } from '../wizardTheme'
import { ToothGlyph, toothGlyphFor } from './ToothGlyph'
import { t } from '@/lib/i18n'

/** How many cards show before "Näita rohkem". Two full rows on a wide screen. */
const COLLAPSED_COUNT = 8

export interface WorkTypeCardGridProps {
  /** useWorkTypes().types. Passed in rather than read here so the grid stays a
   *  pure renderer and step 1 can decide when the search box is worth showing. */
  types: readonly WorkType[]
  /** NewJobState.jobTypes — WorkType.nimi VERBATIM, matching is exact-name. */
  selected: readonly string[]
  onToggle: (nimi: string) => void
  /** Search term from step 1. Non-empty search always shows every match. */
  search?: string
  /** false → render the whole list, never collapse. */
  collapsible?: boolean
}

/** Identity tokens of a type: its own name plus the synonyms Seaded stores. */
const identityTokens = (type: WorkType): string[] =>
  [type.nimi.toLowerCase(), ...(type.match ?? []).map(m => m.toLowerCase())]

/**
 * Diacritic-blind matching, so "taidis" finds "Täidis" and "kaitse splint"
 * finds "Kaitse / splint". slugifyWorkType already strips accents and collapses
 * punctuation to dashes — reusing it keeps search and image lookup in agreement.
 */
function matchesSearch(type: WorkType, term: string): boolean {
  const q = slugifyWorkType(term)
  if (!q) return true
  const haystack = [slugifyWorkType(type.nimi), ...identityTokens(type).map(slugifyWorkType)]
  return haystack.some(h => h.includes(q))
}

/**
 * Exported beyond the contract (which lists only the component) because step 1
 * owns the search box and has to announce "N vastet" — and a second filter
 * implementation there would drift from this one the first time the matching
 * rule changes.
 */
export const filterWorkTypes = (types: readonly WorkType[], search: string): WorkType[] =>
  types.filter(type => matchesSearch(type, search))

/** Price line under the label, in the same shape as the Edit page's tooltip. */
function priceLabel(type: WorkType): string | undefined {
  if (type.hind == null) return undefined
  return `${type.hind.toFixed(2)} € ${type.hinnaTyyp === 'hammas' ? t('wizard.tooth') : t('wizard.job')}`
}

export function WorkTypeCardGrid({
  types, selected, onToggle, search = '', collapsible = true,
}: WorkTypeCardGridProps) {
  const [expanded, setExpanded] = useState(false)
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => filterWorkTypes(types, search), [types, search])

  const searching = slugifyWorkType(search).length > 0
  const collapsed = collapsible && !expanded && !searching && filtered.length > COLLAPSED_COUNT

  // A card the user has already chosen must never hide behind "Näita rohkem" —
  // a selection you cannot see is a selection you cannot undo. Keep the first
  // eight in list order, then append anything selected that fell below the cut.
  const visible = useMemo(() => {
    if (!collapsed) return filtered
    const head = filtered.slice(0, COLLAPSED_COUNT)
    const strays = filtered.slice(COLLAPSED_COUNT).filter(type => selectedSet.has(type.nimi))
    return [...head, ...strays]
  }, [collapsed, filtered, selectedSet])

  const hiddenCount = filtered.length - visible.length

  if (filtered.length === 0) {
    return (
      <p className="py-8 text-center text-base text-ink-muted">
        {t('wizard.noWorkTypesMatchYourSearch')}
      </p>
    )
  }

  return (
    <div>
      <div
        role="group"
        aria-label={t('wizard.workTypes')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {visible.map(type => (
          <SelectableCard
            key={type.nimi}
            selected={selectedSet.has(type.nimi)}
            onToggle={() => onToggle(type.nimi)}
            label={type.nimi}
            sublabel={priceLabel(type)}
            hex={type.hex}
            imageSrc={workTypeImage(type.nimi, type.pilt)}
            icon={
              <ToothGlyph
                name={toothGlyphFor(identityTokens(type))}
                size={38}
                style={{ color: type.hex }}
              />
            }
            size="tile"
            multi
          />
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`${WIZARD_BTN} mt-4 flex items-center gap-2 border border-ink-faint/40 text-ink-soft hover:text-ink`}
        >
          <ChevronDown className="h-5 w-5" aria-hidden="true" />
          {t('wizard.showMore')} ({hiddenCount})
        </button>
      )}

      {expanded && collapsible && !searching && filtered.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={`${WIZARD_BTN} mt-4 flex items-center gap-2 border border-ink-faint/40 text-ink-soft hover:text-ink`}
        >
          <ChevronUp className="h-5 w-5" aria-hidden="true" />
          {t('wizard.showLess')}
        </button>
      )}
    </div>
  )
}
