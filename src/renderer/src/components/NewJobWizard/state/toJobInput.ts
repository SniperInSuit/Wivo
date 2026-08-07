/**
 * Wizard state → the row that gets inserted.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  1. **Every empty string becomes null.** `valmis_aeg`, `makse_kuupaev` and
 *     `valmis_kuupaev` are date columns and Postgres rejects '' outright — the
 *     insert fails for the whole row, not just the field.
 *
 *  2. **A price is only written when the quote is complete.** `quote.unpriced`
 *     non-empty means part of the job could not be worked out; `production`
 *     still holds what could be, and stamping that partial number on as if it
 *     were the price is exactly what `shared/pricing/quote.ts` exists to stop.
 *
 * The insert is a raw spread (`useJobs.ts:44`), so an unknown key rejects the
 * whole row: never add id / created_at / updated_at / markused / clinic_id.
 */
import type { JobInput, StageKey } from '@/types/job'
import type { Quote } from '@shared/pricing/quote'
import type { WorkType } from '@shared/pricing/workTypes'
import type { NewJobState } from '@shared/wizard'
import {
  composeKirjeldus, hambadToTeeth, jobRules, materialsOf, teethToHambad, todayISO,
} from '@shared/wizard'
import { wizardWorkItems } from './workItems'

export interface ToJobInputContext {
  /** usePipeline().stages[0]?.key ?? 'disain' */
  defaultStatus: StageKey
  /** quoteJob(wizardQuoteInput(state, types), priceBookOf(settings)) */
  quote: Quote
  types: readonly WorkType[]
}

/** '' and whitespace are not values — they are an unanswered question. */
const orNull = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim()
  return t ? t : null
}

export function toJobInput(state: NewJobState, ctx: ToJobInputContext): JobInput {
  const workItems = wizardWorkItems(state, ctx.types)
  const rules = jobRules(state.jobTypes, ctx.types)

  // The denormalised `hambad` is every tooth on the job, deduplicated and in
  // arch order. Kept in step with work_items because the board, the calendar
  // and every legacy read path still use it.
  const allTeeth = [...new Set(workItems.flatMap(i => hambadToTeeth(i.hambad)))]
  const hambad = orNull(teethToHambad(allTeeth))

  // The deadline is one timestamp. 17:00 is the end of a working day and the
  // same default the calendar uses when a user picks a date and no time.
  const valmisAeg = state.deadline
    ? new Date(`${state.deadline}T${state.time ?? '17:00'}`).toISOString()
    : null

  const autoPrice =
    ctx.quote.unpriced.length === 0 && ctx.quote.production !== 0 ? ctx.quote.production : null

  return {
    status: ctx.defaultStatus,
    kuupaev: state.date ?? todayISO(),
    patsient: state.patient?.name.trim() ?? '',
    patient_id: state.patient?.patientId ?? null,
    customer_id: state.customer,
    customer_ref: orNull(state.customerReference),
    too: workItems[0]?.too ?? null,
    // orNull, not `?? null`: a free-text material entered as whitespace would
    // otherwise be stored as '' and quote against nothing.
    // The denormalised job-level material — the FIRST one assigned. Each work
    // item carries its own, which is what the Edit page and the price read.
    materjal: orNull(materialsOf(state)[0] ?? ''),
    masina: orNull(state.machine),
    print_id: orNull(state.printId),
    disain_id: orNull(state.designId),
    // A shade on a nightguard would be noise on the Edit page and in the
    // export — if no selected type supports one, none is stored.
    varv: rules.supportsShade ? orNull(state.defaultShade) : null,
    hambad,
    kirjeldus: composeKirjeldus(state),
    valmis_aeg: valmisAeg,
    // The job has not been made yet. Filled when it reaches the done stage.
    valmis_kuupaev: null,
    kiirtoo: state.priority === 'kiirtoo',
    mudel: state.priority === 'mudel',
    // A job being created is at the lab — there is no other answer, so the
    // wizard does not ask. Handover is set on the job page once it is done.
    delivery_status: 'labor',
    delivered_at: null,
    work_items: workItems,
    revisions: [],
    extras: [],
    hind: state.pricing.overridden ? state.pricing.hind : autoPrice,
    disain_hind: state.pricing.disainHind,
    // Paid status is not asked at creation — nobody has been invoiced yet.
    makstud: false,
    makse_kuupaev: null,
    assigned_to: state.technician,
    designed_by: state.designer,
    // Legacy single-revision columns. Written as null rather than omitted so
    // the insert shape stays the same as the Edit page's.
    muudatused: null,
    rev_hambad: null,
    rev_varv: null,
    uus_valmis: null,
  }
}
