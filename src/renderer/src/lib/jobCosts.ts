/**
 * What one job COSTS the lab. THE implementation.
 *
 * This lived inside `JobDetailPanel`'s pricing block, which meant it existed
 * only while the job was being EDITED — the read view showed a price and no
 * cost at all, so seeing the margin meant opening the form. It also meant that
 * anything else wanting the number (the read view, a report, a panel) would
 * have had to compute it again, and this file's whole subject is a figure that
 * has already been recomputed wrong in six places once before.
 *
 * FOUR CATEGORIES, AND THEY ARE FIXED
 * Lines come and go with the rules — "Kroon: 3 × 18 €" disappears the moment a
 * work item changes. Categories do not, which is why an override is attached to
 * a category and never to a line: an override bound to a line that can vanish
 * is an override that vanishes with it.
 *
 * AN OVERRIDE IS NOT A RATE CHANGE
 * `job.kulu_yle` says what THIS job cost. Payroll reads `worker_rates` and
 * nothing else, so typing 25 here never moves anybody's wages — see sql/057.
 */
import type { Job } from '../types/job'
import { jobWorkItems, workItemDesigner } from '../types/job'
import type { WorkerRate } from './earnings'
import { pickRateFor, calculateEarnings } from './earnings'
import { jobMaterialDetail } from './finance'
import { workTypeConsumables, abutmentUnitPrice, type WorkType } from '../config/workTypes'
import type { MaterialPricing } from '@shared/pricing/priceBook'

const round2 = (n: number) => Math.round(n * 100) / 100
const toothCount = (h: string | null | undefined) =>
  (h ?? '').split(',').filter(t => t.trim()).length

/** The four buckets a cost can land in. Stable, so an override can name one. */
export type CostKey = 'tehnik' | 'disainija' | 'materjal' | 'tarvikud'

export const COST_LABEL: Record<CostKey, string> = {
  tehnik:    'Tehnik',
  disainija: 'Disainija',
  materjal:  'Materjal',
  tarvikud:  'Tarvikud',
}

export interface CostLine {
  /** "Kroon: 3 × 18.00 €" — what the rule did, in words. */
  label: string
  amount: number
}

export interface CostCategory {
  key: CostKey
  label: string
  /** Empty when nothing matched, or when an override replaced the whole lot. */
  lines: CostLine[]
  /** What the rules say. Kept even when overridden, so the screen can show both. */
  computed: number
  /** What a person typed instead. Null = follow the rules. */
  override: number | null
  /** `override ?? computed` — the number that counts. */
  amount: number
}

export interface JobCostsInput {
  job: Pick<Job,
    'work_items' | 'too' | 'hambad' | 'materjal' | 'masina' | 'kiirtoo' | 'mudel'
    | 'assigned_to' | 'designed_by' | 'extra_costs' | 'kulu_yle' | 'hind' | 'disain_hind'
    | 'materjali_yhikud'
  >
  rates: WorkerRate[]
  workTypes: WorkType[]
  materialCosts: Record<string, MaterialPricing>
  materialPrices: Record<string, MaterialPricing>
  /** For the rush multiplier, which is per person. */
  workers: { id: string; kiirtoo_kordaja?: number | null; full_name?: string | null }[]
  /** 'YYYY-MM-DD' — which rates were active. Defaults to today. */
  on?: string
}

export interface JobCosts {
  categories: CostCategory[]
  /** Ad-hoc costs typed on the job. Never overridden — they ARE the override. */
  adHoc: CostLine[]
  adHocTotal: number
  total: number
  /** What the client pays, for the margin. */
  revenue: number
  margin: number
  /** Null when there is no revenue to take a percentage of. */
  marginPct: number | null
  /** The technician's hourly rate, for information. Null when they have none. */
  technicianHourly: number | null
}

