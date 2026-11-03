/**
 * Photo straight onto a job (spec, Phase 1b). The picture is taken INSIDE the
 * app — the camera stream is drawn to a canvas and turned into a JPEG — so it
 * never passes through the phone's camera app and never lands in its gallery.
 * A canvas JPEG has no EXIF at all (so no GPS); the caller still sends it
 * through the same upload queue as on the desktop (cleanForUpload,
 * database-assigned name). `single`: one photo, then close (a chat message).
 *
 * Without camera access (permission refused, old browser) the fallback is the
 * browser's own capture input. That also does not save to the gallery on
 * iPhone or with Android's default handling; RUN-2.md lists the phones to
 * check, as the spec's acceptance asks.
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import { useHoldRestart } from '../lib/restartGuard'

const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/\D/g, '')

export function PhoneCamera({ onFile, onClose, single = false }: { onFile: (file: File) => void; onClose: () => void; single?: boolean }) {
  // A reload to update waits while the camera is open (lib/restartGuard).
  useHoldRestart()
  const video = useRef<HTMLVideoElement>(null)
  const fallback = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'starting' | 'live' | 'fallback'>('starting')
  const [taken, setTaken] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
        setState('live')
      } catch {
        if (!cancelled) setState('fallback')
      }
    })()
    return () => { cancelled = true; stream?.getTracks().forEach(tr => tr.stop()) }
  }, [])

  function store(file: File) {
    onFile(file)
    setTaken(n => n + 1)
    if (single) onClose()
  }

  async function shoot() {
    const v = video.current
    if (!v || !v.videoWidth) return
    setBusy(true)
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.9))
    setBusy(false)
    if (blob) store(new File([blob], `photo-${stamp()}.jpg`, { type: 'image/jpeg' }))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label={t('mobile.camera')}>
      <div className="flex items-center gap-3 px-3 pb-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <span className="text-sm">{taken > 0 ? t('mobile.photosAdded', { n: taken }) : t('mobile.cameraHint')}</span>
        <button type="button" onClick={onClose} aria-label={t('mobile.done')}
          className="ml-auto rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">
          {t('mobile.done')}
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className={`h-full w-full object-contain ${state === 'live' ? '' : 'hidden'}`} />
        {state === 'starting' && <div className="absolute inset-0 grid place-items-center"><Loader2 className="animate-spin" /></div>}
        {state === 'fallback' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="space-y-4">
              <p className="text-sm text-white/80">{t('mobile.cameraFallback')}</p>
              <button type="button" onClick={() => fallback.current?.click()}
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-black">
                {t('mobile.takePhoto')}
              </button>
            </div>
          </div>
        )}
        <input ref={fallback} type="file" accept="image/*" capture="environment" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) store(f); e.target.value = '' }} />
      </div>

      {state === 'live' && (
        <div className="flex items-center justify-center px-6 pt-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => void shoot()} disabled={busy} aria-label={t('mobile.takePhoto')}
            className="grid place-items-center rounded-full border-4 border-white disabled:opacity-50" style={{ height: 72, width: 72 }}>
            {busy ? <Loader2 className="animate-spin" /> : <Camera />}
          </button>
        </div>
      )}
    </div>
  )
}
