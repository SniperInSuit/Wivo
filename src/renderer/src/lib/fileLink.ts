/**
 * A download link for a job file. Preferably from the `file-link` Edge
 * Function, which audits and signs a 60-second link server-side, so the
 * client cannot choose a longer one. Until that function is deployed, the
 * previous path: the audited grant, then a link the client signs.
 */
import { supabase } from './supabase'

export async function fileDownloadUrl(fileId: string, fileName: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('file-link', { body: { fileId } })
  if (!error && typeof data?.url === 'string') return data.url
  // Refused for rights: say so. Any other failure (not deployed, network):
  // fall back to the grant path, which the database still audits.
  if (error && 'context' in error && (error as { context?: Response }).context?.status === 403) {
    throw new Error((data as { error?: string } | null)?.error ?? 'Not allowed')
  }
  const { data: path, error: rpcError } = await supabase.rpc('request_file_download', { p_file: fileId })
  if (rpcError) throw rpcError
  const { data: link, error: linkError } = await supabase.storage.from('job-files').createSignedUrl(path as string, 60, { download: fileName })
  if (linkError || !link) throw linkError ?? new Error('No link')
  return link.signedUrl
}

/** Save a job's file: the same signed, audited link, opened as a download. */
export async function saveFile(fileId: string, fileName: string): Promise<void> {
  const a = document.createElement('a')
  a.href = await fileDownloadUrl(fileId, fileName)
  a.download = fileName
  a.click()
}

/**
 * A PDF to show in the viewer, from the same signed link as a download. That
 * link tells the browser to save the file, which a frame obeys; read into
 * memory first, it displays instead. The caller revokes the address when done.
 */
export async function filePdfObjectUrl(fileId: string, fileName: string): Promise<string> {
  const res = await fetch(await fileDownloadUrl(fileId, fileName))
  if (!res.ok) throw new Error(`${res.status}`)
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'application/pdf' }))
}