export function jobCosts(input: JobCostsInput): JobCosts {
  const { job, rates, workTypes, materialCosts, materialPrices, workers } = input
  const on = input.on ?? new Date().toISOString().slice(0, 10)

  const items = jobWorkItems(job)
  const allTeeth = items.length > 0
    ? items.map(i => i.hambad).filter(Boolean).join(',')
    : (job.hambad ?? '')

  // Same rule the pay engine follows: fixed rates are uplifted on a rush, a
  // percentage is not, and the multiplier belongs to the PERSON.
  const rushOf = (id: string | null | undefined): number =>
    job.kiirtoo && id ? (workers.find(w => w.id === id)?.kiirtoo_kordaja ?? 1) : 1
  const rushTag = (m: number) => (m !== 1 ? ` ×${m} kiirtöö` : '')

  // ── Technician ────────────────────────────────────────────────────────────
  const tId = job.assigned_to
  const tRates = tId ? rates.filter(r => r.profile_id === tId) : []
  const tRush = rushOf(tId)
  const techLines: CostLine[] = []

  for (const item of tId ? items : []) {
    const tc = toothCount(item.hambad)
    const rate = pickRateFor(tRates, item.too, on, workTypes, 'too')
    if (!rate) continue
    const amt = (rate.kind === 'hammas' ? tc * rate.amount : rate.kind === 'too' ? rate.amount : 0) * tRush
    if (amt > 0) techLines.push({ label: `${item.too}: ${tc} × ${rate.amount} €${rushTag(tRush)}`, amount: amt })
  }

  // The model. Its own scope, so it adds to the production rate rather than
  // competing with it — printing one is work the technician did.
  if (job.mudel && tId) {
    const mRate = pickRateFor(tRates, items[0]?.too, on, workTypes, 'mudel')
    if (mRate) {
      const tc = toothCount(allTeeth)
      const amt = (mRate.kind === 'hammas' ? tc * mRate.amount : mRate.kind === 'too' ? mRate.amount : 0) * tRush
      if (amt > 0) techLines.push({ label: `Mudel: 1 × ${mRate.amount} €${rushTag(tRush)}`, amount: amt })
    }
  }

  for (const r of tRates) {
    if (!r.additive || (r.applies_to ?? 'too') !== 'too') continue
    const covered = coveredBy(r, items)
    if (covered.length === 0) continue
    const tc = covered.reduce((s, i) => s + toothCount(i.hambad), 0)
    const amt = (r.kind === 'hammas' ? tc * r.amount : r.kind === 'too' ? r.amount * covered.length : 0) * tRush
    if (amt > 0) techLines.push({ label: `${r.label || 'Lisatasu'}: ${tc} × ${r.amount} €${rushTag(tRush)}`, amount: amt })
  }

  // ── Designers ─────────────────────────────────────────────────────────────
  // Per work item, because a case is routinely split between two of them.
  const designerOf = (i: { designed_by?: string | null }) => workItemDesigner(i, job.designed_by)
  const designerIds = [...new Set(items.map(designerOf).filter((x): x is string => !!x))]
  const designLines: CostLine[] = []
  // Whose name to put on a line. Only worth saying when the job is split.
  const designerTag = (id: string): string => {
    if (designerIds.length < 2) return ''
    const name = workers.find(w => w.id === id)?.full_name ?? ''
    return ` (${name.split(' ')[0] || '?'})`
  }

  for (const item of items) {
    const dId = designerOf(item)
    if (!dId) continue
    const dRates = rates.filter(r => r.profile_id === dId)
    const dRush = rushOf(dId)
    const tc = toothCount(item.hambad)
    const rate = pickRateFor(dRates, item.too, on, workTypes, 'disain')
    if (!rate) continue
    const amt = (rate.kind === 'hammas' ? tc * rate.amount : rate.kind === 'too' ? rate.amount : 0) * dRush
    if (amt > 0) {
      designLines.push({
        label: `${item.too}${designerTag(dId)}: ${tc} × ${rate.amount} €${rushTag(dRush)}`,
        amount: amt,
      })
    }
  }

  for (const dId of designerIds) {
    const theirs = items.filter(i => designerOf(i) === dId)
    const dRush = rushOf(dId)
    for (const r of rates.filter(r => r.profile_id === dId)) {
      if (!r.additive || (r.applies_to ?? 'too') !== 'disain') continue
      const covered = coveredBy(r, theirs)
      if (covered.length === 0) continue
      const tc = covered.reduce((s, i) => s + toothCount(i.hambad), 0)
      const amt = (r.kind === 'hammas' ? tc * r.amount : r.kind === 'too' ? r.amount * covered.length : 0) * dRush
      if (amt > 0) designLines.push({ label: `${r.label || 'Lisatasu'}${designerTag(dId)}: ${tc} × ${r.amount} €${rushTag(dRush)}`, amount: amt })
    }
  }

  // ── Material ──────────────────────────────────────────────────────────────
  const effectiveMaterial = items.find(i => i.materjal)?.materjal ?? (job.materjal ?? '')
  const mat = jobMaterialDetail(
    {
      materjal: effectiveMaterial, hambad: allTeeth, masina: job.masina,
      materjali_yhikud: job.materjali_yhikud,
    },
    materialCosts, materialPrices
  )
  const matCost = mat?.summa ?? 0
  // The line SAYS how the number was reached. "42.00 €" against a plate the
  // technician can see is not checkable; "2 kapslit × 21.00 €" is. Per-tooth
  // jobs keep the bare material name, because there the teeth are the answer
  // and they are already on screen.
  const matLabel = !mat || mat.kapsleid == null
    ? (effectiveMaterial || 'Materjal')
    : `${effectiveMaterial || 'Materjal'}: ${mat.kapsleid} kapslit`
      + ` × ${mat.tykihind.toFixed(2)} €`
  const matLines: CostLine[] = matCost > 0
    ? [{ label: matLabel, amount: matCost }]
    : []

  // ── Consumables ───────────────────────────────────────────────────────────
  const consLines: CostLine[] = items.flatMap(i =>
    workTypeConsumables(i.too, workTypes, toothCount(i.hambad)).items
      .map(c => ({ label: c.nimi, amount: c.summa }))
  )

  const yle = (job.kulu_yle ?? {}) as Partial<Record<CostKey, number>>
  const build = (key: CostKey, lines: CostLine[]): CostCategory => {
    const computed = round2(lines.reduce((s, l) => s + l.amount, 0))
    // A key that is ABSENT means "follow the rules"; a key set to 0 is a
    // deliberate zero. Collapsing the two would make an override impossible to
    // take back.
    const override = typeof yle[key] === 'number' ? Number(yle[key]) : null
    return { key, label: COST_LABEL[key], lines, computed, override, amount: override ?? computed }
  }

  const categories: CostCategory[] = [
    build('tehnik', techLines),
    build('disainija', designLines),
    build('materjal', matLines),
    build('tarvikud', consLines),
  ]

  const adHoc: CostLine[] = (job.extra_costs ?? [])
    .map(c => ({ label: c.nimi || 'Lisakulu', amount: Number(c.summa) || 0 }))
  const adHocTotal = round2(adHoc.reduce((s, l) => s + l.amount, 0))

  const total = round2(categories.reduce((s, c) => s + c.amount, 0) + adHocTotal)
  const revenue = round2(Number(job.hind ?? 0) + Number(job.disain_hind ?? 0))
  const margin = round2(revenue - total)

  // Information only, never part of the total: an hourly rate says what the
  // person costs per hour, not how many hours this job took.
  const tHour = tRates.find(r => r.kind === 'tund')
  const tMonth = tRates.find(r => r.kind === 'kuu')
  let technicianHourly: number | null = null
  if (tHour) technicianHourly = tHour.amount
  else if (tMonth?.hours_per_day && tMonth.work_days) {
    const monthlyHours = tMonth.work_days.length * 4.33 * tMonth.hours_per_day
    technicianHourly = monthlyHours > 0 ? round2(tMonth.amount / monthlyHours) : null
  }

  return {
    categories,
    adHoc,
    adHocTotal,
    total,
    revenue,
    margin,
    marginPct: revenue > 0 ? round2((margin / revenue) * 100) : null,
    technicianHourly,
  }
}

