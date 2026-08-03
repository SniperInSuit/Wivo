/**
 * Auto-update toast.
 *
 * Production (packaged .exe): electron-updater downloads from GitHub Releases.
 * Dev mode: git fetch/pull via IPC.
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, X, Download, Loader2, Check } from 'lucide-react'
import { useAppVersion } from '../hooks/useAppVersion'

export function UpdateBanner() {
  const {
    running, available, hasUpdate,
    // Dev
    remoteAvailable, pulling, pullDone, pullAndRestart,
    // Production
    updateVersion, downloading, downloaded, downloadAndInstall, installNow,
    // Generic
    restart
  } = useAppVersion()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const show = hasUpdate && dismissed !== (available ?? 'remote')

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-4 right-4 z-[70] card p-3.5 w-[340px] border border-accent/30"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
              {(pullDone || downloaded)
                ? <Check size={15} className="text-emerald-500" />
                : <Download size={15} className="text-accent" />
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {pullDone || downloaded ? 'Uuendatud!' : 'Uus versioon saadaval'}
              </p>
              <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                {downloaded ? (
                  <>Versioon <strong className="text-ink tabular-nums">{updateVersion}</strong> on alla laaditud. Taaskäivita, et kasutada.</>
                ) : pullDone ? (
                  <>Kood uuendatud. Taaskäivita rakendus.</>
                ) : available ? (
                  <>Töötab <span className="tabular-nums">{running}</span> → <strong className="text-ink tabular-nums">{available}</strong></>
                ) : (
                  <>Uuem versioon on saadaval.</>
                )}
              </p>
            </div>
            <button
              onClick={() => setDismissed(available ?? 'remote')}
              className="p-1 rounded text-ink-faint hover:text-ink transition-colors flex-shrink-0"
            >
              <X size={13} />
            </button>
          </div>

          {/* Production: download → install */}
          {updateVersion && !downloaded && (
            <button
              onClick={downloadAndInstall}
              disabled={downloading}
              className="btn-primary w-full justify-center mt-2.5 disabled:opacity-50"
            >
              {downloading
                ? <><Loader2 size={13} className="animate-spin" /> Laadin alla…</>
                : <><Download size={13} /> Lae alla ja uuenda</>
              }
            </button>
          )}

          {/* Production: downloaded, ready to install */}
          {downloaded && (
            <button
              onClick={installNow}
              className="btn-primary w-full justify-center mt-2.5"
            >
              <RefreshCw size={13} /> Taaskäivita ja uuenda
            </button>
          )}

          {/* Dev: git pull + restart */}
          {!updateVersion && !downloaded && remoteAvailable && (
            <button
              onClick={pullAndRestart}
              disabled={pulling}
              className="btn-primary w-full justify-center mt-2.5 disabled:opacity-50"
            >
              {pulling
                ? <><Loader2 size={13} className="animate-spin" /> Tõmban uuendust…</>
                : <><Download size={13} /> Uuenda automaatselt</>
              }
            </button>
          )}

          {/* Dev: pull done, restart */}
          {pullDone && !downloaded && (
            <button
              onClick={restart}
              className="btn-primary w-full justify-center mt-2.5"
            >
              <RefreshCw size={13} /> Taaskäivita
            </button>
          )}

          {/* Disk-only update (manual git pull already done) */}
          {!updateVersion && !remoteAvailable && !pullDone && available && (
            <button
              onClick={restart}
              className="btn-primary w-full justify-center mt-2.5"
            >
              <RefreshCw size={13} /> Taaskäivita
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
