/**
 * Version, and a button that forces a check.
 *
 * Updates apply by themselves; this exists for the support call. "Press this
 * and tell me what it says" is the only way to tell a machine that is quietly
 * stuck from one that simply has nothing to do — and with people in two
 * buildings, that call will happen.
 */
import { RefreshCw, ArrowUpCircle, Check, AlertTriangle } from 'lucide-react'
import { useUpdate } from '../../providers/UpdateProvider'

export function UpdateSection() {
  const { running, state, checkNow, installNow } = useUpdate()

  const line = (): { icon: JSX.Element; text: string } => {
    switch (state.stage) {
      case 'checking':
        return { icon: <RefreshCw size={12} className="animate-spin text-accent" />, text: 'Kontrollin…' }
      case 'available':
        return { icon: <ArrowUpCircle size={12} className="text-accent" />, text: `Leitud ${state.version}` }
      case 'downloading':
        return {
          icon: <ArrowUpCircle size={12} className="text-accent" />,
          text: `Laadin alla ${state.version} — ${state.percent}%`,
        }
      case 'ready':
        return {
          icon: <Check size={12} className="text-emerald-600" />,
          text: `${state.version} on valmis ja rakendub järgmisel käivitamisel`,
        }
      case 'installing':
        return { icon: <RefreshCw size={12} className="animate-spin text-accent" />, text: 'Paigaldan…' }
      case 'failed':
        return { icon: <AlertTriangle size={12} className="text-amber-500" />, text: state.message }
      default:
        return { icon: <Check size={12} className="text-ink-faint" />, text: 'Uusim versioon' }
    }
  }
  const s = line()

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <ArrowUpCircle size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">Uuendused</h3>
      </div>
      <p className="text-xs text-ink-faint mb-3 max-w-xl leading-relaxed">
        Wivo uuendab end ise: uus versioon laaditakse taustal alla ja rakendub
        järgmisel käivitamisel. Käsitsi midagi paigaldada ei ole vaja.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-ink">
          Versioon <strong className="tabular-nums">{running}</strong>
        </span>
        <button
          type="button"
          onClick={checkNow}
          disabled={state.stage === 'checking' || state.stage === 'downloading'}
          className="btn-ghost text-xs border border-ink-faint/25 flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={11} /> Kontrolli uuendusi
        </button>
        {state.stage === 'ready' && (
          <button
            type="button"
            onClick={installNow}
            className="btn-ghost text-xs border border-accent/40 text-accent flex items-center gap-1.5"
          >
            Taaskäivita ja uuenda
          </button>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-ink-muted mt-2">
        {s.icon} {s.text}
      </p>
    </section>
  )
}
