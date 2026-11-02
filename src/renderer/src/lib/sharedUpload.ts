/**
 * Before a file goes onto a job a partner can see (sql/092: a partner never
 * learns who the patient is).
 *
 * fileClean.ts removes what is in a file's data. What it cannot remove — a
 * name printed in a PDF, a face in a photo, a name burned into an X-ray
 * image — only the person adding the file can check, so they are asked first.
 * Only on the owner's side: a partner does not know the patient.
 */
import { supabase } from './supabase'
import { extensionOf, type JobFileType } from './fileClean'
import { t } from './i18n'

export type SharedFileWarning = 'pdf' | 'photo' | 'xray'

export interface OutgoingFile {
  name: string
  type: JobFileType
  mime?: string
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'])

/** What to warn about for these files, each reason once, in a fixed order. */
export function sharedFileWarnings(files: OutgoingFile[]): SharedFileWarning[] {
  const found = new Set<SharedFileWarning>()
  for (const f of files) {
    const ext = extensionOf(f.name)
    const mime = (f.mime ?? '').toLowerCase()
    if (ext === 'pdf' || mime === 'application/pdf') found.add('pdf')
    else if (f.type === 'xray' || ext === 'dcm' || ext === 'dicom') found.add('xray')
    else if (f.type === 'photo' || IMAGE_EXT.has(ext) || mime.startsWith('image/')) found.add('photo')
  }
  return (['pdf', 'photo', 'xray'] as const).filter(w => found.has(w))
}

const TEXT = {
  pdf: 'files.sharedWarnPdf',
  photo: 'files.sharedWarnPhoto',
  xray: 'files.sharedWarnXray',
} as const satisfies Record<SharedFileWarning, string>

/** Is the job shared with a partner right now? A database without sql/070 has no shares. */
async function isJobShared(jobId: string): Promise<boolean> {
  const { count, error } = await supabase.from('job_share')
    .select('id', { count: 'exact', head: true }).eq('job_id', jobId).is('revoked_at', null)
  return !error && (count ?? 0) > 0
}

/**
 * True when the files may go: nothing to warn about, the job is not shared,
 * or the person confirmed after reading why.
 */
export async function confirmSharedUpload(jobId: string, files: OutgoingFile[]): Promise<boolean> {
  const warnings = sharedFileWarnings(files)
  if (warnings.length === 0 || !(await isJobShared(jobId))) return true
  return window.confirm([t('files.sharedWarnIntro'), ...warnings.map(w => t(TEXT[w])), t('files.sharedWarnConfirm')].join('\n\n'))
}
