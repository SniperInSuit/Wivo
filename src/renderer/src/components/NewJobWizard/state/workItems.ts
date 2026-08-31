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
import {
  archTeeth, archesOf, teethToHambad, workTypeRules, baseTypeName,
  materialFor, materialsOf, machineFor,
} from '@shared/wizard'

/**
 * ONE work item per selected type, in selection order.
 *
 * The id is `wiz:${nimi}` and NOT crypto.randomUUID(): this runs on every
 * render to feed the odontogram, and a fresh id per render would remount all
 * 32 teeth on every keystroke elsewhere in the wizard. The name is unique
 * within jobTypes, so it is a perfectly good key.
 */
export function wizardWorkItems(state: NewJobState, types: readonly WorkType[]): WorkItem[] {
  return state.jobTypes.flatMap(key => {
    const nimi = baseTypeName(key)
    const rules = workTypeRules(nimi, types)
    // What THIS work is made of. Carried onto the item so the crowns can be
    // Ceramic Crown while the bridges are OnX Tough 2 — both in the price and
    // on the Edit page afterwards.
    const materjal = materialFor(state, key)
    const mat = materjal ? { materjal } : {}

    // Which printer THIS work runs on. Carried onto the item for the same
    // reason as the material: the machine-specific material cost key
    // ("materjal|masin") is read per item, so a job split across two printers
    // only costs correctly if each item says which one it used.
    const masina = machineFor(state, key)
    const mach = masina ? { masina } : {}

    // An arch type on BOTH jaws is two pieces of work, so it is two items — see
    // archesOf() for why that is a pricing rule and not a display one. As one
    // item it was a single row carrying 32 teeth, and a per-job-priced All-on-X
    // came out at the single-arch price whichever answer the user gave.
    if (rules.toothMode === 'arch') {
      if (!state.selectedArch) return [{ id: `wiz:${key}`, too: nimi, hambad: '', ...mat, ...mach }]
      const arches = archesOf(state.selectedArch)
      return arches.map(arch => ({
        id: arches.length > 1 ? `wiz:${key}:${arch}` : `wiz:${key}`,
        too: nimi,
        hambad: teethToHambad(archTeeth(arch)),
        ...mat,
        ...mach,
      }))
    }

    // An appliance owns no teeth at all. Only tooth-mode work reads the
    // per-type selection.
    const hambad =
      rules.toothMode === 'none' ? '' : teethToHambad(state.selectedTeeth[key] ?? [])

    // Which abutment each implant sits on. The type-wide code is the item's
    // `kruvi`; only teeth that were given something DIFFERENT are written into
    // `kruvid`, so the common "all four are MIS C1" case stores one string and
    // the mixed case stores exactly the exceptions.
    const abut = abutmentsFor(state, key, hambad, rules.supportsAbutment)

    return [{
      id: `wiz:${key}`,
      too: nimi,
      hambad,
      ...mat,
      ...mach,
      ...abut,
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
/**
 * The abutment fields for one work item, or nothing at all.
 *
 * Only the teeth whose code differs from the type-wide one are stored per
 * tooth. Writing every tooth would work, but it turns "these are all MIS C1"
 * into four rows that have to be edited four times when the system changes.
 */
function abutmentsFor(
  state: NewJobState, key: string, hambad: string, supported: boolean
): { kruvi?: string; kruvid?: Record<string, string> } {
  if (!supported) return {}
  const all = (state.abutmentByType[key] ?? '').trim()
  const perTooth: Record<string, string> = {}
  for (const raw of hambad.split(',')) {
    const tooth = raw.trim()
    if (!tooth) continue
    const own = (state.abutmentByTooth[tooth] ?? '').trim()
    if (own && own !== all) perTooth[tooth] = own
  }
  return {
    ...(all ? { kruvi: all } : {}),
    ...(Object.keys(perTooth).length > 0 ? { kruvid: perTooth } : {}),
  }
}

export function wizardQuoteInput(state: NewJobState, types: readonly WorkType[]): QuoteInput {
  return {
    // materjal travels with the item: quoteJob prices each one by what it is
    // actually made of, and only falls back to the job-level material below.
    items: wizardWorkItems(state, types).map(i => ({
      too: i.too, hambad: i.hambad, materjal: i.materjal ?? null,
    })),
    materjal: materialsOf(state)[0] ?? null,
    kiirtoo: state.priority === 'kiirtoo',
    mudel: state.priority === 'mudel',
    useDiscount: state.pricing.useDiscount,
  }
}
