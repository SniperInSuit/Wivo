/**
 * The file viewer's rules (components/Files/FileViewer.tsx), kept free of
 * React so they can be tested: which files open in it, moving between images,
 * zoom limits and what counts as a swipe.
 */

export type ViewKind = 'image' | 'pdf' | null

/** Images every browser (and the desktop app) can draw. HEIC and TIFF are not among them: those download. */
const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i

export function viewKind(fileName: string): ViewKind {
  if (IMAGE.test(fileName.trim())) return 'image'
  if (/\.pdf$/i.test(fileName.trim())) return 'pdf'
  return null
}

/** The neighbour in a list of images, going round at either end. */
export function stepIndex(index: number, count: number, step: -1 | 1): number {
  if (count <= 0) return 0
  return (index + step + count) % count
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 6

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : MIN_ZOOM))
}

/** One press of + or −: a half step at a time, so 1 → 1.5 → 2.25 … */
export function zoomStep(z: number, direction: 1 | -1): number {
  return clampZoom(direction > 0 ? z * 1.5 : z / 1.5)
}

/**
 * The offset of a zoomed image may move at most so far that its edge reaches
 * the edge of the frame: never further, so it cannot be dragged out of sight.
 */
export function clampPan(pan: { x: number; y: number }, zoom: number, frame: { w: number; h: number }): { x: number; y: number } {
  const maxX = Math.max(0, (frame.w * zoom - frame.w) / 2)
  const maxY = Math.max(0, (frame.h * zoom - frame.h) / 2)
  return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) }
}

/**
 * A finished one-finger gesture: −1 = previous, 1 = next, 0 = not a swipe.
 * Mostly sideways and at least 50 px; never while zoomed in (then it pans).
 */
export function swipeDirection(dx: number, dy: number, zoom: number): -1 | 0 | 1 {
  if (zoom > MIN_ZOOM) return 0
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}

interface ListedFile { id: string; file_name: string; is_active: boolean; completed: boolean }

/**
 * What the viewer gets when `f` is clicked: an image opens among the job's
 * current images (in list order), a PDF or an older version opens alone, and
 * anything else does not open at all (it downloads).
 */
export function viewerFor<T extends ListedFile>(f: T, files: T[]): { files: T[]; start: number } | null {
  const kind = viewKind(f.file_name)
  if (!kind) return null
  if (kind === 'image') {
    const images = files.filter(x => x.is_active && x.completed && viewKind(x.file_name) === 'image')
    const at = images.findIndex(x => x.id === f.id)
    if (at >= 0) return { files: images, start: at }
  }
  return { files: [f], start: 0 }
}

/**
 * A chat attachment clicked in a job's thread: an image opens among the
 * thread's image attachments (in the thread's order, each file once), a PDF
 * alone, anything else not at all (it downloads).
 */
export function attachmentViewerFor<T extends { id: string; file_name: string }>(f: T, attachments: T[]): { files: T[]; start: number } | null {
  const kind = viewKind(f.file_name)
  if (!kind) return null
  if (kind === 'pdf') return { files: [f], start: 0 }
  const seen = new Set<string>()
  const images = attachments.filter(a => viewKind(a.file_name) === 'image' && !seen.has(a.id) && seen.add(a.id))
  const at = images.findIndex(a => a.id === f.id)
  return at >= 0 ? { files: images, start: at } : { files: [f], start: 0 }
}