/** Items an additive rule covers. Empty `work_type` means every one of them. */
function coveredBy<T extends { too: string }>(r: WorkerRate, items: T[]): T[] {
  const rt = (r.work_type ?? '').toLowerCase()
  if (!rt) return items
  return items.filter(i => rt.split('|').some(wt => i.too.toLowerCase().includes(wt.trim())))
}

// ─── The whole case: original + every remake ─────────────────────────────────

/**
 * What one revision cost the lab.
 *
 * A remake is not free and it is not billed, so it lands entirely on the
 * margin. Until this existed the job page showed `sum(rev.price)` in small grey
 * type beside the total and left the two unadded — a job with five remakes read
 * 75% margin when it had made 62%.
 */
export interface RevisionCost {
  id: string
  /** 1-based, matching the "Muudatus 3" chips on the job page. */
  nr: number
  note: string
  /** As PAYROLL computes it — not re-derived here. See the note in jobTotalCosts. */
  labour: number
  /** Resin plus any re-ordered hardware. Spent whether or not anybody was paid. */
  material: number
  /** Of `material`, the part that is newly ordered abutments. 0 when reused. */
  tarvikud: number
  extras: number
  total: number
  /** False = the lab's own fault, so nobody is paid. The resin still went. */
  tasustatav: boolean
  /** Unfinished remakes carry material but no labour — payroll has not paid it. */
  valmis: boolean
}

export interface JobTotal {
  /** The original job, exactly as `jobCosts` reports it. */
  base: JobCosts
  revisions: RevisionCost[]
  revisionTotal: number
  /** base.total + revisionTotal — what the case has cost the lab, all in. */
  total: number
  revenue: number
  margin: number
  marginPct: number | null
}

