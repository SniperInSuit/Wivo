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

/** 'lost': this person had it on here, but the browser no longer holds the subscription. */
export type PushState = 'unsupported' | 'not-configured' | 'denied' | 'off' | 'on' | 'lost'

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
// remove their last authenticator (sql/097), and signing out here deletes this
// phone's. So after every sign-in (MfaGate) and whenever the switch is shown,
// this browser's subscription is looked up on the server: still there → on;
// gone, with permission still granted → the same subscription is registered
// again (no tap needed, unlike a new one); otherwise → off.
//
// Signing out keeps the browser's subscription for exactly that: only an
// explicit "off" drops it. The phone remembers whose it is, so it comes back
// for the same person and is never handed to someone else who signs in here.
// If the browser has lost it anyway, a new one may need a tap on an iPhone:
// 'lost', and the phone app offers one (mobile/PushTurnOnNotice).

const OWNER_KEY = 'wivo_push_user'

/** Who this browser's subscription was last registered for. */
function pushOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY) } catch { return null }
}

function setPushOwner(user: string | null): void {
  try {
    if (user) localStorage.setItem(OWNER_KEY, user)
    else localStorage.removeItem(OWNER_KEY)
  } catch { /* private mode: a re-sign-in finds no owner and re-registers as before */ }
}

async function currentUser(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

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
  /** Who is signed in. */
  user: () => Promise<string | null>
  owner: () => string | null
  setOwner: (user: string | null) => void
}

export async function syncPushWith(env: PushEnv): Promise<PushState> {
  if (!env.supported) return 'unsupported'
  if (!env.configured) return 'not-configured'
  const permission = env.permission()
  const sub = await env.subscription()
  const me = await env.user()
  if (!sub) {
    // Theirs, on, and gone from the browser all the same.
    if (permission === 'granted' && me && env.owner() === me) return 'lost'
    return permission === 'denied' ? 'denied' : 'off'
  }
  // Permission taken away in the browser's settings: nothing can be shown, so
  // the subscription is of no use. Dropped here; the server row goes when the
  // push service reports it gone.
  if (permission !== 'granted') {
    await sub.unsubscribe().catch(() => false)
    env.setOwner(null)
    return permission === 'denied' ? 'denied' : 'off'
  }
  const registered = await env.onServer(sub.endpoint)
  if (registered === null) return 'on'  // could not ask: change nothing
  if (registered) {
    if (me) env.setOwner(me)
    return 'on'
  }
  // Gone on the server. Registered again as it is, for the person who had it
  // (or, from a build that did not record it, whoever is here). Someone
  // else's is left alone and the switch reads off: switching on makes a
  // fresh one. So is one the server refuses (another account's, sql/091).
  const owner = env.owner()
  if (owner && owner !== me) return 'off'
  const { error } = await env.save(sub.toJSON())
  if (error) return 'off'
  if (me) env.setOwner(me)
  return 'on'
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
    user: currentUser,
    owner: pushOwner,
    setOwner: setPushOwner,
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
  setPushOwner(await currentUser())
  return 'on'
}

/** The switch turned off: this phone's subscription is dropped, and does not come back by itself. */
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscription').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  setPushOwner(null)
  return 'off'
}

/** "Not now" to bringing back a lost one: no longer offered until switched on. */
export function declinePush(): void {
  setPushOwner(null)
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
 * pushes (the server row goes). The browser keeps its subscription, so the
 * same person's next sign-in registers it again without a tap (syncPushWith).
 * Best effort — the sender also drops subscriptions the push service reports
 * gone.
 */
export async function forgetPushBeforeSignOut(): Promise<void> {
  try {
    if (!pushSupported()) return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await supabase.from('push_subscription').delete().eq('endpoint', sub.endpoint)
  } catch { /* signing out matters more */ }
}
