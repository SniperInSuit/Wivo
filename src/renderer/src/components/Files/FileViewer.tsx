/**
 * A job's image or PDF, large, over everything (desktop and phone).
 *
 * - Images: arrows, the arrow keys or a swipe move between the job's images;
 *   zoom with + and −, the mouse wheel, a double click or two fingers; drag
 *   to look around a zoomed image.
 * - A PDF: the browser's own PDF viewer, in a frame.
 * - Download, and close with Esc, the × or a click/tap outside the file.
 *
 * Every file is fetched with the same signed, audited, short-lived link as a
 * download (lib/fileLink), when it is shown and not before.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { fileDownloadUrl, filePdfObjectUrl } from '../../lib/fileLink'
import { clampPan, clampZoom, stepIndex, swipeDirection, viewKind, zoomStep, MIN_ZOOM } from '../../lib/fileViewer'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

export interface ViewerFile { id: string; file_name: string }

interface Props {
  /** The images to move between, or the one PDF. */
  files: ViewerFile[]
  start: number
  onClose: () => void
  onDownload: (f: ViewerFile) => void
}

export function FileViewer({ files, start, onClose, onDownload }: Props) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), Math.max(0, files.length - 1)))
  const file = files[index]
  const kind = file ? viewKind(file.file_name) : null
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const stage = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const many = kind === 'image' && files.length > 1

  const go = useCallback((step: -1 | 1) => setIndex(i => stepIndex(i, files.length, step)), [files.length])

  // The link for the file on screen, fetched when it is shown.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    let objectUrl: string | null = null
    setUrl(null)
    setError(null)
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
    const load = kind === 'pdf' ? filePdfObjectUrl(file.id, file.file_name) : fileDownloadUrl(file.id, file.file_name)
    load.then(
      u => { if (kind === 'pdf') objectUrl = u; if (cancelled) { if (objectUrl) URL.revokeObjectURL(objectUrl) } else setUrl(u) },
      e => { if (!cancelled) setError(describeError(e)) },
    )
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [file, kind])

  const frame = () => ({ w: stage.current?.clientWidth ?? 0, h: stage.current?.clientHeight ?? 0 })
  const setZoomKeepingPan = useCallback((z: number) => {
    const next = clampZoom(z)
    setZoom(next)
    setPan(p => clampPan(p, next, frame()))
  }, [])

  // Keys, focus and no page scroll behind, while open.
  useEffect(() => {
    dialog.current?.focus()
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (many && e.key === 'ArrowLeft') go(-1)
      else if (many && e.key === 'ArrowRight') go(1)
      else if (kind === 'image' && (e.key === '+' || e.key === '=')) setZoomKeepingPan(zoomStep(zoom, 1))
      else if (kind === 'image' && e.key === '-') setZoomKeepingPan(zoomStep(zoom, -1))
      else if (kind === 'image' && e.key === '0') { setZoom(MIN_ZOOM); setPan({ x: 0, y: 0 }) }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = before }
  }, [onClose, go, many, kind, zoom, setZoomKeepingPan])

  // Pointers: drag to pan when zoomed, two fingers to zoom, one quick finger to swipe.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ startX: number; startY: number; pan: { x: number; y: number }; pinch: number | null; zoom: number; moved: boolean } | null>(null)

  function onPointerDown(e: React.PointerEvent) {
    // Buttons keep their own clicks. No pointer capture: it would send a tap on
    // the image or a button to the stage, which reads as "outside" and closes.
    if (kind !== 'image' || (e.target as HTMLElement).closest('button')) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    gesture.current = {
      startX: e.clientX, startY: e.clientY, pan, zoom,
      pinch: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null,
      moved: gesture.current?.moved ?? false,
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    if (pts.length === 2 && g.pinch) {
      g.moved = true
      setZoomKeepingPan(g.zoom * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.pinch)
    } else if (pts.length === 1 && zoom > MIN_ZOOM) {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
      setPan(clampPan({ x: g.pan.x + dx, y: g.pan.y + dy }, zoom, frame()))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current
    const wasPinch = pointers.current.size > 1 || g?.pinch != null
    pointers.current.delete(e.pointerId)
    if (!g || pointers.current.size > 0) return
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY
    if (!wasPinch && many) {
      const dir = swipeDirection(dx, dy, zoom)
      if (dir !== 0) { g.moved = true; go(dir) }
    }
    // Keep `moved` until the click that follows this pointer-up has been seen.
    setTimeout(() => { gesture.current = null }, 0)
  }

  /** A click on the space around the file closes; one that ended a drag or swipe does not. */
  function onStageClick(e: React.MouseEvent) {
    if (gesture.current?.moved) return
    if (e.target === e.currentTarget) onClose()
  }

  const button = 'rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:opacity-40'

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={file?.file_name ?? ''} tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 outline-none"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center gap-2 px-3 py-2 text-white">
        <span className="truncate text-sm font-mono">{file?.file_name}</span>
        {many && <span className="text-xs text-white/60 tabular-nums">{index + 1} / {files.length}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {kind === 'image' && (
            <>
              <button type="button" className={button} onClick={() => setZoomKeepingPan(zoomStep(zoom, -1))} disabled={zoom <= MIN_ZOOM}
                aria-label={t('files.zoomOut')} title={t('files.zoomOut')}><ZoomOut size={16} /></button>
              <button type="button" className={button} onClick={() => setZoomKeepingPan(zoomStep(zoom, 1))}
                aria-label={t('files.zoomIn')} title={t('files.zoomIn')}><ZoomIn size={16} /></button>
            </>
          )}
          {file && (
            <button type="button" className={button} onClick={() => onDownload(file)}
              aria-label={t('files.download')} title={t('files.download')}><Download size={16} /></button>
          )}
          <button type="button" className={button} onClick={onClose}
            aria-label={t('files.closeViewer')} title={t('files.closeViewer')}><X size={16} /></button>
        </span>
      </div>

      <div ref={stage} className="relative flex-1 overflow-hidden flex items-center justify-center"
        style={{ touchAction: kind === 'image' ? 'none' : 'auto' }}
        onClick={onStageClick}
        onWheel={e => { if (kind === 'image') setZoomKeepingPan(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {error ? (
          <p role="alert" className="max-w-sm text-center text-sm text-white/80">{t('files.couldNotOpen')} {error}</p>
        ) : !url ? (
          <Loader2 size={24} className="animate-spin text-white/70" aria-label={t('files.opening')} />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={file?.file_name ?? ''} className="h-full w-full max-w-5xl bg-white" />
        ) : (
          <img src={url} alt={file?.file_name ?? ''} draggable={false}
            onDoubleClick={() => { if (zoom > MIN_ZOOM) { setZoom(MIN_ZOOM); setPan({ x: 0, y: 0 }) } else setZoomKeepingPan(2.5) }}
            className="max-h-full max-w-full select-none object-contain"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: gesture.current ? 'none' : 'transform 120ms ease-out',
              cursor: zoom > MIN_ZOOM ? 'grab' : 'zoom-in',
            }} />
        )}

        {many && (
          <>
            <button type="button" className={`${button} absolute left-3 top-1/2 -translate-y-1/2`} onClick={() => go(-1)}
              aria-label={t('files.previous')} title={t('files.previous')}><ChevronLeft size={22} /></button>
            <button type="button" className={`${button} absolute right-3 top-1/2 -translate-y-1/2`} onClick={() => go(1)}
              aria-label={t('files.next')} title={t('files.next')}><ChevronRight size={22} /></button>
          </>
        )}
      </div>
    </div>
  )
}
