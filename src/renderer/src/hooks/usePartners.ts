/**
 * Partnerships and shared jobs, through the RPCs in sql/070–071.
 *
 * A partner never reads the owner's tables; everything here is an RPC or the
 * `partner_job_view`, which is why these hooks never call `.from('jobs')`.
 *
 * On a database that has not had sql/070 applied yet, the RPCs do not exist.
 * That is not an error worth showing: there are simply no partners, and every
 * hook here answers with an empty list rather than a red banner.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { jobCodeCandidates, partialCodePattern } from '../lib/jobSearch'

export type PartnerRole = 'design' | 'surgery' | 'supplier'
export type CaseType = 'lab_work' | 'referral'
export type PartnershipStatus = 'awaiting_inviter' | 'awaiting_platform' | 'active' | 'suspended' | 'ended'

export interface PartnerOrg {
  partnership_id: string
  org_id: string
  name: string
  country: string
  status: PartnershipStatus
  share_stock: boolean
  default_visibility: 'partial' | 'full'
  roles: PartnerRole[]
  i_am_inviter: boolean
}

/** What the new-job form asks for when stages go to a partner. */
export interface ShareSpec {
  partnerOrg: string
  caseType: CaseType
  role: PartnerRole
  stages: string[]
  /** "Patient informed and agreed" — required for a referral. */
  consent: boolean
  partnerPrice: number | null
}

/** Why a ShareSpec cannot be sent yet, or null when it can. */
export function shareSpecProblem(spec: ShareSpec): 'partner' | 'stages' | 'consent' | null {
  if (!spec.partnerOrg) return 'partner'
  if (spec.stages.length === 0) return 'stages'
  if (spec.caseType === 'referral' && !spec.consent) return 'consent'
  return null
}

/** A missing function means the migration is not applied yet: no partners. */
const notInstalled = (code: string | undefined): boolean => code === 'PGRST202' || code === '42883'

export function usePartnerOrgs() {
  const { clinicId } = useAuth()
  return useQuery<PartnerOrg[]>({
    queryKey: ['partner_orgs', clinicId],
    enabled: !!clinicId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('partner_orgs')
      if (error) {
        if (notInstalled(error.code)) return []
        throw error
      }
      return (data ?? []) as PartnerOrg[]
    },
  })
}

export async function shareJob(jobId: string, spec: ShareSpec): Promise<void> {
  const { error } = await supabase.rpc('share_job', {
    p_job: jobId,
    p_partner_org: spec.partnerOrg,
    p_case_type: spec.caseType,
    p_role: spec.role,
    p_stages: spec.stages,
    p_visibility: null,
    p_consent: spec.consent,
    p_partner_price: spec.partnerPrice,
  })
  if (error) throw error
}

/** A job shared with us, as `partner_job_view` returns it. */
export interface PartnerJob {
  share_id: string
  job_id: string
  job_code: string
  owner_org: string
  owner_org_name: string
  case_type: CaseType
  visibility: 'partial' | 'full'
  role: PartnerRole
  assigned_stages: string[]
  status: string
  can_move: boolean
  next_stage: string | null
  received_on: string | null
  due_at: string | null
  work_type: string | null
  work_items: { too: string; hambad: string; materjal?: string }[]
  teeth: string | null
  material: string | null
  shade: string | null
  stump_shade: string | null
  description: string | null
  rush: boolean
  model: boolean
  partner_price: number | null
  patient_age: number | null
  patient_sex: string | null
  patient_name: string | null
  patient_phone: string | null
  patient_email: string | null
  open_questions: number
  shared_at: string
  /** Sanitised: no prices, notes or staff (sql/084). */
  revisions: { id: string; status?: string; deadline?: string; hambad?: string; reasons?: string[] }[]
}

export function usePartnerJobs(search: string) {
  const { clinicId } = useAuth()
  return useQuery<PartnerJob[]>({
    queryKey: ['partner_jobs', clinicId, search],
    enabled: !!clinicId,
    queryFn: async () => {
      let q = supabase.from('partner_job_view').select('*').order('due_at', { ascending: true, nullsFirst: false })
      // The code however its dashes were typed (lib/jobSearch); a partner view
      // has no patient, so the code is all there is to search.
      const text = search.trim()
      const codes = jobCodeCandidates(text)
      if (codes.length > 0) q = q.in('job_code', codes)
      else if (text) q = q.ilike('job_code', partialCodePattern(text))
      const { data, error } = await q
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return []
        throw error
      }
      return (data ?? []) as PartnerJob[]
    },
  })
}

/** Opening a shared job is a logged view (both sides' audit logs). */
export async function openPartnerJob(jobId: string): Promise<PartnerJob | null> {
  const { data, error } = await supabase.rpc('open_partner_job', { p_job: jobId })
  if (error) throw error
  return ((data ?? []) as PartnerJob[])[0] ?? null
}

/** A revision's stage, through the same gate (sql/087). */
export function useMoveRevisionStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, revisionId, to }: { jobId: string; revisionId: string; to: string }) => {
      const { error } = await supabase.rpc('move_revision_stage', { p_job: jobId, p_revision: revisionId, p_to: to })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner_jobs'] }),
  })
}

/** The only way a partner moves a stage — and the board's "›" for everyone. */
export function useMoveJobStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, to }: { jobId: string; to: string }) => {
      const { error } = await supabase.rpc('move_job_stage', { p_job: jobId, p_to: to })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner_jobs'] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

// ── Job thread: comments and questions (sql/071, on the chat tables) ───────

export interface ThreadMessage {
  id: string
  body: string
  author_id: string | null
  author_name: string | null
  author_org: string | null
  is_question: boolean
  resolved_at: string | null
  created_at: string
  edited_at: string | null
  mine: boolean
  file_id: string | null
  file_name: string | null
  file_type: string | null
}

/**
 * A job's thread, the same for both sides: the owner organisation (if the
 * member can see the job) and a partner it is shared with.
 */
export function useJobThread(jobId: string | null) {
  return useQuery<ThreadMessage[]>({
    queryKey: ['job_thread', jobId],
    enabled: !!jobId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('job_thread', { p_job: jobId })
      if (error) {
        if (notInstalled(error.code)) return []
        throw error
      }
      return (data ?? []) as ThreadMessage[]
    },
  })
}

export function usePostJobComment(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, isQuestion, fileId = null }: { body: string; isQuestion: boolean; fileId?: string | null }) => {
      const { error } = await supabase.rpc('post_job_comment', { p_job: jobId, p_body: body, p_is_question: isQuestion, p_file: fileId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job_thread', jobId] })
      qc.invalidateQueries({ queryKey: ['open_questions'] })
      qc.invalidateQueries({ queryKey: ['partner_jobs'] })
    },
  })
}

export function useResolveQuestion(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase.rpc('resolve_question', { p_message: messageId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job_thread', jobId] })
      qc.invalidateQueries({ queryKey: ['open_questions'] })
      qc.invalidateQueries({ queryKey: ['partner_jobs'] })
    },
  })
}

/** Job id → open questions, for the flag on the caller's own board cards. */
export function useOpenQuestions() {
  const { clinicId } = useAuth()
  return useQuery<Map<string, number>>({
    queryKey: ['open_questions', clinicId],
    enabled: !!clinicId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('open_questions')
      if (error) {
        if (notInstalled(error.code)) return new Map()
        throw error
      }
      return new Map(((data ?? []) as { job_id: string; open_count: number }[]).map(r => [r.job_id, r.open_count]))
    },
  })
}
