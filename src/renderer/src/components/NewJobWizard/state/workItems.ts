/**
 * Wizard state → the shapes the rest of the app already understands: work items
 * for the odontogram, and the one QuoteInput everything prices from.
 *
 * This file is the only bridge between `NewJobState` (one entry per work TYPE)
 * and `WorkItem[]` (one row per piece of work). It is deliberately not unit
 * tested — it imports renderer types — so it holds no rules of its own: every
 * decision it makes comes from `@shared/wizard`.
 */
import type { WorkItem } from '@/types/job'
import type { QuoteInput } from '@shared/pricing/quote'
import type { WorkType } from '@shared/pricing/workTypes'
import type { NewJobState } from '@shared/wizard'
import { archTeeth, archesOf, teethToHambad, workTypeRules } from '@shared/wizard'

/**
 * ONE work item per selected type, in selection order.
 *
 * The id is `wiz:${nimi}` and NOT crypto.randomUUID(): this runs on every
 * render to feed the odontogram, and a fresh id per render would remount all
 * 32 teeth on every keystroke elsewhere in the wizard. The name is unique
 * within jobTypes, so it is a perfectly good key.
 */
export function wizardWorkItems(state: NewJobState, types: readonly WorkType[]): WorkItem[] {
  return state.jobTypes.flatMap(nimi => {
    const rules = workTypeRules(nimi, types)

    // An arch type on BOTH jaws is two pieces of work, so it is two items — see
    // archesOf() for why that is a pricing rule and not a display one. As one
    // item it was a single row carrying 32 teeth, and a per-job-priced All-on-X
    // came out at the single-arch price whichever answer the user gave.
    if (rules.toothMode === 'arch') {
      if (!state.selectedArch) return [{ id: `wiz:${nimi}`, too: nimi, hambad: '' }]
      const arches = archesOf(state.selectedArch)
      return arches.map(arch => ({
        // The id stays stable across renders — see above — and stays unique by
        // carrying the arch.
        id: arches.length > 1 ? `wiz:${nimi}:${arch}` : `wiz:${nimi}`,
        too: nimi,
        hambad: teethToHambad(archTeeth(arch)),
      }))
    }

    // An appliance owns no teeth at all. Only tooth-mode work reads the
    // per-type selection.
    const hambad =
      rules.toothMode === 'none' ? '' : teethToHambad(state.selectedTeeth[nimi] ?? [])

    return [{
      id: `wiz:${nimi}`,
      // Verbatim, so colorMap[item.too] and resolveWorkType() both hit exactly.
      too: nimi,
      hambad,
      ...(rules.isBridge ? { bridge: true } : {}),
    }]
  })
}

/**
 * The single QuoteInput builder. Step 6's price summary and the save path MUST
 * both go through this — the number shown and the number written down cannot be
 * allowed to disagree, which is precisely the bug `shared/pricing` exists to
 * prevent.
 *
 * Omits disainHind and extras on purpose, exactly like JobDetailPanel's
 * auto-price: the design fee is added on top and is not a production cost, and
 * the wizard never offers extras.
 */
export function wizardQuoteInput(state: NewJobState, types: readonly WorkType[]): QuoteInput {
  return {
    items: wizardWorkItems(state, types).map(i => ({ too: i.too, hambad: i.hambad })),
    // Only materials[0] can be priced: quoteJob looks materialPrices up by an
    // exact single string. The material step says so in plain Estonian.
    materjal: state.materials[0] ?? null,
    kiirtoo: state.priority === 'kiirtoo',
    useDiscount: state.pricing.useDiscount,
  }
}
