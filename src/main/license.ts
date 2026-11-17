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
  licenceApiOrigins, licenceModules, licenceStatus, parseToken, signingInput,
  type LicenceModule, type LicencePayload, type LicenceStatus,
} from '../../shared/license/token'

/**
 * The raw 32-byte Ed25519 public keys, hex, that may sign a licence.
 *
 * TWO of them, not one, and on purpose: YubiKey C signs licences, D is its
 * spare (docs/YUBIKEYS.md). If C is lost, every clinic still has to be able to
 * get a NEW licence — a lost signing key must not be the reason a lab cannot
 * renew. Either key verifies; neither can sign an update, because an update's
 * signature covers different bytes (LICENCE_SIGNING_DOMAIN in shared/license).
 *
 * Empty = licensing is NOT enforced, which is what an unreleased build wants.
 * The moment one is set, every install needs a key.
 *
 * Only `testing` carries these. They do not go into `main` until the keys are
 * set up and a clinic has a licence in hand.
 */
// TODO: TAASTA LITSENTS — pane siia võtmed C ja D, kui setup-key.mjs on jooksnud.
// Originaal key: 'e39d2ca4c5f3ecb4d801206f2581d1b991a8de45ed6af19d26993cb845c9c211'
const LICENCE_PUBLIC_KEYS: readonly string[] = []

/**
 * A public key from a file, for development and for `testing` while the
 * YubiKeys are not set up yet (docs/MODULES-AND-RATINGS.md §1.4).
 *
 * REFUSED IN A PACKAGED BUILD, which is the whole point: a token signed with a
 * test key has to be invalid in a release, not merely discouraged. This is why
 * the check is `app.isPackaged` and not an environment variable — argv and the
 * environment belong to whoever starts the process, the packaging flag does
 * not.
 *
 * The file holds the PUBLIC key, 64 hex characters. No private key is ever
 * read here, and nothing secret is passed on a command line.
 */
const TEST_KEY_ENV = 'WIVO_LICENCE_TEST_KEY'
let testKeyCache: string | null | undefined

function testKeyHex(): string | null {
  if (testKeyCache !== undefined) return testKeyCache
  testKeyCache = null
  if (app.isPackaged) return testKeyCache
  const file = process.env[TEST_KEY_ENV]
  if (!file) return testKeyCache
  try {
    const hex = readFileSync(file, 'utf-8').trim().replace(/^0x/i, '')
    if (/^[0-9a-fA-F]{64}$/.test(hex)) testKeyCache = hex.toLowerCase()
  } catch {
    // A missing or unreadable test key is a development mistake, not a state
    // the app has to survive differently from having no key at all.
  }
  return testKeyCache
}

/** Every key this build will verify against. */
function verifyingKeyHexes(): string[] {
  const test = testKeyHex()
  return [...LICENCE_PUBLIC_KEYS, ...(test ? [test] : [])].filter(k => k.length > 0)
}

/** Where the key file lives. Same folder Electron keeps its own state in. */
const licencePath = (): string => join(app.getPath('userData'), 'license.key')

function publicKeyObject(hex: string) {
  // Wrap the raw key in the SPKI prefix Node expects for Ed25519.
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(hex, 'hex'),
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

  const hexes = verifyingKeyHexes()
  // No public key at all = development build. Accept a well-formed token so
  // the whole flow can be exercised without minting real keys.
  if (hexes.length === 0) return parsed.payload

  // The payload's own version decides which bytes were signed, so a v1 key
  // keeps working and a v2 key cannot be replayed as an update signature.
  const message = Buffer.from(signingInput(parsed.payloadB64, parsed.payload.v))
  for (const hex of hexes) {
    try {
      if (nodeVerify(null, message, publicKeyObject(hex), Buffer.from(parsed.signature))) {
        return parsed.payload
      }
    } catch {
      // A malformed key in the list must not stop the next one being tried.
    }
  }
  return null
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
export const licensingEnforced = (): boolean => verifyingKeyHexes().length > 0

/**
 * The modules the installed licence allows, as plain strings for IPC.
 *
 * An unenforced build answers with every module: a developer, and a build
 * without keys, must not be looking at a crippled app.
 */
export function licensedModules(): LicenceModule[] {
  const status = currentLicence()
  if (!licensingEnforced()) return [...licenceModules(null)]
  return [...licenceModules(status.payload)]
}

/**
 * The API addresses this machine's licence allows, as origins. Empty means no
 * restriction — an unenforced build, a v1 key, or a key issued without the
 * field.
 *
 * The renderer asks for this BEFORE it creates its database client, which is
 * why it is a plain synchronous read of a local file (see the sendSync handler
 * in src/main/index.ts). Nothing here reaches the network.
 */
export function licensedApiOrigins(): string[] {
  if (!licensingEnforced()) return []
  return licenceApiOrigins(currentLicence().payload)
}
