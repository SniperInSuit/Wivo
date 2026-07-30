import React from 'react'

interface State {
  error: Error | null
}

/**
 * Last line of defence against a blank window.
 *
 * React 18 unmounts the entire root when a render or effect throws with no
 * boundary above it — the app goes white with nothing on screen and nothing in
 * the UI to explain it. This app has hit that twice: once from a missing .env
 * throwing at module load, once from a duplicate realtime channel throwing in
 * an effect. Neither was diagnosable without opening devtools.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the stack reachable in devtools even though the UI shows a summary
    console.error('Wivo crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="fixed inset-0 flex items-center justify-center p-8 bg-bg">
        <div className="card p-6 max-w-xl space-y-3">
          <p className="font-semibold text-ink">Rakenduses tekkis viga</p>
          <p className="text-sm text-ink-muted">
            Wivo ei suutnud seda vaadet kuvada. Proovi rakendus taaskäivitada. Kui viga kordub,
            saada see tekst edasi.
          </p>
          <pre className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
          <button onClick={() => this.setState({ error: null })} className="btn-primary">
            Proovi uuesti
          </button>
        </div>
      </div>
    )
  }
}
