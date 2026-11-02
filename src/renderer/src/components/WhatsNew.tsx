/**
 * "What's new": the release notes (lib/releaseNotes.ts) in a large dialog.
 *
 * It opens by itself the first time someone, signed in, uses a version that
 * has notes: once per person per version, on whichever device comes first.
 * After that it opens from the menu (the sidebar footer on the desktop,
 * Settings on the phone).
 *
 * "Seen" lives in the person's Supabase user metadata, so the desktop and the
 * phone agree and no migration is needed, and is cached in localStorage so a
 * person who has seen the notes costs no request. Only the automatic opening
 * marks the notes seen; reading them again from the menu changes nothing.
 */
import { useCallback, useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { NOTE_VERSIONS, notesVersionFor, notesUnseen, releaseNotes, shortVersion } from '../lib/releaseNotes'
import { RichText } from './ui/RichText'
import { t, lang } from '@/lib/i18n'

/** The user-metadata field; the local cache is `<SEEN_KEY>:<user id>`. */
const SEEN_KEY = 'wivo_notes_seen'

function readLocal(userId: string): string | null {
  try { return localStorage.getItem(`${SEEN_KEY}:${userId}`) } catch { return null }
}
function writeLocal(userId: string, version: string): void {
  try { localStorage.setItem(`${SEEN_KEY}:${userId}`, version) } catch { /* storage refused: asks the server next time */ }
}

export function useWhatsNew(running: string): {
  /** Opens the notes from the menu; null when this version has none. */
  open: (() => void) | null
  dialog: React.ReactNode
} {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const due = notesVersionFor(running)
  // In development the menu also offers notes written for a version not
  // released yet, so they can be read before the version bump.
  const menuVersion = due ?? (import.meta.env.DEV ? NOTE_VERSIONS[NOTE_VERSIONS.length - 1] ?? null : null)
  const [shown, setShown] = useState<{ version: string; auto: boolean } | null>(null)

  useEffect(() => {
    if (!userId || !due || !notesUnseen(due, readLocal(userId))) return
    let cancelled = false
    // From the server, not the session's copy of the user: that copy can
    // predate the other device marking the notes seen.
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      const raw: unknown = data.user?.user_metadata?.[SEEN_KEY]
      const seen = typeof raw === 'string' ? raw : null
      if (notesUnseen(due, seen)) setShown({ version: due, auto: true })
      else if (seen) writeLocal(userId, seen)
    }, () => { /* offline: asked again at the next start */ })
    return () => { cancelled = true }
  }, [userId, due])

  const close = useCallback(() => {
    if (shown?.auto && userId) {
      writeLocal(userId, shown.version)
      void supabase.auth.updateUser({ data: { [SEEN_KEY]: shown.version } }).then(() => {}, () => {})
    }
    setShown(null)
  }, [shown, userId])

  return {
    open: menuVersion ? () => setShown({ version: menuVersion, auto: false }) : null,
    dialog: shown ? <WhatsNewDialog version={shown.version} onClose={close} /> : null,
  }
}

/** Full screen on a phone, a large centred dialog on the desktop. */
function WhatsNewDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const notes = releaseNotes(version, lang)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!notes) return null

  return (
    // no-drag: the sidebar's window-drag strip would otherwise take clicks
    // meant for the backdrop above it.
    <div
      role="dialog" aria-modal="true" aria-labelledby="whats-new-title"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/40 sm:items-center sm:p-6 [-webkit-app-region:no-drag]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex w-full flex-col bg-bg-card shadow-panel sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl"
      >
        <header
          className="flex items-start gap-3 border-b border-ink-faint/15 px-5 pb-4 sm:px-7"
          style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
        >
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              {t('whatsNew.kicker', { version: shortVersion(version) })}
            </p>
            <h2 id="whats-new-title" className="text-xl font-bold text-ink">{notes.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('whatsNew.close')} className="rounded-lg p-1.5 text-ink-muted hover:bg-bg-sidebar hover:text-ink">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-7">
          {notes.blocks.map((b, i) =>
            b.kind === 'heading' ? (
              <h3 key={i} className="pt-2 text-base font-semibold text-ink"><RichText text={b.text} /></h3>
            ) : b.kind === 'list' ? (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
                {b.items.map((item, j) => <li key={j}><RichText text={item} /></li>)}
              </ul>
            ) : (
              <p key={i} className="text-sm leading-relaxed text-ink-soft"><RichText text={b.text} /></p>
            ))}
        </div>

        <footer
          className="flex justify-end border-t border-ink-faint/15 px-5 pt-3 sm:px-7"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button type="button" onClick={onClose} autoFocus className="btn-primary w-full justify-center sm:w-auto">
            {t('whatsNew.gotIt')}
          </button>
        </footer>
      </div>
    </div>
  )
}
