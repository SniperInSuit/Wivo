/**
 * "A newer version is on disk — restart to use it."
 *
 * Deliberately a corner toast rather than a modal: an update is never urgent
 * enough to interrupt someone mid-invoice, and a dialog that blocks the screen
 * would be dismissed on reflex without being read.
 *
 * It can be dismissed, and it comes back for the NEXT version — dismissing says
 * "not now", not "never tell me again".
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'
import { useAppVersion } from '../hooks/useAppVersion'

export function UpdateBanner() {
  const { running, available, hasUpdate, restart } = useAppVersion()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const show = hasUpdate && dismissed !== available

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-4 right-4 z-[70] card p-3.5 w-[320px] border border-accent/30"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw size={15} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Uus versioon saadaval</p>
              <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                Töötab <span className="tabular-nums">{running}</span>, saadaval on{' '}
                <strong className="text-ink tabular-nums">{available}</strong>.
                Taaskäivitamine ei kaota salvestatud tööd.
              </p>
            </div>
            <button
              onClick={() => setDismissed(available)}
              className="p-1 rounded text-ink-faint hover:text-ink transition-colors flex-shrink-0"
              title="Peida — tuletan järgmise versiooni juures uuesti meelde"
            >
              <X size={13} />
            </button>
          </div>

          <button
            onClick={() => void restart()}
            className="btn-primary w-full justify-center mt-2.5"
          >
            <RefreshCw size={13} /> Taaskäivita
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
