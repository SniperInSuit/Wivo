/**
 * What a worker earned, from the work that is already in the system.
 *
 * Pure functions over jobs + hours + rules. No fetching, no React — the payouts
 * screen previews with them, and the payout writer freezes their output into
 * `worker_payout_lines`. One implementation, so the preview and the payslip can
 * never disagree.
 *
 * PAY MODEL
 *   A worker has a LIST of rules, because a lab does not pay one way: an
 *   administrator is hourly, a technician may be per tooth on crowns and a flat
 *   fee on full arches, and design is compensated on top of whichever applies.
 *
 *   Per job, exactly ONE production rule applies — per tooth, flat, or a
 *   percentage of the job's price. A rule naming the job's work type beats a
 *   catch-all rule; `priority` breaks ties after that.
 *
 *   The design bonus is not a production rule. It is added when the worker is
 *   the job's designer, on top of whatever production rule matched.
 *
 *   Hourly and monthly are period-level: they have nothing to do with any
 *   single job, so they are computed from logged hours and from the period.
 */
import type { Job, Revision, WorkItem } from '../types/job'
import { jobWorkItems, jobPeriodDate, workItemDesigner } from '../types/job'
import { resolveWorkType, type WorkType } from '../config/workTypes'

// How the money is calculated. Deliberately ONLY billing methods: "design" used
// to sit in this list, which is a category error — design is a kind of work, not
// a way of paying for it, and having it here meant design could only ever be a
// flat fee. Scope moved to `applies_to`.
//
export type RateKind = 'tund' | 'hammas' | 'too' | 'protsent' | 'kuu'

/**
 * What the rule pays FOR. Not how it is calculated — that is `kind`, and not
 * whether it stacks — that is `additive`.
 *
 * Three questions, three fields. An earlier attempt made "extra service" a
 * fourth scope, which forced a choice nobody should have to make: gum DESIGN is
 * design, and a rule that had to declare itself "extra" instead of "design"
 * left the lab with nowhere to put the ordinary design rule. See sql/040.
 */
export type RateScope = 'too' | 'disain' | 'muudatus' | 'mudel'

export const RATE_SCOPE_LABEL: Record<RateScope, string> = {
  too:      'Teostatud töö',
  disain:   'Disain',
  muudatus: 'Muudatus (ümbertegemine)',
  mudel:    'Mudel',
}

export const RATE_KIND_LABEL: Record<RateKind, string> = {
  tund:     'Tunnitasu',
  hammas:   'Hamba tasu',
  too:      'Töö tasu (fikseeritud)',
  protsent: '% töö hinnast',
  kuu:      'Kuutasu',
}

export const RATE_KIND_HINT: Record<RateKind, string> = {
  tund:     'Korrutatakse tundidega. Saab lasta ka automaatselt tööpäevade järgi täita.',
  hammas:   'Korrutatakse töö hammaste arvuga.',
  too:      'Sama summa iga töö eest, sõltumata hammaste arvust.',
  protsent: 'Protsent töö hinnast (koos disaini hinnaga).',
  kuu:      'Fikseeritud summa iga arvestusperioodi kohta.',
}

export const RATE_KIND_SUFFIX: Record<RateKind, string> = {
  tund: '€/h', hammas: '€/hammas', too: '€/töö', protsent: '%', kuu: '€/kuu',
}

/**
 * Rules that price a piece of work, of which exactly one wins per work item.
 *
 * Only ONE wins WITHIN a scope. Scopes never compete with each other, which is
 * how an extra service is paid alongside the work rather than instead of it.
 */
const PRODUCTION_KINDS: RateKind[] = ['hammas', 'too', 'protsent']

