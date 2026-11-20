import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { fetchStageDefaults, fetchTemplates, type TemplateRow } from '../lib/workflowTemplates'

export const TEMPLATES_KEY = ['workflow_templates'] as const
export const STAGE_DEFAULTS_KEY = ['clinic_stage_default'] as const

/**
 * The clinic's workflow templates (docs/WORKFLOW-STAGES.md §2), default first.
 * Empty on a database without sql/122, and for a person the database does not
 * let read them (jobs.read, jobs.write or pipeline.write): the form then simply
 * has no template to offer, and the job is made from the default one.
 */
export function useWorkflowTemplates() {
  const { clinicId } = useAuth()
  return useQuery<TemplateRow[]>({
    queryKey: [...TEMPLATES_KEY, clinicId],
    enabled: !!clinicId,
    staleTime: 60_000,
    queryFn: fetchTemplates,
  })
}

/** clinic_stage_default: stage key → the people a stage falls back to. */
export function useStageDefaults() {
  const { clinicId } = useAuth()
  return useQuery<Record<string, string[]>>({
    queryKey: [...STAGE_DEFAULTS_KEY, clinicId],
    enabled: !!clinicId,
    staleTime: 60_000,
    queryFn: fetchStageDefaults,
  })
}
