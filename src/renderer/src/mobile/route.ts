/**
 * The phone app's three places, as real paths so the back button works and a
 * link like the notification e-mail's (/job/<id>) opens the job directly.
 * Cloudflare serves index.html for every path (mobile-static/_redirects).
 */
export type Route = { name: 'home' } | { name: 'job'; id: string } | { name: 'settings' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseRoute(pathname: string): Route {
  const [first, second, ...rest] = pathname.split('/').filter(Boolean)
  if (first === 'job' && second && UUID.test(second) && rest.length === 0) return { name: 'job', id: second.toLowerCase() }
  if (first === 'settings' && !second) return { name: 'settings' }
  return { name: 'home' }
}

export function routePath(r: Route): string {
  return r.name === 'job' ? `/job/${r.id}` : r.name === 'settings' ? '/settings' : '/'
}