export interface WorkerRate {
  id: string
  clinic_id: string
  profile_id: string
  kind: RateKind
  applies_to: RateScope
  amount: number
  work_type: string | null
  priority: number
  /**
   * Paid ON TOP of the scope's production rule instead of competing with it.
   *
   * Exactly one non-additive rule wins per work item, which is right for "how
   * is this work paid" and wrong for "and there is also gum design on it". An
   * additive rule never enters that contest, so a job can carry the arch rate,
   * the design rate and a gum-design rate at once — three lines, three answers.
   */
  additive: boolean
  /** What to call it on the payslip: "Igeme disain". Null on older rules. */
  label: string | null
  pay_revisions: boolean
  // Hourly rules only: fill the period from the working calendar instead of
  // making someone type an identical row every day.
  auto_hours: boolean
  hours_per_day: number | null
  work_days: string        // '12345' = Mon–Fri, 1 = Monday … 7 = Sunday
  active_from: string | null
  active_to: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type WorkerRateInput = Omit<WorkerRate, 'id' | 'clinic_id' | 'created_at' | 'updated_at'>

export interface WorkHours {
  id: string
  clinic_id: string
  profile_id: string
  work_date: string
  hours: number
  note: string | null
  recorded_by: string | null
  created_at: string
}

export type WorkHoursInput = Omit<WorkHours, 'id' | 'clinic_id' | 'created_at'>

export interface EarningLine {
  key: string
  job_id: string | null
  revision_id: string | null
  work_hours_id: string | null
  kind: RateKind
  description: string
  qty: number
  rate: number
  amount: number
  earned_on: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Every yyyy-MM-dd from start to end, inclusive. */
function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  // Guard against a reversed or absurd range producing an endless list.
  let guard = 0
  while (d <= last && guard++ < 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const toothCount = (h: string | null | undefined) =>
  (h ?? '').split(',').filter(t => t.trim()).length

function activeOn(rate: WorkerRate, isoDate: string): boolean {
  if (rate.active_from && isoDate < rate.active_from) return false
  if (rate.active_to && isoDate > rate.active_to) return false
  return true
}

/** One piece of work to pay for: a type and the teeth it covers. */
export interface PayItem { too: string; hambad: string }

/** The items on a job. A job with no `work_items` yields exactly one, built
 *  from its legacy `too`/`hambad`, so old rows are paid exactly as before. */
const payItemsOf = (job: Job): PayItem[] =>
  jobWorkItems(job).map(i => ({ too: i.too, hambad: i.hambad }))

/**
 * The items of a job THIS person designed.
 *
 * Design used to be all-or-nothing: `job.designed_by` was one name, so a case
 * holding crowns and laminates designed by two different people paid one of
 * them for the lot and the other nothing. An item without its own designer
 * belongs to the job's, which is what every work item written before the field
 * existed meant — so a single-designer job returns all of them, exactly as it
 * did before.
 */
const designPayItemsOf = (job: Job, profileId: string): PayItem[] =>
  jobWorkItems(job)
    .filter(i => workItemDesigner(i, job.designed_by) === profileId)
    .map(i => ({ too: i.too, hambad: i.hambad }))

/**
 * The share of a job's price that belongs to a subset of its items.
 *
 * Only bites once two people split one case: a percentage rule is priced off
 * the JOB's price, and handing each designer the whole price would pay the
 * design out twice over. Split by teeth, by item count when nothing has teeth.
 * A subset covering everything gets 1, so nothing about a single-designer job
 * changes.
 */
function priceShare(all: PayItem[], subset: PayItem[]): number {
  if (subset.length >= all.length) return 1
  if (subset.length === 0) return 0
  const total = all.reduce((s, i) => s + toothCount(i.hambad), 0)
  if (total === 0) return subset.length / all.length
  return subset.reduce((s, i) => s + toothCount(i.hambad), 0) / total
}

/** The items on a revision, falling back to the job's own when it names none. */
function revisionPayItems(rev: Revision, job: Job): PayItem[] {
  const items = rev.work_items
  if (Array.isArray(items) && items.length > 0) {
    return items.map((i: WorkItem) => ({ too: i.too, hambad: i.hambad }))
  }
  return [{ too: job.too ?? '', hambad: rev.hambad ?? job.hambad ?? '' }]
}

/**
 * The items of a revision this person designed. Same fallback chain as the job:
 * the item's own designer, else the revision's, else the job's.
 */
function revisionDesignItems(rev: Revision, job: Job, profileId: string): PayItem[] {
  const fallback = rev.designed_by ?? job.designed_by ?? null
  const items = rev.work_items
  if (Array.isArray(items) && items.length > 0) {
    return items
      .filter((i: WorkItem) => workItemDesigner(i, fallback) === profileId)
      .map((i: WorkItem) => ({ too: i.too, hambad: i.hambad }))
  }
  return fallback === profileId ? revisionPayItems(rev, job) : []
}

/**
 * The work types a rule is limited to. Empty means it covers every type.
 *
 * Several names live in the one `work_type` text column separated by '|' — the
 * same separator the material cost keys already use, and one no work type name
 * has ever contained. No column was added because none was needed: a rule
 * written before this holds a single name, which splits to itself, so every
 * existing rule keeps behaving exactly as it did with nothing to migrate.
 *
 * One rule over several types rather than one rule each: "igeme tasu 9 € on
 * these four types" is ONE decision, and expressing it as four rows means four
 * places to edit when the price changes and four chances to miss one.
 */
export function rateWorkTypes(rate: Pick<WorkerRate, 'work_type'>): string[] {
  return (rate.work_type ?? '').split('|').map(s => s.trim()).filter(Boolean)
}

/**
 * The rule that applies to ONE work type.
 *
 * Specific beats general: a rule naming this work type outranks one that names
 * none, whatever the priorities are. Without that, adding a catch-all
 * "15 €/tooth" rule would silently start competing with the deliberate
 * "Allon4 = 200 € flat" rule the owner set up first.
 *
 * Matching per TYPE and not per job is the whole point. This used to read the
 * job's denormalised `too`, which is only ever the FIRST work item — so on a
 * case holding crowns and a bridge, a rule scoped to "Sild" was never even
 * considered, and the bridge was paid at the crown rate or not at all.
 */
export function rateCovers(
  rate: WorkerRate, too: string | null | undefined, types: WorkType[]
): boolean {
  const wanted = rateWorkTypes(rate)
  if (wanted.length === 0) return true
  const resolved = resolveWorkType(too, types).nimi.toLowerCase()
  const raw = (too ?? '').toLowerCase()
  return wanted.some(w => {
    const lw = w.toLowerCase()
    return lw === resolved || raw.includes(lw)
  })
}

export function pickRateFor(
  rates: WorkerRate[], too: string | null | undefined, isoDate: string,
  types: WorkType[], scope: RateScope, kinds: RateKind[] = PRODUCTION_KINDS
): WorkerRate | null {
  const matches = rates.filter(r => {
    if (r.additive) return false        // additive rules never enter the contest
    if (!kinds.includes(r.kind)) return false
    if ((r.applies_to ?? 'too') !== scope) return false
    if (!activeOn(r, isoDate)) return false
    return rateCovers(r, too, types)
  })
  if (matches.length === 0) return null

  return matches.sort((a, b) => {
    // A rule that names ANY type is specific, however many it names — the
    // question is whether it was aimed at this work or is a catch-all.
    const spec = (rateWorkTypes(a).length > 0 ? 1 : 0) - (rateWorkTypes(b).length > 0 ? 1 : 0)
    if (spec !== 0) return -spec
    return b.priority - a.priority
  })[0]
}

/** Distinct work types, in order, for a line's description. */
const itemsLabel = (items: PayItem[]): string => {
  const names = [...new Set(items.map(i => i.too?.trim()).filter(Boolean))]
  return names.length > 0 ? names.join(' + ') : 'Töö'
}

export interface ProductionPay {
  amount: number
  qty: number
  rate: number
  kind: RateKind
  /** Work types on this job that no rule covered. Drives the diagnostics. */
  unmatched: string[]
}

/**
 * What a set of work items earns under this worker's rules.
 *
 * Every item is matched and paid SEPARATELY, then summed. Before this, one rule
 * was chosen for the whole job and applied to all of its teeth — so ten crowns
 * plus a four-unit bridge were paid as fourteen crowns, and a lab that priced
 * the two differently could not express that at all.
 *
 * Items that match the SAME rule are pooled first, because a flat "200 € per
 * job" rule must stay one payment however many items it happens to cover.
 */
/**
 * The extras: every additive rule that touches this work, each its own line.
 *
 * A line each rather than one pooled "extras" total, because the whole point is
 * that the lab can tell them apart — "Igeme disain 27 €" answers a question
 * that "Lisatasu 41 €" does not. The rule's `label` is what names it.
 *
 * A flat additive rule pays once per COVERED ITEM, so an upper and a lower
 * All-on-X pay it twice. A percentage pays once against the job's price, since
 * the price belongs to the job and not to any one item.
 */
function payAdditive(
  mine: WorkerRate[], items: PayItem[], isoDate: string, types: WorkType[],
  scope: RateScope, price: number, rush = 1
): { rule: WorkerRate; amount: number; qty: number }[] {
  const out: { rule: WorkerRate; amount: number; qty: number }[] = []
  for (const r of mine) {
    if (!r.additive) continue
    if (!PRODUCTION_KINDS.includes(r.kind)) continue
    if ((r.applies_to ?? 'too') !== scope) continue
    if (!activeOn(r, isoDate)) continue

    const covered = items.filter(i => rateCovers(r, i.too, types))
    if (covered.length === 0) continue
    const teeth = covered.reduce((s, i) => s + toothCount(i.hambad), 0)

    let amount = 0
    let qty = 1
    switch (r.kind) {
      case 'hammas':   amount = teeth * r.amount * rush; qty = teeth; break
      case 'too':      amount = r.amount * covered.length * rush; qty = covered.length; break
      // NOT uplifted. See payProduction — the price already carries the rush.
      case 'protsent': amount = price * r.amount / 100; break
    }
    if (amount <= 0) continue
    out.push({ rule: r, amount: round2(amount), qty })
  }
  return out
}

/** What an additive line is called. Falls back for rules written before labels. */
const additiveLabel = (r: WorkerRate): string =>
  r.label?.trim() || (r.applies_to === 'disain' ? 'Lisatasu disaini eest' : 'Lisatasu')

/**
 * @param rush What a piece rate is multiplied by on a rush job. Applies to the
 *   FIXED methods only — per tooth and per job. A percentage rule is left
 *   alone deliberately: `quoteJob` already multiplies the job's price by the
 *   clinic's rush multiplier before it is stored, so a percentage of that price
 *   has the uplift in it and scaling it again would pay the rush out twice.
 */
function payProduction(
  mine: WorkerRate[], items: PayItem[], isoDate: string, types: WorkType[],
  scope: RateScope, price: number, rush = 1
): ProductionPay | null {
  const groups = new Map<string, { rate: WorkerRate; teeth: number }>()
  const unmatched: string[] = []
  let matchedTeeth = 0

  for (const item of items) {
    const rate = pickRateFor(mine, item.too, isoDate, types, scope)
    if (!rate) {
      unmatched.push(item.too?.trim() || 'Määramata töö')
      continue
    }
    const teeth = toothCount(item.hambad)
    const g = groups.get(rate.id) ?? { rate, teeth: 0 }
    g.teeth += teeth
    groups.set(rate.id, g)
    matchedTeeth += teeth
  }
  if (groups.size === 0) return null

  let amount = 0
  for (const g of groups.values()) {
    switch (g.rate.kind) {
      case 'hammas':
        amount += g.teeth * g.rate.amount * rush
        break
      case 'too':
        amount += g.rate.amount * rush
        break
      case 'protsent': {
        // A percentage is of the JOB's price, which belongs to the job and not
        // to any one item. When two different percentage rules cover different
        // items, the price is split by their share of the teeth — charging each
        // of them the full price would pay the job out twice over.
        const share = matchedTeeth > 0 ? g.teeth / matchedTeeth : 1 / groups.size
        amount += price * g.rate.amount / 100 * share
        break
      }
    }
  }

  // One line per job, so the payout keys and the freeze that depends on them
  // are untouched. qty and rate describe it honestly: a job paid entirely per
  // tooth shows its real tooth count and its real rate; a job where several
  // rules met shows the total and the effective rate behind it.
  const groupList = [...groups.values()]
  const allPerTooth = groupList.every(g => g.rate.kind === 'hammas')
  const kind = groupList[0].rate.kind
  // Only a wholly per-tooth job may report a tooth count: the same qty column
  // also holds hours and job counts, and a mixed job's "14" would be summed
  // into a total of nothing.
  const qty = allPerTooth ? matchedTeeth : 1
  // The uplifted rate, not the one in the rule: a payslip line whose qty × rate
  // does not reach its own amount is a line nobody can check.
  const rate = groupList.length === 1 && rush === 1
    ? groupList[0].rate.amount
    : (qty > 0 ? round2(amount / qty) : round2(amount))

  return { amount: round2(amount), qty, rate, kind, unmatched }
}

/**
 * The date a job counts as earned on — the same date every period filter in the
 * app uses, so the Ülevaade, Rahandus and this page can never disagree about
 * which month a job belongs to. See `jobPeriodDate` in types/job.ts.
 */
const jobEarnedOn = jobPeriodDate

// Same rule as jobs: when it was FINISHED first, the deadline only as a
// fallback. A revision due last month but redone this month has to land in the
// month the work actually happened.
const revisionEarnedOn = (rev: Revision): string =>
  (rev.valmis_kuupaev ?? rev.deadline ?? rev.ts ?? '').slice(0, 10)

export interface EarningsContext {
  profileId: string
  rates: WorkerRate[]
  jobs: Job[]
  hours: WorkHours[]
  types: WorkType[]
  periodStart: string   // inclusive, yyyy-MM-dd
  periodEnd: string     // inclusive
  doneStageKey: string
  /** Job/revision/hours keys already frozen into an earlier payout. */
  alreadyPaid?: Set<string>
  /** Count part-periods of a monthly salary — off by default, see below. */
  includeMonthly?: boolean
  /**
   * What this person's piece rates are multiplied by on a RUSH job. 1 = the
   * uplift is not shared with them, which is what every payout before this
   * existed meant, so leaving it out changes nothing.
   *
   * Per worker and not per clinic on purpose: `settings.kiirtooKordaja` is the
   * price the CUSTOMER pays, and how much of that reaches the bench is a
   * separate agreement with each person. One number for both would have meant
   * raising the customer's rush price quietly raised everybody's pay.
   */
  rushMultiplier?: number
}

/**
 * Everything this worker earned in the period.
 *
 * Only FINISHED work counts. Paying for a job still on the bench would mean
 * clawing it back if it is scrapped, and this system has no negative lines by
 * design.
 */
export function calculateEarnings(ctx: EarningsContext): EarningLine[] {
  const {
    profileId, rates, jobs, hours, types, periodStart, periodEnd,
    doneStageKey, alreadyPaid = new Set(), includeMonthly = true,
    rushMultiplier = 1,
  } = ctx

  const mine = rates.filter(r => r.profile_id === profileId)
  const inPeriod = (d: string) => !!d && d >= periodStart && d <= periodEnd
  const lines: EarningLine[] = []

  // ── Production: per job ───────────────────────────────────────────────────
  for (const job of jobs) {
    const isTech = job.assigned_to === profileId
    const items = payItemsOf(job)
    // Only the parts THIS person designed. A job whose items name no designer
    // of their own yields all of them for whoever `designed_by` names, so the
    // ordinary one-designer case is the same list it always was.
    const designItems = designPayItemsOf(job, profileId)
    const isDesigner = designItems.length > 0
    // A remake may name someone who touched no other part of the case. Skipping
    // the job outright would have hidden their rework entirely — the guard has
    // to ask about the revisions too, not only the job's own two names.
    const onARevision = (job.revisions ?? []).some(r =>
      (r.assigned_to ?? job.assigned_to) === profileId
      || revisionDesignItems(r, job, profileId).length > 0
    )
    if (!isTech && !isDesigner && !onARevision) continue

    const earnedOn = jobEarnedOn(job)
    const jobDone = job.status === doneStageKey
    const label = itemsLabel(items)
    const designLabel = itemsLabel(designItems)
    // The slice of the job's price the design side is priced off. 1 whenever one
    // person designed the whole thing.
    const designShare = priceShare(items, designItems)
    const countable = jobDone && inPeriod(earnedOn)
    // A rush job's piece rates, uplifted by this person's own share of a rush.
    // 1 unless a multiplier was set for them, so nothing moves by default.
    const rush = job.kiirtoo ? rushMultiplier : 1
    // Said out loud on the line: "45.00 €" against a 15 €/tooth rule and three
    // teeth is a number the person has to be able to check for themselves.
    const rushNote = rush !== 1 ? ` · kiirtöö ×${rush}` : ''

    if (isTech && countable && !alreadyPaid.has(`job:${job.id}`)) {
      const price = Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
      const pay = payProduction(mine, items, earnedOn, types, 'too', price, rush)
      if (pay && pay.amount > 0) {
        lines.push({
          key: `job:${job.id}`,
          job_id: job.id, revision_id: null, work_hours_id: null,
          kind: pay.kind,
          description: `${label} · ${job.patsient}${rushNote}`,
          qty: pay.qty, rate: pay.rate, amount: pay.amount, earned_on: earnedOn,
        })
      }
    }

    // Design — its own scope, priced by whichever method the rule uses. A lab
    // buys design per tooth as often as per job, which the old flat-only design
    // rule could not express. Added on top of the production line, and payable
    // to someone who did no other part of the job.
    if (isDesigner && countable && !alreadyPaid.has(`design:${job.id}`)) {
      const price = (Number(job.disain_hind ?? 0) || Number(job.hind ?? 0)) * designShare
      const pay = payProduction(mine, designItems, earnedOn, types, 'disain', price, rush)
      if (pay && pay.amount > 0) {
        lines.push({
          key: `design:${job.id}`,
          job_id: job.id, revision_id: null, work_hours_id: null,
          kind: pay.kind,
          description: `Disain: ${designLabel} · ${job.patsient}${rushNote}`,
          qty: pay.qty, rate: pay.rate, amount: pay.amount, earned_on: earnedOn,
        })
      }
    }

    // The model. `settings.mudeliHind` puts one on the customer's bill and
    // stopped there, but printing and finishing a model is bench work and there
    // was nowhere to say what it pays. Its own scope, so it lands ON TOP of the
    // production rule rather than competing with it, and a flat rule pays once
    // per job however many work items the case holds. Paid to the technician —
    // the model is made, not designed.
    if (isTech && countable && job.mudel && !alreadyPaid.has(`mudel:${job.id}`)) {
      const price = Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
      const pay = payProduction(mine, items, earnedOn, types, 'mudel', price, rush)
      if (pay && pay.amount > 0) {
        lines.push({
          key: `mudel:${job.id}`,
          job_id: job.id, revision_id: null, work_hours_id: null,
          kind: pay.kind,
          description: `Mudel: ${label} · ${job.patsient}${rushNote}`,
          qty: pay.qty, rate: pay.rate, amount: pay.amount, earned_on: earnedOn,
        })
      }
    }

    // Extras — gum design and anything else done on top. Each additive rule
    // gets its own named line, under the scope it actually belongs to: a gum
    // DESIGN rule is scoped to design and paid to the designer, alongside that
    // person's ordinary design rule rather than instead of it.
    if (countable) {
      for (const scope of ['too', 'disain'] as const) {
        if (scope === 'too' ? !isTech : !isDesigner) continue
        // The design scope sees only this designer's own items, for the same
        // reason the design rule above does: the gum design on the laminates is
        // the other designer's line, not this one's.
        const scopeItems = scope === 'disain' ? designItems : items
        const scopeLabel = scope === 'disain' ? designLabel : label
        const price = scope === 'disain'
          ? (Number(job.disain_hind ?? 0) || Number(job.hind ?? 0)) * designShare
          : Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
        for (const extra of payAdditive(mine, scopeItems, earnedOn, types, scope, price, rush)) {
          // Keyed by RULE, so two extras on one job stay two payable lines and
          // freezing one never suppresses the other.
          const key = `extra:${extra.rule.id}:${job.id}`
          if (alreadyPaid.has(key)) continue
          lines.push({
            key,
            job_id: job.id, revision_id: null, work_hours_id: null,
            kind: extra.rule.kind,
            description: `${additiveLabel(extra.rule)}: ${scopeLabel} · ${job.patsient}${rushNote}`,
            qty: extra.qty, rate: extra.rule.amount, amount: extra.amount,
            earned_on: earnedOn,
          })
        }
      }
    }

    // ── Revisions ───────────────────────────────────────────────────────────
    // Only when the matching rule says rework is paid. Default is unpaid: the
    // usual case is a revision caused by the lab's own error.
    //
    // A remake is often NOT done by whoever did the original, so each revision
    // may name its own technician and designer. Left empty it falls back to the
    // job's, which is what every revision written before those fields existed
    // meant. The loop is no longer gated on the job's technician: someone who
    // did none of the original work still has to be paid for redoing it.
    for (const [i, rev] of (job.revisions ?? []).entries()) {
      const revTech = rev.assigned_to ?? job.assigned_to
      const isRevTech = revTech === profileId
      // Same split as the job: a remake covering both the crowns and the
      // laminates can have been redesigned by two people.
      const revDesignItems = revisionDesignItems(rev, job, profileId)
      const isRevDesigner = revDesignItems.length > 0
      if (!isRevTech && !isRevDesigner) continue

      const revDate = revisionEarnedOn(rev)
      const revDone = (rev.status ?? '') === doneStageKey
      if (!revDone || !inPeriod(revDate)) continue
      // Explicitly non-billable revision (lab's fault) — skip regardless of rules
      if (rev.taspidev === false) continue

      const revItems = revisionPayItems(rev, job)
      const revPrice = Number(rev.price ?? 0)
      // A remake carries its OWN rush flag — the original may have been routine
      // and the redo needed by Friday, or the other way round.
      const revRush = rev.kiirtoo ? rushMultiplier : 1
      const revRushNote = revRush !== 1 ? ` · kiirtöö ×${revRush}` : ''

      // A revision-specific rule wins. Only when there is none does the job's
      // own rule apply, and then only if it says it covers rework — which is
      // how this behaved before revisions could be priced separately.
      if (isRevTech && !alreadyPaid.has(`rev:${job.id}:${rev.id}`)) {
        const onRevisionScope = payProduction(mine, revItems, revDate, types, 'muudatus', revPrice, revRush)
        const payable = mine.filter(r => r.pay_revisions)
        const pay = onRevisionScope
          ?? payProduction(payable, revItems, revDate, types, 'too', revPrice, revRush)
        if (pay && pay.amount > 0) {
          lines.push({
            key: `rev:${job.id}:${rev.id}`,
            job_id: job.id, revision_id: rev.id, work_hours_id: null,
            kind: pay.kind,
            description: `Muudatus #${i + 1}: ${itemsLabel(revItems)} · ${job.patsient}${revRushNote}`,
            qty: pay.qty, rate: pay.rate, amount: pay.amount, earned_on: revDate,
          })
        }
      }

      // Redesigning a remake is its own work and its own person — but it is
      // still rework, and rework is UNPAID unless a rule says otherwise. Only
      // design rules with "Katab ka muudatused" ticked apply here, exactly as
      // on the production side above. Without that filter every design rule
      // silently started paying for revisions the moment revisions gained a
      // designer field, which is not something anybody asked for.
      const designPayable = mine.filter(r => r.pay_revisions)
      if (isRevDesigner && !alreadyPaid.has(`revdesign:${job.id}:${rev.id}`)) {
        const revDesignPrice = revPrice * priceShare(revItems, revDesignItems)
        const design = payProduction(designPayable, revDesignItems, revDate, types, 'disain', revDesignPrice, revRush)
        if (design && design.amount > 0) {
          lines.push({
            key: `revdesign:${job.id}:${rev.id}`,
            job_id: job.id, revision_id: rev.id, work_hours_id: null,
            kind: design.kind,
            description: `Disain, muudatus #${i + 1}: ${itemsLabel(revDesignItems)} · ${job.patsient}${revRushNote}`,
            qty: design.qty, rate: design.rate, amount: design.amount, earned_on: revDate,
          })
        }
      }

      // A model printed for the remake. Same gate as the redesign above: rework
      // is unpaid unless a rule says it covers it, and the model on a remake is
      // part of that rework however new the physical model is.
      if (isRevTech && rev.mudel && !alreadyPaid.has(`revmudel:${job.id}:${rev.id}`)) {
        const modelPayable = mine.filter(r => r.pay_revisions)
        const model = payProduction(modelPayable, revItems, revDate, types, 'mudel', revPrice, revRush)
        if (model && model.amount > 0) {
          lines.push({
            key: `revmudel:${job.id}:${rev.id}`,
            job_id: job.id, revision_id: rev.id, work_hours_id: null,
            kind: model.kind,
            description: `Mudel, muudatus #${i + 1} · ${job.patsient}${revRushNote}`,
            qty: model.qty, rate: model.rate, amount: model.amount, earned_on: revDate,
          })
        }
      }

      // Extras on a remake. Scoped to 'muudatus', so redoing the gum work is
      // paid without the ordinary gum rule firing on every original job too.
      if (!isRevTech) continue
      for (const extra of payAdditive(mine, revItems, revDate, types, 'muudatus', revPrice, revRush)) {
        const key = `extra:${extra.rule.id}:${job.id}:${rev.id}`
        if (alreadyPaid.has(key)) continue
        lines.push({
          key,
          job_id: job.id, revision_id: rev.id, work_hours_id: null,
          kind: extra.rule.kind,
          description: `${additiveLabel(extra.rule)} (muudatus #${i + 1}) · ${job.patsient}${revRushNote}`,
          qty: extra.qty, rate: extra.rule.amount, amount: extra.amount,
          earned_on: revDate,
        })
      }
    }
  }

  // ── Hourly ────────────────────────────────────────────────────────────────
  const hourRate = mine
    .filter(r => r.kind === 'tund')
    .sort((a, b) => b.priority - a.priority)[0]
  if (hourRate) {
    // Automatic hours: an administrator on a monthly hourly contract should not
    // have to type twenty-one identical rows. A manually logged day always wins
    // over the generated one — that is how an exception (sick day, overtime) is
    // entered once and stays entered.
    if (hourRate.auto_hours && (hourRate.hours_per_day ?? 0) > 0) {
      const manualDays = new Set(
        hours.filter(h => h.profile_id === profileId).map(h => h.work_date)
      )
      const workDays = hourRate.work_days || '12345'
      for (const day of eachDay(periodStart, periodEnd)) {
        if (manualDays.has(day)) continue
        if (!activeOn(hourRate, day)) continue
        if (alreadyPaid.has(`auto:${day}`)) continue
        // getUTCDay: 0 = Sunday. The stored string uses 1 = Monday … 7 = Sunday,
        // which is how a Estonian week is written down.
        const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
        const isoDow = dow === 0 ? 7 : dow
        if (!workDays.includes(String(isoDow))) continue
        const h = Number(hourRate.hours_per_day)
        lines.push({
          key: `auto:${day}`,
          job_id: null, revision_id: null, work_hours_id: null,
          kind: 'tund',
          description: 'Tööpäev (automaatne)',
          qty: h, rate: hourRate.amount, amount: round2(h * hourRate.amount),
          earned_on: day,
        })
      }
    }

    for (const h of hours) {
      if (h.profile_id !== profileId) continue
      if (!inPeriod(h.work_date)) continue
      if (alreadyPaid.has(`hours:${h.id}`)) continue
      if (!activeOn(hourRate, h.work_date)) continue
      const amount = round2(Number(h.hours) * hourRate.amount)
      if (amount <= 0) continue
      lines.push({
        key: `hours:${h.id}`,
        job_id: null, revision_id: null, work_hours_id: h.id,
        kind: 'tund',
        description: h.note?.trim() || 'Töötunnid',
        qty: Number(h.hours), rate: hourRate.amount, amount, earned_on: h.work_date,
      })
    }
  }

  // ── Monthly salary ────────────────────────────────────────────────────────
  // One line per period, not pro-rated. A period that is not a whole month
  // would need a rule about part-months that nobody has stated, so it is paid
  // in full and the label says which period it covers — visible and easy to
  // correct, rather than a silent fraction.
  if (includeMonthly) {
    const monthly = mine
      .filter(r => r.kind === 'kuu' && (activeOn(r, periodStart) || activeOn(r, periodEnd)))
      .sort((a, b) => b.priority - a.priority)[0]
    if (monthly && monthly.amount > 0 && !alreadyPaid.has(`salary:${periodStart}`)) {
      lines.push({
        key: `salary:${periodStart}`,
        job_id: null, revision_id: null, work_hours_id: null,
        kind: 'kuu',
        description: `Kuutasu ${periodStart} – ${periodEnd}`,
        qty: 1, rate: monthly.amount, amount: round2(monthly.amount), earned_on: periodEnd,
      })
    }
  }

  return lines.sort((a, b) => a.earned_on.localeCompare(b.earned_on))
}

/**
 * Why a worker's total is zero.
 *
 * Added because "0 €" with a rate configured and finished jobs assigned is an
 * unanswerable screen — the reason is always one of a handful of things, and
 * the app knows which. Diagnosing that by reading the code is not something a
 * clinic owner should have to do.
 */
export interface EarningsIssue {
  code: 'periood' | 'pooleli' | 'reegel' | 'hambad' | 'hind' | 'makstud'
  label: string
  count: number
  examples: string[]
}

export function diagnoseEarnings(ctx: EarningsContext): EarningsIssue[] {
  const {
    profileId, rates, jobs, types, periodStart, periodEnd, doneStageKey,
    alreadyPaid = new Set(),
  } = ctx
  const mine = rates.filter(r => r.profile_id === profileId)
  const inPeriod = (d: string) => !!d && d >= periodStart && d <= periodEnd

  const buckets = new Map<EarningsIssue['code'], EarningsIssue>()
  const add = (code: EarningsIssue['code'], label: string, job: Job) => {
    const b = buckets.get(code) ?? { code, label, count: 0, examples: [] }
    b.count++
    if (b.examples.length < 3) {
      // Every work type on the job, not just the first — the whole reason a
      // mixed job earned nothing is usually the type that was not named here.
      b.examples.push(`${itemsLabel(payItemsOf(job))} · ${job.patsient}`)
    }
    buckets.set(code, b)
  }

  for (const job of jobs) {
    const isTech = job.assigned_to === profileId
    const designItems = designPayItemsOf(job, profileId)
    const isDesigner = designItems.length > 0
    if (!isTech && !isDesigner) continue

    if (job.status !== doneStageKey) {
      add('pooleli', 'Töö ei ole veel valmis-etapis — tasu arvestatakse alles siis', job)
      continue
    }
    const earnedOn = jobEarnedOn(job)
    if (!inPeriod(earnedOn)) {
      add('periood', `Töö valmimiskuupäev (${earnedOn || 'puudub'}) jääb sellest perioodist välja`, job)
      continue
    }
    if (alreadyPaid.has(`job:${job.id}`) || alreadyPaid.has(`design:${job.id}`)) {
      add('makstud', 'Juba varasema väljamaksega kaetud', job)
      continue
    }
    if (isTech) {
      const items = payItemsOf(job)
      const price = Number(job.hind ?? 0) + Number(job.disain_hind ?? 0)
      const pay = payProduction(mine, items, earnedOn, types, 'too', price)
      if (!pay) {
        add('reegel', 'Ühtegi tasureeglit ei sobi selle tööga (kontrolli "Mille eest" ja "Ainult töö tüübile")', job)
        continue
      }
      // A job can now be PARTLY paid: the crowns match a rule and the bridge
      // does not. That used to be invisible because one rule covered the whole
      // job either way, and it is the failure worth naming loudest — the total
      // looks plausible and is short by one work item.
      if (pay.unmatched.length > 0) {
        add('reegel',
          `Osa tööosi jääb tasustamata — neile ei sobi ükski reegel: ${[...new Set(pay.unmatched)].join(', ')}`,
          job)
      }
      // A model on the job with no rule to pay it is silent money: the job is
      // paid, the line for the model simply never appears.
      if (job.mudel && !payProduction(mine, items, earnedOn, types, 'mudel', price)) {
        add('reegel', 'Tööl on mudel, aga mudeli eest makstavat reeglit ei ole', job)
      }
      if (pay.amount === 0 && pay.kind === 'hammas') {
        add('hambad', 'Tasu on hamba kohta, aga tööosadel ei ole hambaid valitud', job)
        continue
      }
      if (pay.amount === 0 && pay.kind === 'protsent') {
        add('hind', 'Tasu on protsent hinnast, aga tööl ei ole hinda', job)
        continue
      }
      // Revisions are diagnosed separately — they have their own status, their
      // own date and now their own rate, so a job that earned fine can still
      // have rework that silently earned nothing.
      for (const [i, rev] of (job.revisions ?? []).entries()) {
        if (rev.taspidev === false) continue  // explicitly non-billable
        const label = `Muudatus #${i + 1}: ${job.too?.trim() || 'Töö'} · ${job.patsient}`
        const revJob = { ...job, too: label } as Job
        if ((rev.status ?? '') !== doneStageKey) {
          add('pooleli', 'Muudatus ei ole valmis-etapis', revJob)
          continue
        }
        const revDate = revisionEarnedOn(rev)
        if (!inPeriod(revDate)) {
          add('periood', `Muudatuse kuupäev (${revDate || 'puudub'}) jääb sellest perioodist välja`, revJob)
          continue
        }
        if (alreadyPaid.has(`rev:${job.id}:${rev.id}`)) continue
        const revItems = revisionPayItems(rev, job)
        const revPrice = Number(rev.price ?? 0)
        const revPay = payProduction(mine, revItems, revDate, types, 'muudatus', revPrice)
          ?? payProduction(mine.filter(r => r.pay_revisions), revItems, revDate, types, 'too', revPrice)
        if (!revPay) {
          add('reegel', 'Muudatuste eest ei maksta — lisa "Muudatus" reegel või märgi tööreeglil "Muudatused tasustatud"', revJob)
          continue
        }
        if (revPay.amount === 0 && revPay.kind === 'hammas') {
          add('hambad', 'Muudatuse tasu on hamba kohta, aga hambaid ei ole valitud', revJob)
        }
        if (revPay.amount === 0 && revPay.kind === 'protsent') {
          add('hind', 'Muudatuse tasu on protsent hinnast, aga muudatusel ei ole hinda', revJob)
        }
      }
    } else if (isDesigner) {
      // A designer with no design-scoped rule earns nothing and would otherwise
      // vanish from the reckoning without a word. Only the parts they actually
      // designed are examined — a rule missing for the OTHER designer's items is
      // that person's problem and shows up on their own row.
      const price = (Number(job.disain_hind ?? 0) || Number(job.hind ?? 0))
        * priceShare(payItemsOf(job), designItems)
      const design = payProduction(mine, designItems, earnedOn, types, 'disain', price)
      if (!design) {
        add('reegel', 'Disainijaks on määratud, aga disaini eest makstavat reeglit ei ole', job)
        continue
      }
      if (design.amount === 0 && design.kind === 'hammas') {
        add('hambad', 'Disaini tasu on hamba kohta, aga tööl ei ole hambaid valitud', job)
        continue
      }
    }
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count)
}

export const earningsTotal = (lines: EarningLine[]): number =>
  round2(lines.reduce((s, l) => s + l.amount, 0))

/**
 * What the gross pay actually costs the employer, once their share of payroll
 * taxes is on top. The rate comes from settings and defaults to 0 — a tax rate
 * this app invented would be worse than an obviously missing one.
 */
export const employerCost = (gross: number, employerTaxPct: number): number =>
  round2(gross * (1 + (employerTaxPct || 0) / 100))

export const employerTaxAmount = (gross: number, employerTaxPct: number): number =>
  round2(gross * (employerTaxPct || 0) / 100)
