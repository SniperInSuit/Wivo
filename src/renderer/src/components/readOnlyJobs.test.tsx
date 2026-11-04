/**
 * A member who sees a job but lacks Edit jobs sees it read only: nothing to
 * press that the database would refuse (no new job or import, no dragging or
 * stage arrows, no note added or deleted, no file added, replaced or
 * deleted). With Edit jobs, all of it is there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Job } from '../types/job'
import { t } from '@/lib/i18n'

let canEdit = false
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (p: string) => (p === 'jobs.write' ? canEdit : false), sees: () => true }),
}))
vi.mock('../stores/useSettings', () => ({ useSettings: () => ({ settings: {} }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ displayName: 'Kevin Test', signOut: () => {} }) }))
vi.mock('../context/PipelineContext', () => ({ usePipeline: () => ({ doneStageKey: 'valmis', stages: [] }) }))
vi.mock('../hooks/useJobs', () => ({ useUpdateJob: () => ({ isPending: false, mutateAsync: async () => {} }) }))
vi.mock('../lib/sound', () => ({ playSound: () => {} }))
vi.mock('./ImportCSVButton', () => ({ ImportCSVButton: () => <span>IMPORT</span> }))
vi.mock('./NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('./JobSearchBox', () => ({ JobSearchBox: () => null }))
vi.mock('./Board/JobCard', () => ({
  JobCard: ({ onStageChange }: { onStageChange?: unknown }) => <span>{onStageChange ? 'ARROWS' : 'NO-ARROWS'}</span>,
}))
vi.mock('./Board/RevisionBoardCard', () => ({ RevisionBoardCard: () => null }))
vi.mock('./Board/MergedValmisCard', () => ({ MergedValmisCard: () => null }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'job_files'
      ? [{ id: 'f1', job_id: 'j1', type: 'design', version: 1, supersedes: null, is_active: true, completed: true, size: 10,
           mime_type: 'model/stl', file_name: 'TAL-26-0001_design_v1.stl', uploaded_at: '2026-11-04T10:00:00Z',
           uploaded_by_name: 'Mari', uploaded_by_org_name: null }]
      : undefined,
    error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/uploadQueue', () => ({
  enqueueUpload: () => {}, retryUpload: () => {}, dismissUpload: () => {}, useJobUploads: () => [], onUploadDone: () => () => {},
}))

const { TopBar } = await import('./TopBar')
const { BoardColumn } = await import('./Board/BoardColumn')
const { JobNotesPanel } = await import('./JobDetail/JobNotesPanel')
const { JobFiles } = await import('./Files/JobFiles')

const job = {
  id: 'j1', status: 'disain', job_code: 'TAL-26-0001', patsient: 'X', revisions: [], work_items: [],
  markused: [{ id: 'n1', ts: '2026-11-04T10:00:00Z', autor: 'Mari', tekst: 'Kontakt tihedam' }],
} as unknown as Job

beforeEach(() => { canEdit = false })

const bar = (onNewJob?: () => void) => renderToStaticMarkup(
  <TopBar search="" onSearchChange={() => {}} onOpenJob={() => {}} onNewJob={onNewJob} onImportDone={() => {}} />)
const column = (onStageChange?: () => void) => renderToStaticMarkup(
  <BoardColumn stage={{ key: 'disain', label: 'Disain', hex: '#000' } as never}
    entries={[{ type: 'job', job } as never]} onJobClick={() => {}} onStageChange={onStageChange} />)

describe('without Edit jobs: read only', () => {
  it('no "New job" and no CSV import', () => {
    const html = bar(undefined)
    expect(html).not.toContain(t('topBar.newJob'))
    expect(html).not.toContain('IMPORT')
  })

  it('the board: cards do not drag, no stage arrows', () => {
    const html = column(undefined)
    expect(html).toContain('draggable="false"')
    expect(html).toContain('NO-ARROWS')
  })

  it('notes: shown, but no "Add note" and no delete', () => {
    const html = renderToStaticMarkup(<JobNotesPanel job={job} />)
    expect(html).toContain('Kontakt tihedam')
    expect(html).not.toContain(t('jobDetail.addNote'))
    expect(html).not.toContain(t('jobDetail.deleteNote'))
  })

  it('files: listed and downloadable; no adding, new version or delete', () => {
    const html = renderToStaticMarkup(<JobFiles jobId="j1" />)
    expect(html).toContain('TAL-26-0001_design_v1.stl')
    expect(html).toContain(t('files.download'))
    expect(html).not.toContain(t('files.addFiles'))
    expect(html).not.toContain(t('files.newVersion'))
    expect(html).not.toContain(t('files.delete'))
  })
})

describe('with Edit jobs: all of it', () => {
  it('"New job", import, dragging, stage arrows, notes and files', () => {
    canEdit = true
    expect(bar(() => {})).toContain(t('topBar.newJob'))
    expect(bar(() => {})).toContain('IMPORT')
    const col = column(() => {})
    expect(col).toContain('draggable="true"')
    expect(col).toContain('ARROWS')
    const notes = renderToStaticMarkup(<JobNotesPanel job={job} />)
    expect(notes).toContain(t('jobDetail.addNote'))
    expect(notes).toContain(t('jobDetail.deleteNote'))
    const files = renderToStaticMarkup(<JobFiles jobId="j1" />)
    expect(files).toContain(t('files.addFiles'))
    expect(files).toContain(t('files.newVersion'))
    expect(files).toContain(t('files.delete'))
  })

  it('a partner\'s uploads follow the share, not this permission', () => {
    expect(renderToStaticMarkup(<JobFiles jobId="j1" partner />)).toContain(t('files.addFiles'))
  })
})
