/**
 * The phone app (spec, Phase 1b): "a picture or a message onto a job in a few
 * seconds — not the full Wivo". Home (my jobs, search), a job (info, files,
 * camera, chat) and settings. No board, stock, finance, invoices or admin.
 */
import { useCallback, useEffect, useState } from 'react'
import { Settings, ChevronLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { NotificationBell } from '../components/NotificationBell'
import { parseRoute, routePath, type Route } from './route'
import { MobileHome } from './MobileHome'
import { MobileJob } from './MobileJob'
import { MobileSettings } from './MobileSettings'
import { t } from '@/lib/i18n'

export function MobileApp() {
  const { clinic } = useAuth()
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname))

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((r: Route) => {
    history.pushState(null, '', routePath(r))
    setRoute(r)
    window.scrollTo(0, 0)
  }, [])
  // Opened straight on a job (a link): "back" has nowhere to go, so go home.
  const back = useCallback(() => {
    if (history.state === null && history.length <= 1) go({ name: 'home' })
    else history.back()
  }, [go])

  return (
    <div className="min-h-[100dvh] bg-bg text-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-ink-faint/20 bg-bg-card px-3 py-2"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        {route.name === 'home' ? (
          <span className="truncate text-sm font-semibold">{clinic?.name ?? 'Wivo'}</span>
        ) : (
          <button type="button" onClick={back} className="-ml-1 flex items-center gap-1 py-1 text-sm text-accent">
            <ChevronLeft size={18} aria-hidden="true" /> {t('mobile.back')}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell onOpen={n => { if (n.job_id) go({ name: 'job', id: n.job_id }) }} />
          {route.name !== 'settings' && (
            <button type="button" onClick={() => go({ name: 'settings' })} aria-label={t('mobile.settings')}
              className="rounded-lg p-2 text-ink-soft">
              <Settings size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {route.name === 'home' && <MobileHome onOpen={id => go({ name: 'job', id })} />}
      {route.name === 'job' && <MobileJob id={route.id} onClose={back} />}
      {route.name === 'settings' && <MobileSettings />}
    </div>
  )
}
