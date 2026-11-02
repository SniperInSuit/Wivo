#!/usr/bin/env node
/**
 * A new VAPID key pair for phone push (Phase 1b). Run once:
 *
 *   node scripts/vapid-keys.mjs
 *
 * VAPID_PUBLIC_KEY  → Cloudflare Pages env VITE_VAPID_PUBLIC_KEY, and the
 *                     send-notifications function's VAPID_PUBLIC_KEY secret.
 * VAPID_PRIVATE_KEY → the function's VAPID_PRIVATE_KEY secret ONLY. Never in
 *                     the app, never committed.
 *
 * Changing the pair later makes every phone subscribe again (they do so on
 * their own the next time "Notifications on this phone" is switched on).
 */
import { webcrypto as crypto } from 'node:crypto'

const b64url = bytes => Buffer.from(bytes).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
console.log(`VAPID_PUBLIC_KEY=${pub}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
