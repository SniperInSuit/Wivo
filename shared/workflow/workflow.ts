/**
 * Workflow templates (docs/WORKFLOW-STAGES.md, plan 3): the rules, as pure
 * functions, so the desktop, the phone and the tests agree on them.
 *
 * The database (sql/122) holds the same closed lists in its CHECK
 * constraints; workflow.test.ts fails if the two drift apart.
 *
 * Nothing here reads a patient: a template and a job's stages carry stage
 * keys, task texts and profile ids only.
 */

// ─── The closed lists ────────────────────────────────────────────────────────

/** §2.5: the rules a template stage can depend on. A new one is a line here and in sql/. */
export const ONLY_IF_RULES = ['digital', 'conventional', 'implants_gt_1', 'print', 'mill', 'printed_model'] as const
export type OnlyIfRule = (typeof ONLY_IF_RULES)[number]

/** §10: the pay kinds of lib/earnings.ts (RateScope). */
export const PAY_ROLES = ['too', 'disain', 'mudel', 'muudatus'] as const
export type PayRole = (typeof PAY_ROLES)[number]

export const isOnlyIfRule = (v: unknown): v is OnlyIfRule => (ONLY_IF_RULES as readonly unknown[]).includes(v)
export const isPayRole = (v: unknown): v is PayRole => (PAY_ROLES as readonly unknown[]).includes(v)

// ─── §2.5: rules ─────────────────────────────────────────────────────────────

/** The job fields the rules read (jobs.impression_type and the rest, sql/122). */
export interface JobFacts {
  impressionType?: 'digital' | 'conventional' | null
  implantCount?: number | null
  productionMethod?: 'print' | 'mill' | null
  printedModel?: boolean | null
}

/** One rule against a job. A field not filled in makes its rule false. */
export function ruleHolds(rule: OnlyIfRule, f: JobFacts): boolean {
  switch (rule) {
    case 'digital': return f.impressionType === 'digital'
    case 'conventional': return f.impressionType === 'conventional'
    case 'implants_gt_1': return typeof f.implantCount === 'number' && f.implantCount > 1
    case 'print': return f.productionMethod === 'print'
    case 'mill': return f.productionMethod === 'mill'
    case 'printed_model': return f.printedModel === true
  }
}

/** All of a stage's rules must hold (photogrammetry: digital AND implants_gt_1). None: always. */
export const rulesHold = (rules: readonly OnlyIfRule[], f: JobFacts): boolean => rules.every(r => ruleHolds(r, f))

// ─── A template ──────────────────────────────────────────────────────────────

export interface TemplateStage {
  stageKey: string
  position: number
  task?: string | null
  /** A switch at job creation (§2.5). */
  optional: boolean
  /** The switch's default; only on an optional stage. */
  defaultOn: boolean
  onlyIf: readonly OnlyIfRule[]
  /** The doctor who creates the job is on this stage (§2.6a). */
  orderer: boolean
  payRole: PayRole | null
  /** The named people on this template stage (workflow_template_stage_person). */
  people: readonly string[]
}

export type TemplateProblem =
  | { code: 'pay_role_twice'; payRole: PayRole; stageKeys: [string, string] }
  | { code: 'stage_twice'; stageKey: string }
  | { code: 'position_twice'; position: number }
  | { code: 'switch_and_rule'; stageKey: string }
  | { code: 'default_on_without_switch'; stageKey: string }
  | { code: 'unknown_rule'; stageKey: string; rule: string }
  | { code: 'unknown_pay_role'; stageKey: string; payRole: string }
  | { code: 'empty_stage_key'; position: number }

/**
 * Everything the database would refuse, found before saving, so the form can
 * say which stage already holds a pay kind (§10) instead of showing an error
 * code. An empty list means the template saves.
 */
export function validateTemplate(stages: readonly TemplateStage[]): TemplateProblem[] {
  const problems: TemplateProblem[] = []
  const byKey = new Set<string>()
  const byPosition = new Set<number>()
  const payRoleAt = new Map<PayRole, string>()
  for (const s of stages) {
    const key = s.stageKey.trim()
    if (!key) problems.push({ code: 'empty_stage_key', position: s.position })
    else if (byKey.has(key)) problems.push({ code: 'stage_twice', stageKey: key })
    byKey.add(key)
    if (byPosition.has(s.position)) problems.push({ code: 'position_twice', position: s.position })
    byPosition.add(s.position)
    for (const r of s.onlyIf) if (!isOnlyIfRule(r)) problems.push({ code: 'unknown_rule', stageKey: key, rule: String(r) })
    if (s.optional && s.onlyIf.length > 0) problems.push({ code: 'switch_and_rule', stageKey: key })
    if (s.defaultOn && !s.optional) problems.push({ code: 'default_on_without_switch', stageKey: key })
    if (s.payRole !== null) {
      if (!isPayRole(s.payRole)) { problems.push({ code: 'unknown_pay_role', stageKey: key, payRole: String(s.payRole) }); continue }
      const first = payRoleAt.get(s.payRole)
      if (first !== undefined) problems.push({ code: 'pay_role_twice', payRole: s.payRole, stageKeys: [first, key] })
      else payRoleAt.set(s.payRole, key)
    }
  }
  return problems
}

