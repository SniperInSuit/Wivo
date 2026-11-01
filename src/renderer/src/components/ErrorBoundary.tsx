import React from 'react'
import { t } from '@/lib/i18n'

interface State {
  error: Error | null
  componentStack: string | null
  copied: boolean
}

/**
 * Last line of defence against a blank window.
 *
 * React 18 unmounts the entire root when a render or effect throws with no
 * boundary above it — the app goes white with nothing on screen and nothing in
 * the UI to explain it. This app has hit that twice: once from a missing .env
 * throwing at module load, once from a duplicate realtime channel throwing in
 * an effect. Neither was diagnosable without opening devtools.
 *
 * The message alone turned out not to be enough. `Invalid time value` is thrown
 * by date-fns from any of a few dozen call sites and says nothing about which
 * one, so a report of it could not be acted on without a reproduction. The
 * component stack names the component, and it is now on screen and copyable —
 * a user who cannot open devtools can still hand over something actionable.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the stack reachable in devtools even though the UI shows a summary
    console.error('Wivo crashed:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  /** Everything a report needs, in one blob. */
  private report(): string {
    const { error, componentStack } = this.state
    return [
      `Wivo v${__APP_VERSION__}`,
      `${t('Viga', 'Error')}: ${error?.message ?? t('tundmatu', 'unknown')}`,
      '',
      t('Komponendid:', 'Components:'),
      componentStack?.trim() || t('(puudub)', '(none)'),
      '',
      'Stack:',
      error?.stack?.trim() || t('(puudub)', '(none)'),
    ].join('\n')
  }

  private copy = () => {
    navigator.clipboard.writeText(this.report()).then(
      () => {
        this.setState({ copied: true })
        setTimeout(() => this.setState({ copied: false }), 2000)
      },
      () => { /* clipboard denied — the text is on screen anyway */ },
    )
  }

  render() {
    if (!this.state.error) return this.props.children

    // The innermost frames are the useful ones: the component that threw comes
    // first, and everything after it is the app's shell.
    const frames = (this.state.componentStack ?? '')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, 8)

    return (
      <div className="fixed inset-0 flex items-center justify-center p-8 bg-bg">
        <div className="card p-6 max-w-xl space-y-3">
          <p className="font-semibold text-ink">{t('Rakenduses tekkis viga', 'Something went wrong')}</p>
          <p className="text-sm text-ink-muted">
            {t(
              'Wivo ei suutnud seda vaadet kuvada. Vajuta „Kopeeri veateade“ ja saada see edasi — seal on kirjas, milline osa rakendusest katki läks.',
              'Wivo could not display this view. Press “Copy error report” and send it on — it says which part of the app broke.',
            )}
          </p>
          <pre className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>

          {frames.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-ink-muted select-none">
                {t('Kus see juhtus', 'Where it happened')}
              </summary>
              <pre className="mt-2 text-[11px] text-ink-soft bg-bg-sidebar border border-ink-faint/20 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                {frames.join('\n')}
              </pre>
            </details>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => this.setState({ error: null, componentStack: null, copied: false })}
              className="btn-primary"
            >
              {t('Proovi uuesti', 'Try again')}
            </button>
            <button
              onClick={this.copy}
              className="btn-ghost border border-ink-faint/25"
            >
              {this.state.copied ? t('Kopeeritud', 'Copied') : t('Kopeeri veateade', 'Copy error report')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