export interface JobTotalInput extends Omit<JobCostsInput, 'job'> {
  job: Job
  /** Which stage means finished. Revision labour is only paid once it is. */
  doneStageKey: string
}

/**
 * Cost of a case including its remakes.
 *
 * ── Why labour comes from `calculateEarnings` ────────────────────────────────
 * A revision does NOT pay like a job. A rate scoped to `muudatus` wins; without
 * one, only a rate with "Katab ka muudatused" ticked applies; and `taspidev:
 * false` (the lab's own fault) pays nothing at all. Re-deriving that here would
 * be a second implementation of the payroll rule, and the two would drift the
 * first time somebody changed one of them — which is the failure this codebase
 * has already had, in six places, over this exact number.
 *
 * So the pay engine is ASKED, over an open-ended period and with nothing marked
 * as already paid: the question is what the remake cost, not what is still owed.
 */
export function jobTotalCosts(input: JobTotalInput): JobTotal {
  const { job, workers, rates, workTypes, doneStageKey } = input
  const base = jobCosts(input)
  const revs = job.revisions ?? []

  // Every revision line for this job, whoever earned it. `jobs: [job]` keeps
  // the engine to one case; the period is deliberately open so that a remake
  // finished in any month still counts towards what this case cost.
  const labourOf = new Map<string, number>()
  if (revs.length > 0) {
    for (const w of workers) {
      const lines = calculateEarnings({
        profileId: w.id, rates, jobs: [job], hours: [], types: workTypes,
        periodStart: '1900-01-01', periodEnd: '2999-12-31', doneStageKey,
        alreadyPaid: new Set(), includeMonthly: false,
        rushMultiplier: w.kiirtoo_kordaja ?? 1,
      })
      for (const l of lines) {
        if (!l.revision_id) continue
        labourOf.set(l.revision_id, (labourOf.get(l.revision_id) ?? 0) + l.amount)
      }
    }
  }

  const revisions: RevisionCost[] = revs.map((r, i) => {
    // A revision inherits what it does not restate — the same fallback the
    // read view uses, so an unchanged field means "unchanged", not "empty".
    const teeth = r.hambad ?? job.hambad ?? ''
    const items = Array.isArray(r.work_items) && r.work_items.length > 0 ? r.work_items : null
    const material = jobMaterialDetail(
      {
        materjal: r.materjal ?? job.materjal,
        hambad: items ? items.map(x => x.hambad).filter(Boolean).join(',') : teeth,
        masina: job.masina,
        // Capsules are counted per JOB. A remake reprinted on the same plate
        // has no field of its own, so it falls back to the per-tooth price
        // rather than silently charging the job's capsules twice.
        materjali_yhikud: null,
      },
      input.materialCosts, input.materialPrices,
    )?.summa ?? 0

    // NO consumables. The work type's `kulud` are screws, ti-bases and
    // abutments — bought once for the case, and on a remake they are already in
    // the patient's mouth. Charging them again made every remake of a 1200 €
    // Allon4 read 1313 € whatever had actually been redone, and five of them
    // added 6000 € of hardware nobody bought.
    //
    // When a remake genuinely does consume one — a screw that sheared — that is
    // `extra_costs` on the revision, which is exactly what the field was added
    // for. The default is the conservative one: it under-states rather than
    // inventing a cost, and the technician can add what really went.
    // Hardware the remake really did order. Asked on the revision form rather
    // than assumed either way: "we reused them" and "we ordered four new ones"
    // are both normal, and only the person who placed the order knows which.
    const uusi = Number(r.uusi_tarvikuid)
    const tarvikud = Number.isFinite(uusi) && uusi > 0
      ? round2(Math.floor(uusi) * abutmentUnitPrice(items?.[0]?.too ?? job.too, workTypes))
      : 0

    const extras = round2((r.extra_costs ?? []).reduce((s, c) => s + (Number(c.summa) || 0), 0))
    const labour = round2(labourOf.get(r.id) ?? 0)
    const mat = round2(material + tarvikud)

    return {
      id: r.id,
      nr: i + 1,
      note: r.note ?? '',
      labour, material: mat, extras, tarvikud,
      total: round2(labour + mat + extras),
      tasustatav: r.taspidev !== false,
      valmis: (r.status ?? '') === doneStageKey,
    }
  })

  const revisionTotal = round2(revisions.reduce((s, r) => s + r.total, 0))
  const total = round2(base.total + revisionTotal)
  const revenue = base.revenue
  const margin = round2(revenue - total)

  return {
    base, revisions, revisionTotal, total, revenue, margin,
    marginPct: revenue > 0 ? round2((margin / revenue) * 100) : null,
  }
}
