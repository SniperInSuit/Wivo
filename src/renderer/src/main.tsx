import React from 'react'
import ReactDOM from 'react-dom/client'
// First, so <html lang> is right before anything renders.
import './lib/i18n'
import { installErrorLog } from './lib/errorLog'
import { initSentryRenderer } from './lib/sentry'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/index.css'

// Before the app renders, so errors during start-up are kept for a bug report.
installErrorLog()
initSentryRenderer()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
