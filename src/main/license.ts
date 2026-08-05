/**
 * Licence verification. Runs in the MAIN process, not the renderer.
 *
 * Two reasons it lives here rather than in the React app:
 *   - Node's crypto verifies Ed25519 natively. Chromium's WebCrypto did not
 *     support Ed25519 in the version this Electron ships, so a renderer-side
 *     check would have needed a different algorithm or a bundled library.
 *   - The public key and the verdict stay out of the renderer bundle, where
 *     anyone can open devtools and edit a variable.
 *
 * It is still not tamper-proof — nothing shipped to a customer's machine is —
 * but it takes a rebuild rather than a console command, which is the honest
 * bar for a business tool.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { verify as nodeVerify, createPublicKey } from 'crypto'
import {
  licenceStatus, parseToken, signingInput,
  type LicencePayload, type LicenceStatus,
} from '../../shared/license/token'

/**
 * Raw 32-byte Ed25519 public key, hex. Generate with:
 *   node scripts/make-license.mjs keygen
 *
 * Empty = licensing is NOT enforced, which is what an unreleased build wants.
 * The moment this is set, every install needs a key.
 */
const LICENCE_PUBLIC_KEY = 'e39d2ca4c5f3ecb4d801206f2581d1b991a8de45ed6af19d26993cb845c9c211'

/** Where the key file lives. Same folder Electron keeps its own state in. */
const licencePath = (): string => join(app.getPath('userData'), 'license.key')

function publicKeyObject() {
  if (!LICENCE_PUBLIC_KEY) return null
  // Wrap the raw key in the SPKI prefix Node expects for Ed25519.
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(LICENCE_PUBLIC_KEY, 'hex'),
  ])
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

/** The stored token, or null. Never throws — a missing file is a normal state. */
export function readLicenceToken(): string | null {
  try {
    const p = licencePath()
    return existsSync(p) ? readFileSync(p, 'utf-8').trim() || null : null
  } catch {
    return null
  }
}

/** Verify a token's signature and return its payload, or null if it fails. */
function verifiedPayload(token: string | null): LicencePayload | null {
  if (!token) return null
  const parsed = parseToken(token)
  if (!parsed) return null

  const key = publicKeyObject()
  // No public key compiled in = development build. Accept a well-formed token
  // so the whole flow can be exercised without minting real keys.
  if (!key) return parsed.payload

  try {
    const ok = nodeVerify(
      null,
      Buffer.from(signingInput(parsed.payloadB64)),
      key,
      Buffer.from(parsed.signature)
    )
    return ok ? parsed.payload : null
  } catch {
    return null
  }
}

export function currentLicence(): LicenceStatus {
  const token = readLicenceToken()
  if (token && !parseToken(token)) {
    return { state: 'invalid', payload: null, daysLeft: null, graceLeft: null }
  }
  const payload = verifiedPayload(token)
  // A token that parses but does not verify is 'invalid', not 'missing' — the
  // difference is what tells the user "this key is wrong" rather than "install
  // a key", and those need different help.
  if (token && !payload) {
    return { state: 'invalid', payload: null, daysLeft: null, graceLeft: null }
  }
  return licenceStatus(payload, new Date())
}

/** Store a token after checking it. Returns the resulting status either way. */
export function installLicence(token: string): LicenceStatus {
  const trimmed = token.trim()
  const parsed = parseToken(trimmed)
  if (!parsed || !verifiedPayload(trimmed)) {
    return { state: 'invalid', payload: null, daysLeft: null, graceLeft: null }
  }
  const p = licencePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, trimmed, 'utf-8')
  return currentLicence()
}

/** Whether this build enforces licensing at all. Shown in Seaded. */
export const licensingEnforced = (): boolean => LICENCE_PUBLIC_KEY.length > 0
