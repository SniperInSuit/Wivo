import React from 'react'
import ReactDOM from 'react-dom/client'
// First, so <html lang> is right before anything renders.
import './lib/i18n'
import { IS_TEST_COPY, installTestModeNetworkGuard } from './lib/testCopy'
import { installErrorLog } from './lib/errorLog'

// Test mode: nothing leaves for a Supabase project other than the test copy
// (lib/testCopy). Before anything else runs.
if (IS_TEST_COPY) installTestModeNetworkGuard(window)
import { initSentryRenderer } from './lib/sentry'
import { initSounds, installUiSounds } from './lib/sound'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TestCopyBanner } from './components/TestCopyBanner'
import './styles/index.css'

// Before the app renders, so errors during start-up are kept for a bug report.
installErrorLog()
initSentryRenderer()
void initSounds()
installUiSounds()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <TestCopyBanner />
  </React.StrictMode>
)
