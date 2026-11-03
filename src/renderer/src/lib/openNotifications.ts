/**
 * Tapping a push opens the bell list (sw.js): an open window gets a message,
 * otherwise the app starts on /?notifications=1. NotificationBell listens for
 * both. Nothing here exists in the desktop app, which has no service worker.
 */
export const OPEN_NOTIFICATIONS_MESSAGE = 'wivo:open-notifications'
const PARAM = 'notifications'

/**
 * Did the app start from a tapped push? If so, the marker is taken out of the
 * address (so a reload or "back" does not open the list again).
 */
export function takeOpenNotificationsRequest(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> = location,
  replace: (url: string) => void = url => history.replaceState(history.state, '', url),
): boolean {
  const params = new URLSearchParams(loc.search)
  if (params.get(PARAM) !== '1') return false
  params.delete(PARAM)
  const query = params.toString()
  replace(`${loc.pathname}${query ? `?${query}` : ''}${loc.hash}`)
  return true
}

/** Calls `open` whenever the service worker asks for the list. Returns the unsubscribe. */
export function onOpenNotificationsRequest(open: () => void): () => void {
  const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null
  if (!sw) return () => {}
  const listener = (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === OPEN_NOTIFICATIONS_MESSAGE) open()
  }
  sw.addEventListener('message', listener)
  return () => sw.removeEventListener('message', listener)
}
