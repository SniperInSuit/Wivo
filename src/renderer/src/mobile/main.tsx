/**
 * The phone app's entry (Phase 1b). Same providers as the desktop where the
 * phone needs them — auth, settings sync, pipeline labels, language — and
 * nothing Electron (no updater, no licence, no scanner folder).
 */
import '../lib/i18n'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installErrorLog } from '../lib/errorLog'
import { initSounds, installUiSounds } from '../lib/sound'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AuthProvider } from '../context/AuthContext'
import { PipelineProvider } from '../context/PipelineContext'
import { ClinicSettingsSync } from '../components/ClinicSettingsSync'
import { LanguageSync } from '../components/LanguageSync'
import { MobileAuthGuard } from './MobileAuthGuard'
import { MobileApp } from './MobileApp'
import { AuthConfirmPage } from '../components/Auth/AuthConfirmPage'
import { isConfirmPath } from '../lib/authConfirm'
import { t } from '@/lib/i18n'
import '../styles/index.css'

document.documentElement.classList.add('mobile')

installErrorLog()
void initSounds()
installUiSounds()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js') })
  // The title of a push that came without its own words (an older sender), in
  // this user's language: sw.js reads it, as a worker cannot load the catalog.
  void caches.open('wivo-text').then(c => c.put('/push-text', new Response(t('mobile.pushFallbackTitle')))).catch(() => {})
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* The e-mails' links (invite, new password, new address): before sign-in. */}
          {isConfirmPath(location.pathname) ? <AuthConfirmPage /> : (
            <MobileAuthGuard>
              <PipelineProvider>
                <ClinicSettingsSync />
                <LanguageSync />
                <MobileApp />
              </PipelineProvider>
            </MobileAuthGuard>
          )}
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
