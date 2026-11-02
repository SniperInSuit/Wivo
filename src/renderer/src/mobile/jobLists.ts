/**
 * The phone's home lists (spec, Phase 1b: "my jobs (assigned or active) and
 * search by code"). Pure, so the rules are tested (jobLists.test.ts).
 */
import type { Job } from '../types/job'
import type { PartnerJob } from '../hooks/usePartners'

export interface PhoneJobItem {
  kind: 'own' | 'partner'
  id: string
  code: string | null
  /** Own jobs: the patient name (our own data). Shared jobs: the owner organisation — never a patient. */
  title: string
  work: string | null
  stage: string
  due: string | null
}

const isMine = (j: Job, me: string) =>
  j.assigned_to === me || j.designed_by === me || (j.work_items ?? []).some(w => w.designed_by === me)

/** Earliest deadline first; no deadline last. */
const byDue = (a: PhoneJobItem, b: PhoneJobItem) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999')

export function phoneLists(args: {
  jobs: Job[]
  shared: PartnerJob[]
  me: string
  doneStage: string
  query: string
}): { mine: PhoneJobItem[]; active: PhoneJobItem[]; shared: PhoneJobItem[] } {
  const q = args.query.trim().toLowerCase()
  const own = args.jobs
    .filter(j => j.status !== args.doneStage)
    .map((j): PhoneJobItem & { mine: boolean } => ({
      kind: 'own', id: j.id, code: j.job_code ?? null, title: j.patsient || '—',
      work: j.too, stage: j.status, due: j.valmis_aeg, mine: isMine(j, args.me),
    }))
  const shared = args.shared.map((s): PhoneJobItem => ({
    kind: 'partner', id: s.job_id, code: s.job_code, title: s.owner_org_name,
    work: s.work_type, stage: s.status, due: s.due_at,
  }))
  // Search: the job code always; the patient name only on our own jobs.
  const hit = (i: PhoneJobItem) => !q || (i.code ?? '').toLowerCase().includes(q)
    || (i.kind === 'own' && i.title.toLowerCase().includes(q))
  const strip = ({ mine: _m, ...rest }: PhoneJobItem & { mine?: boolean }): PhoneJobItem => rest
  return {
    mine: own.filter(i => i.mine && hit(i)).map(strip).sort(byDue),
    active: own.filter(hit).map(strip).sort(byDue),
    shared: shared.filter(hit).sort(byDue),
  }
}
