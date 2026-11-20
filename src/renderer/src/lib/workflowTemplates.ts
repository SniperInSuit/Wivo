/**
 * Workflow templates, as the Settings screen reads and writes them
 * (docs/WORKFLOW-STAGES.md §2, sql/122).
 *
 * The rules (what a template may hold) are shared/workflow: the form calls
 * validateTemplate() before it saves, so a pay kind on two stages is said in
 * words, not as a database error. This file only maps rows to that shape and
 * back, and says what each template problem is called on screen.
 *
 * Nothing here reads a patient: a template holds stage keys, task texts and
 * profile ids.
 */
import {
  validateTemplate, type OnlyIfRule, type PayRole, type TemplateProblem, type TemplateStage,
} from '@shared/workflow/workflow'
import { supabase } from './supabase'
import { t } from './i18n'

export interface TemplateRow {
  id: string
  name: string
  isDefault: boolean
  archived: boolean
  stages: TemplateStage[]
}

interface RawStage {
  id: string
  stage_key: string
  position: number
  task: string | null
  optional: boolean
  default_on: boolean
  only_if: string[] | null
  orderer: boolean
  pay_role: string | null
  workflow_template_stage_person: { profile_id: string }[] | null
}
interface RawTemplate {
  id: string
  name: string
  is_default: boolean
  archived_at: string | null
  workflow_template_stage: RawStage[] | null
}

export const TEMPLATE_SELECT =
  'id, name, is_default, archived_at, workflow_template_stage(id, stage_key, position, task, optional, default_on, only_if, orderer, pay_role, workflow_template_stage_person(profile_id))'