// ─── §2.3–2.6a: a job from a template ────────────────────────────────────────

export interface MaterialiseInput {
  stages: readonly TemplateStage[]
  facts: JobFacts
  /** jobs.ordered_by: the person creating the job. */
  orderedBy: string | null
  /** The switches ticked or unticked at job creation, by stage key. Absent: the stage's default_on. */
  switches?: Readonly<Record<string, boolean>>
  /** clinic_stage_default: the clinic's fall-back people per stage key. */
  clinicDefaults?: Readonly<Record<string, readonly string[]>>
}

/** One stage of the new job, as job_stage + job_stage_person rows. */
export interface JobStagePlan {
  stageKey: string
  position: number
  task: string | null
  payRole: PayRole | null
  people: string[]
}

/**
 * The job's own stages: copied from the template, never referenced (§2.3).
 *
 * - A switch stage comes in when ticked, or by its default when not asked.
 * - A rule stage comes in when every rule holds for the job.
 * - People: the template's named people, plus the orderer on an orderer
 *   stage; a stage left with nobody takes the clinic's default people.
 * - Positions are 0, 1, 2… in the template's order.
 */
export function materialiseTemplate(input: MaterialiseInput): JobStagePlan[] {
  const ordered = [...input.stages].sort((a, b) => a.position - b.position)
  const kept = ordered.filter(s => {
    if (s.optional) return input.switches?.[s.stageKey] ?? s.defaultOn
    return rulesHold(s.onlyIf, input.facts)
  })
  return kept.map((s, i) => {
    const people = new Set<string>(s.people)
    if (s.orderer && input.orderedBy) people.add(input.orderedBy)
    if (people.size === 0) for (const p of input.clinicDefaults?.[s.stageKey] ?? []) people.add(p)
    return {
      stageKey: s.stageKey,
      position: i,
      task: s.task?.trim() ? s.task : null,
      payRole: s.payRole,
      people: [...people],
    }
  })
}

// ─── §5: who may move a job ──────────────────────────────────────────────────

export interface JobStageState {
  stageKey: string
  position: number
  skipped: boolean
  people: readonly string[]
}

/**
 * 'legacy': the job has no stage people at all (an old job, the default
 * template with nobody on it). The caller applies today's rule (jobs.write
 * and stage_move_allowed, sql/078), unchanged.
 */
export type MoveVerdict = 'allowed' | 'refused' | 'legacy'

export interface MoveQuestion {
  stages: readonly JobStageState[]
  /** jobs.status now. */
  from: string
  to: string
  actor: string
  actorIsOwner: boolean
}

/**
 * §5: the current stage's people, and the owner, may move the job. The target
 * stage's people may pull it only from the stage right before the target —
 * skipped stages not counted — never from a skipped stage or further back.
 * Nobody moves a job into a stage it does not have, or into a skipped one.
 */
export function canMoveStage(q: MoveQuestion): MoveVerdict {
  if (!q.stages.some(s => s.people.length > 0)) return 'legacy'
  if (q.from === q.to) return 'refused'
  const target = q.stages.find(s => s.stageKey === q.to)
  if (!target || target.skipped) return 'refused'
  if (q.actorIsOwner) return 'allowed'
  const current = q.stages.find(s => s.stageKey === q.from)
  if (current && current.people.includes(q.actor)) return 'allowed'
  if (target.people.includes(q.actor)) {
    const previous = previousStage(q.stages, target)
    if (previous && previous.stageKey === q.from) return 'allowed'
  }
  return 'refused'
}

/** The last stage before `target` that is not skipped, or null. */
export function previousStage(stages: readonly JobStageState[], target: JobStageState): JobStageState | null {
  let best: JobStageState | null = null
  for (const s of stages) {
    if (s.skipped || s.position >= target.position) continue
    if (!best || s.position > best.position) best = s
  }
  return best
}

// ─── §10: an equal split among the people of one stage ───────────────────────

export interface PayShare { profileId: string; cents: number }

/**
 * A pay line's amount, in whole cents, split equally between the people of
 * ONE stage. The parts always add up to the amount exactly: the cents left
 * over go one each to the first people in id order, so the same split comes
 * out the same every time it is computed.
 */
export function splitEqually(cents: number, people: readonly string[]): PayShare[] {
  if (!Number.isSafeInteger(cents)) throw new Error(`splitEqually: ${cents} is not a whole number of cents`)
  const ids = [...new Set(people)].sort()
  if (ids.length === 0) return []
  const sign = cents < 0 ? -1 : 1
  const abs = Math.abs(cents)
  const base = Math.floor(abs / ids.length)
  const rest = abs - base * ids.length
  // `|| 0`: a negative amount smaller than the head count would give -0.
  return ids.map((profileId, i) => ({ profileId, cents: sign * (base + (i < rest ? 1 : 0)) || 0 }))
}
