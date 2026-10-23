/**
 * The corner toast.
 *
 * ── It no longer asks for anything ───────────────────────────────────────────
 * It used to have five mutually-exclusive branches, the first of which was a
 * "Lae alla ja uuenda" button: downloads were opt-in. They are not any more —
 * electron-updater fetches in the background and the update applies at the next
 * launch whether anybody presses anything or not. So in production this is
 * NEWS, not a prompt: two states, ready and failed.
 *
 * The restart button is a convenience for somebody who would rather have it now
 * than at lunchtime. Dismissing it changes nothing about whether the update
 * lands — which is the point, with one shared database behind this app and a
 * designer in another building.
 *
 * The development path (git fetch/pull) keeps its own buttons and lives in
 * `useDevGitUpdate`, deliberately apart: conflating the two is how HANDOFF.md
 * ended up claiming for months that this app had no auto-updater.
 */
import { useState } from 'react'
import { ArrowUpCircle, RefreshCw, X, AlertTriangle } from 'lucide-react'
import { useUpdate } from '../providers/UpdateProvider'
import { useDevGitUpdate } from '../hooks/useDevGitUpdate'

export function UpdateBanner() {
  const { running, state, installNow } = useUpdate()
  const dev = useDevGitUpdate()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const devShow = dev.remoteAvailable || dev.diskAvailable !== null || dev.pullDone
  const prodShow = state.stage === 'ready' || state.stage === 'failed'
  // Keyed by what is being announced, so a NEWER update re-announces itself
  // after an older one was waved away.
  const key = state.stage === 'ready' ? state.version : state.stage
  if (!devShow && !prodShow) return null
  if (prodShow && dismissed === key) return null

  const failed = state.stage === 'failed'

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[300px] card p-3 shadow-card">
      <div className="flex items-start gap-2">
        {failed
          ? <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
          : <ArrowUpCircle size={14} className="text-accent flex-shrink-0 mt-0.5" />}

        <div className="min-w-0 flex-1">
          {prodShow && state.stage === 'ready' && (
            <>
              <p className="text-xs font-semibold text-ink">Uuendus on valmis</p>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Versioon {state.version} rakendub, kui Wivo järgmine kord käivitad.
              </p>
              <button
                type="button"
                onClick={installNow}
                className="btn-ghost text-[11px] border border-ink-faint/25 mt-2 flex items-center gap-1.5"
              >
                <RefreshCw size={11} /> Taaskäivita kohe
              </button>
            </>
          )}

          {prodShow && failed && (
            <>
              <p className="text-xs font-semibold text-ink">Uuendus ei õnnestunud</p>
              <p className="text-[11px] text-ink-muted mt-0.5">
                {state.message} Wivo töötab edasi versiooniga {running}.
              </p>
            </>
          )}

          {/* ── Development only ── */}
          {!prodShow && devShow && (
            <>
              <p className="text-xs font-semibold text-ink">
                {dev.pullDone ? 'Uuendus tõmmatud' : 'Uus versioon saadaval'}
              </p>
              <p className="text-[11px] text-ink-muted mt-0.5">
                {dev.pullDone
                  ? 'Taaskäivita rakendus.'
                  : dev.diskAvailable
                    ? `Saadaval ${dev.diskAvailable}, töötab ${running}.`
                    : 'Uuem versioon on saadaval.'}
              </p>
              <button
                type="button"
                disabled={dev.pulling}
                onClick={() => (dev.remoteAvailable ? void dev.pullAndRestart() : dev.restart())}
                className="btn-ghost text-[11px] border border-ink-faint/25 mt-2 flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw size={11} className={dev.pulling ? 'animate-spin' : ''} />
                {dev.pulling ? 'Tõmban…' : dev.remoteAvailable ? 'Uuenda automaatselt' : 'Taaskäivita'}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setDismissed(key)}
          className="p-0.5 text-ink-faint hover:text-ink flex-shrink-0"
          title="Peida"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
