/**
 * The wizard's answers that the job's workflow reads (docs/WORKFLOW-STAGES.md
 * §2.3–2.5), as the columns they are written to (sql/122), plus the switches.
 *
 * Two things are decided here, once, and tested:
 *
 *  1. THE MODEL FLAG. `jobs.mudel` is what the pay engine reads for the model
 *     line (docs/WORKFLOW-STAGES.md §10, "2c"), `jobs.printed_model` is what the
 *     `printed_model` rule reads. The form has ONE question about the model (the
 *     "Model" switch), so both columns follow it: they can never disagree,
 *     and a "model" stage never appears on a job that pays no model.
 *  2. THE IMPLANT COUNT is counted from the teeth marked as implants, once per
 *     tooth over the whole job, never asked twice. Nothing marked: 0.
 */
import type { NewJobState } from '@shared/wizard'
import type { JobFacts } from '@shared/workflow/workflow'
import { implantTeeth, type WorkItem } from '@/types/job'

export interface WorkflowJobFields {
  template_id: string | null
  impression_type: 'digital' | 'conventional' | null
  implant_count: number
  production_method: 'print' | 'mill' | null
  printed_model: boolean
}

/** Teeth marked as implants on the job, each counted once. */
export function implantsOnJob(items: readonly Pick<WorkItem, 'implantaadid' | 'hambad'>[]): number {
  return new Set(items.flatMap(i => implantTeeth(i))).size
}

/** `jobs.mudel` and `jobs.printed_model` for this state: one answer, two columns. */
export const hasPrintedModel = (state: Pick<NewJobState, 'model'>): boolean => state.model

export function workflowJobFields(
  state: Pick<NewJobState, 'templateId' | 'impressionType' | 'productionMethod' | 'model'>,
  items: readonly Pick<WorkItem, 'implantaadid' | 'hambad'>[],
): WorkflowJobFields {
  return {
    template_id: state.templateId,
    impression_type: state.impressionType,
    implant_count: implantsOnJob(items),
    production_method: state.productionMethod,
    printed_model: hasPrintedModel(state),
  }
}

/** The facts the §2.5 rules read, from the same answers (for the preview of the job's stages). */
export function jobFactsOf(
  state: Pick<NewJobState, 'impressionType' | 'productionMethod' | 'model'>,
  items: readonly Pick<WorkItem, 'implantaadid' | 'hambad'>[],
): JobFacts {
  return {
    impressionType: state.impressionType,
    implantCount: implantsOnJob(items),
    productionMethod: state.productionMethod,
    printedModel: hasPrintedModel(state),
  }
}

/**
 * The switches as sent to create_job: one explicit true/false per switch stage
 * of the chosen template (what is on screen), never "whatever the default is
 * today". Keys of stages the template does not have are dropped.
 */
export function switchesToSend(
  stages: readonly { stageKey: string; optional: boolean; defaultOn: boolean }[],
  chosen: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const s of stages) if (s.optional) out[s.stageKey] = chosen[s.stageKey] ?? s.defaultOn
  return out
}