/** Rows as read → templates, stages in their order. Pure. */
export function templatesFromRows(rows: readonly RawTemplate[] | null | undefined): TemplateRow[] {
  return (rows ?? []).map(r => ({
    id: r.id,
    name: r.name,
    isDefault: r.is_default,
    archived: r.archived_at !== null,
    stages: [...(r.workflow_template_stage ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(s => ({
        stageKey: s.stage_key,
        position: s.position,
        task: s.task,
        optional: s.optional,
        defaultOn: s.default_on,
        onlyIf: (s.only_if ?? []) as OnlyIfRule[],
        orderer: s.orderer,
        payRole: (s.pay_role ?? null) as PayRole | null,
        people: (s.workflow_template_stage_person ?? []).map(p => p.profile_id),
      })),
  })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
}

/** The database does not have the template tables (sql/122 not applied): nothing to show, not an error. */
export function templatesUnavailable(error: { code?: string | null } | null | undefined): boolean {
  const c = error?.code ?? ''
  return c === '42P01' || c === 'PGRST200' || c === 'PGRST205' || c === 'PGRST202' || c === '42883'
}

export async function fetchTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from('workflow_template')
    .select(TEMPLATE_SELECT)
    .is('archived_at', null)
  if (error) {
    if (templatesUnavailable(error)) return []
    throw error
  }
  return templatesFromRows(data as unknown as RawTemplate[])
}

/** What the form says for a problem `validateTemplate` found. `label` names a stage key. */
export function problemText(p: TemplateProblem, label: (stageKey: string) => string): string {
  switch (p.code) {
    case 'pay_role_twice': return t('workflow.problemPayRoleTwice', {
      role: payRoleLabel(p.payRole), first: label(p.stageKeys[0]), second: label(p.stageKeys[1]) })
    case 'stage_twice': return t('workflow.problemStageTwice', { stage: label(p.stageKey) })
    case 'position_twice': return t('workflow.problemPositionTwice')
    case 'switch_and_rule': return t('workflow.problemSwitchAndRule', { stage: label(p.stageKey) })
    case 'default_on_without_switch': return t('workflow.problemDefaultOnWithoutSwitch', { stage: label(p.stageKey) })
    case 'unknown_rule': return t('workflow.problemUnknownRule', { stage: label(p.stageKey) })
    case 'unknown_pay_role': return t('workflow.problemUnknownPayRole', { stage: label(p.stageKey) })
    case 'empty_stage_key': return t('workflow.problemEmptyStage')
  }
}

export const payRoleLabel = (r: PayRole): string => ({
  too: t('workflow.payToo'), disain: t('workflow.payDisain'), mudel: t('workflow.payMudel'), muudatus: t('workflow.payMuudatus'),
})[r]

export const ruleLabel = (r: OnlyIfRule): string => ({
  digital: t('workflow.ruleDigital'), conventional: t('workflow.ruleConventional'),
  implants_gt_1: t('workflow.ruleImplantsGt1'), print: t('workflow.rulePrint'),
  mill: t('workflow.ruleMill'), printed_model: t('workflow.rulePrintedModel'),
})[r]

/**
 * A template as the form holds it: stages renumbered 0..n-1 in the order shown
 * (a position is the order, never typed), and a blank task stored as null.
 */
export function normaliseStages(stages: readonly TemplateStage[]): TemplateStage[] {
  return stages.map((s, i) => ({
    ...s,
    position: i,
    stageKey: s.stageKey.trim(),
    task: s.task?.trim() ? s.task.trim() : null,
    // A rule stage is not a switch and the other way round (the database refuses both at once).
    optional: s.onlyIf.length > 0 ? false : s.optional,
    defaultOn: s.onlyIf.length > 0 || !s.optional ? false : s.defaultOn,
    people: [...new Set(s.people)],
  }))
}

export type SaveProblem = TemplateProblem[]

/**
 * Save one template: its name and its stages with their people. Stages are
 * replaced as a whole (a job made from the template already copied its own,
 * §2.3, so nothing already made changes).
 *
 * Checked first: whatever validateTemplate finds is returned and nothing is
 * written. The writes themselves are separate requests, in the order that
 * leaves the old stages in place until the new ones are ready to go in; if one
 * fails the error is thrown and the screen reloads what the database holds.
 */
export async function saveTemplate(
  orgId: string,
  template: { id: string | null; name: string; stages: readonly TemplateStage[] },
): Promise<{ id: string } | { problems: SaveProblem }> {
  const stages = normaliseStages(template.stages)
  const problems = validateTemplate(stages)
  if (problems.length > 0) return { problems }

  let id = template.id
  if (id) {
    const { error } = await supabase.from('workflow_template')
      .update({ name: template.name.trim(), updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    const { error: delErr } = await supabase.from('workflow_template_stage').delete().eq('template_id', id)
    if (delErr) throw delErr
  } else {
    const { data, error } = await supabase.from('workflow_template')
      .insert({ org_id: orgId, name: template.name.trim() }).select('id').single()
    if (error) throw error
    id = (data as { id: string }).id
  }
  if (stages.length === 0) return { id }

  const ids = stages.map(() => crypto.randomUUID())
  const { error: insErr } = await supabase.from('workflow_template_stage').insert(stages.map((s, i) => ({
    id: ids[i], org_id: orgId, template_id: id, stage_key: s.stageKey, position: s.position, task: s.task,
    optional: s.optional, default_on: s.defaultOn, only_if: [...s.onlyIf], orderer: s.orderer, pay_role: s.payRole,
  })))
  if (insErr) throw insErr
  const people = stages.flatMap((s, i) => s.people.map(p => ({ template_stage_id: ids[i], profile_id: p, org_id: orgId })))
  if (people.length > 0) {
    const { error } = await supabase.from('workflow_template_stage_person').insert(people)
    if (error) throw error
  }
  return { id }
}

/** Take a template out of use. Jobs made from it keep their own stages. The default one cannot go. */
export async function archiveTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('workflow_template')
    .update({ archived_at: new Date().toISOString() }).eq('id', id).eq('is_default', false)
  if (error) throw error
}

// ─── The clinic's fall-back people per stage (clinic_stage_default) ──────────

/** stage key → people, from the rows. Pure. */
export function defaultsFromRows(rows: readonly { stage_key: string; profile_id: string }[] | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const r of rows ?? []) (out[r.stage_key] ??= []).push(r.profile_id)
  return out
}

export async function fetchStageDefaults(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from('clinic_stage_default').select('stage_key, profile_id')
  if (error) {
    if (templatesUnavailable(error)) return {}
    throw error
  }
  return defaultsFromRows(data as { stage_key: string; profile_id: string }[])
}

/** One stage's default people, replaced. */
export async function saveStageDefault(orgId: string, stageKey: string, people: readonly string[]): Promise<void> {
  const { error } = await supabase.from('clinic_stage_default').delete().eq('org_id', orgId).eq('stage_key', stageKey)
  if (error) throw error
  const rows = [...new Set(people)].map(p => ({ org_id: orgId, stage_key: stageKey, profile_id: p }))
  if (rows.length === 0) return
  const { error: insErr } = await supabase.from('clinic_stage_default').insert(rows)
  if (insErr) throw insErr
}
