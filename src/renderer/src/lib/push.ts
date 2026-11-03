/**
 * "Notifications on this phone" (Phase 1b). The browser subscribes with the
 * VAPID public key and the subscription is stored for this user
 * (save_push_subscription, sql/090). Pushes carry no content: the phone shows
 * "New in Wivo" and the app shows the rest after sign-in.
 *
 * iPhone: only after "Add to Home Screen" (iOS 16.4+), and only from a tap.
 */
import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export type PushState = 'unsupported' | 'not-configured' | 'denied' | 'off' | 'on'

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** iPhone/iPad in Safari, not yet added to the Home Screen: push cannot work there yet. */
export function needsHomeScreen(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !standalone
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Checked against the server ─────────────────────────────────────────────
//
// The browser's own subscription is not the whole truth: the server deletes a
// person's subscriptions when an owner resets their second factor or they
// remove their last authenticator (sql/097). The phone's switch then still
// said "on" and pushes silently stopped. So after every sign-in (MfaGate) and
// whenever the switch is shown, this browser's subscription is looked up on
// the server: still there → on; gone, with permission still granted → the
// same subscription is registered again (no tap needed, unlike a new one);
// otherwise → off.

/** One browser subscription, as much of it as this needs. */
export interface LocalSubscription {
  endpoint: string
  toJSON(): PushSubscriptionJSON
  unsubscribe(): Promise<boolean>
}

/** Everything the check talks to, so it can be tested without a browser. */
export interface PushEnv {
  supported: boolean
  configured: boolean
  permission: () => NotificationPermission
  subscription: () => Promise<LocalSubscription | null>
  /** Is this endpoint this person's on the server? null: could not ask (offline, not signed in). */
  onServer: (endpoint: string) => Promise<boolean | null>
  /** save_push_subscription for this subscription. */
  save: (json: PushSubscriptionJSON) => Promise<{ error: unknown }>
}

export async function syncPushWith(env: PushEnv): Promise<PushState> {
  if (!env.supported) return 'unsupported'
  if (!env.configured) return 'not-configured'
  const permission = env.permission()
  const sub = await env.subscription()
  if (!sub) return permission === 'denied' ? 'denied' : 'off'
  // Permission taken away in the browser's settings: nothing can be shown, so
  // the subscription is of no use. Dropped here; the server row goes when the
  // push service reports it gone.
  if (permission !== 'granted') {
    await sub.unsubscribe().catch(() => false)
    return permission === 'denied' ? 'denied' : 'off'
  }
  const registered = await env.onServer(sub.endpoint)
  if (registered === null) return 'on'  // could not ask: change nothing
  if (registered) return 'on'
  // Gone on the server. Registered again as it is. If the server refuses
  // (another account's endpoint on a shared browser, sql/091), it is left
  // alone and the switch reads off: switching on makes a fresh one.
  const { error } = await env.save(sub.toJSON())
  return error ? 'off' : 'on'
}

function browserPushEnv(): PushEnv {
  const supported = pushSupported()
  return {
    supported,
    configured: !!VAPID_PUBLIC_KEY,
    permission: () => Notification.permission,
    subscription: async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      return (await reg?.pushManager.getSubscription()) ?? null
    },
    onServer: async endpoint => {
      // RLS: a person reads only their own subscriptions (sql/090).
      const { data, error } = await supabase.from('push_subscription').select('id').eq('endpoint', endpoint).maybeSingle()
      return error ? null : !!data
    },
    save: async json => await supabase.rpc('save_push_subscription', {
      p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_user_agent: navigator.userAgent,
    }),
  }
}

let syncing: Promise<PushState> | null = null

/** This browser's push state, checked against the server and repaired where it can be. One at a time. */
export function syncPushSubscription(): Promise<PushState> {
  syncing ??= syncPushWith(browserPushEnv()).finally(() => { syncing = null })
  return syncing
}

/** Must run from a tap (the permission prompt needs one). */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'not-configured'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await navigator.serviceWorker.ready
  // Always a fresh endpoint: one left over from another account on this phone
  // stays theirs (sql/091 refuses it) and is dropped once the push service
  // reports it gone.
  await (await reg.pushManager.getSubscription())?.unsubscribe()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
  const json = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_user_agent: navigator.userAgent,
  })
  if (error) { await sub.unsubscribe(); throw error }
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscription').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  return 'off'
}

/**
 * After "sign out on all other devices": those devices stop getting this
 * user's pushes too (a lost phone would otherwise keep lighting up). Keeps
 * this browser's own subscription, if it has one.
 */
export async function forgetOtherPhones(): Promise<void> {
  let mine: string | null = null
  try {
    const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : undefined
    mine = (await reg?.pushManager.getSubscription())?.endpoint ?? null
  } catch { /* no push here */ }
  const q = supabase.from('push_subscription').delete().not('id', 'is', null)
  await (mine ? q.neq('endpoint', mine) : q)
}

/**
 * Before signing out on the phone: this phone stops getting the user's
 * pushes. Best effort — the sender also drops subscriptions the push service
 * reports gone.
 */
export async function forgetPushBeforeSignOut(): Promise<void> {
  try { if (pushSupported()) await disablePush() } catch { /* signing out matters more */ }
}
