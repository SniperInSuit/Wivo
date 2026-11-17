#!/usr/bin/env node
/**
 * Licence key tool. YOU run this; a customer never does.
 *
 *   node scripts/make-license.mjs keygen
 *   node scripts/make-license.mjs keygen --out license-test-private.pem
 *   node scripts/make-license.mjs sign --org <uuid> --name "Riia kliinik" \
 *        --api https://abc.supabase.co --modules jobs,payroll,stock --months 12
 *   node scripts/make-license.mjs renew <old token> --months 12
 *   node scripts/make-license.mjs verify <token> --public <hex or file>
 *
 * KEYGEN writes `license-private.pem` (gitignored, KEEP IT) and prints the
 * public key to paste into src/main/license.ts. Run it ONCE, ever. Losing the
 * private key means every key you have issued becomes unverifiable the moment
 * you ship a build with a new public key; leaking it means anyone can mint
 * licences.
 *
 * SIGN prints a token to paste into the customer's app, or to put on a stick.
 *
 * ── WHAT THIS TOOL DOES NOT DO YET ──────────────────────────────────────────
 * It signs with a FILE. The real signature is meant to come off YubiKey C,
 * with its PIN and a touch, so the private key never exists on a disk
 * (docs/YUBIKEYS.md, docs/MODULES-AND-RATINGS.md §1.4). The keys are not set
 * up yet — `scripts/yubikey/setup-key.mjs` has not been run — so until then a
 * file key is what there is, and that is deliberately NOT a quiet fallback:
 * see the warning this prints.
 *
 * What protects a release meanwhile is the app, not this script: a public key
 * read from a file is refused in a packaged build (src/main/license.ts), so a
 * token signed here cannot be made to work in a release.
 *
 * ── THE TOKEN FORMAT LIVES IN shared/license/token.ts ───────────────────────
 * The few lines below (base64url, the signed bytes) are a deliberate copy of
 * it, because this script runs in plain Node and that file is TypeScript.
 * `scripts/makeLicense.test.ts` signs a token with this script and verifies it
 * with that module, so the copy cannot drift without a test failing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateKeyPairSync, createPrivateKey, createPublicKey, sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE_PATH = resolve(root, 'license-private.pem')

/** Must equal MODULE_KEYS in shared/license/token.ts (the test checks). */
const MODULES = [
  'jobs', 'payroll', 'stock', 'invoices', 'patients', 'stats', 'partners', 'ratings',
]

/** Must equal MODULE_REQUIRES there. A rating is given on a job. */
const REQUIRES = { ratings: ['jobs'] }

/** Must equal LICENCE_SIGNING_DOMAIN there. Keeps a licence out of the updater. */
const DOMAIN = 'WIVO-LICENCE-1'

// Same encoding as shared/license/token.ts. Node has Buffer, so this is the
// short version — the round-trip is verified by that file's tests.
const b64url = buf => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The bytes a signature covers. v2 carries the domain prefix; v1 did not. */
const signedBytes = (payloadB64, v) =>
  Buffer.from(v >= 2 ? `${DOMAIN}\nWIVO1.${payloadB64}` : `WIVO1.${payloadB64}`, 'utf8')

const die = msg => { console.error(msg); process.exit(1) }

function keygen(args) {
  const out = resolve(root, flag(args, '--out') ?? 'license-private.pem')
  if (existsSync(out)) {
    console.error(`REFUSING: ${out} already exists.`)
    console.error('Generating a second keypair invalidates every licence signed with the first.')
    process.exit(1)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })

  // Raw 32-byte Ed25519 public key, which is what the app verifies against.
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const raw = der.subarray(der.length - 32)

  console.log(`\nPrivate key written to ${out} (mode 600).`)
  console.log('It is gitignored. Back it up somewhere you would back up a bank login.\n')
  console.log('Paste this into src/main/license.ts, into LICENCE_PUBLIC_KEYS:\n')
  console.log(`  '${raw.toString('hex')}'\n`)
  console.log('Or, for a TEST key, put the hex alone in a file and start the app with')
  console.log('WIVO_LICENCE_TEST_KEY pointing at it. A packaged build refuses it.\n')
}

function flag(args, name) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined
}

/** A UUID, because `org` is matched by machines and a typo must not pass. */
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** The same reduction `normaliseOrigin` does in shared/license/token.ts. */
function origin(url) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec((url ?? '').trim())
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const hostPort = m[2].includes('@') ? m[2].slice(m[2].lastIndexOf('@') + 1) : m[2]
  const colon = hostPort.lastIndexOf(':')
  const hasPort = colon > hostPort.lastIndexOf(']')
  const host = (hasPort ? hostPort.slice(0, colon) : hostPort).toLowerCase()
  const port = hasPort ? hostPort.slice(colon + 1) : ''
  if (!host || (port && !/^[0-9]+$/.test(port))) return null
  const isDefault = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')
  return port && !isDefault ? `${scheme}://${host}:${port}` : `${scheme}://${host}`
}

function moduleSetProblem(modules) {
  const unknown = modules.filter(m => !MODULES.includes(m))
  if (unknown.length) return `unknown module: ${unknown.join(', ')}`
  for (const [m, needs] of Object.entries(REQUIRES)) {
    if (!modules.includes(m)) continue
    const missing = needs.filter(n => !modules.includes(n))
    if (missing.length) return `${m} needs ${missing.join(', ')}`
  }
  return null
}

const iso = d => d.toISOString().slice(0, 10)

/** Issue a token from a payload built by sign() or renew(). */
function issue(payload, keyPath, quiet) {
  if (!existsSync(keyPath)) {
    die(`No ${keyPath}. Run: node scripts/make-license.mjs keygen`)
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const key = createPrivateKey(readFileSync(keyPath))
  // Ed25519 signs the message directly — the algorithm argument must be null.
  const sig = nodeSign(null, signedBytes(payloadB64, payload.v), key)
  const token = `WIVO1.${payloadB64}.${b64url(sig)}`

  if (!quiet) {
    console.log('')
    console.log('⚠  Signed with a FILE key, not YubiKey C. Fine for development and for')
    console.log('   testing; a real customer licence waits until the keys are set up.')
    console.log('')
    console.log(`${payload.name} · ${payload.plan} · ${payload.seats ?? 'piiramatu'} kasutajat`)
    console.log(`Organisatsioon: ${payload.org ?? '—'}`)
    console.log(`Aadress: ${(payload.api ?? []).join(', ') || 'ükskõik milline'}`)
    console.log(`Moodulid: ${(payload.modules ?? MODULES).join(', ')}`)
    console.log(`Kehtib kuni ${payload.exp} (+14 päeva armuaega)\n`)
  }
  console.log(token)
  if (!quiet) console.log('')
}

function basePayload(args, old) {
  const name = flag(args, '--name') ?? old?.name
  if (!name) die('--name "Riia kliinik" is required')

  const plan = flag(args, '--plan') ?? old?.plan ?? 'labor'
  if (!['labor', 'labor_plus'].includes(plan)) die('--plan must be labor or labor_plus')

  const seatsArg = flag(args, '--seats')
  const seats = seatsArg !== undefined
    ? (seatsArg === 'unlimited' ? null : Number(seatsArg))
    : (old ? old.seats : (plan === 'labor_plus' ? null : 5))
  if (seats !== null && (!Number.isInteger(seats) || seats <= 0)) {
    die('--seats must be a whole number of seats, or unlimited')
  }

  const months = Number(flag(args, '--months') ?? '12')
  if (!Number.isInteger(months) || months <= 0) die('--months must be a whole number of months')

  const today = new Date()
  const exp = new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth() + months, today.getUTCDate()
  ))
  return { name, plan, seats, iat: iso(today), exp: iso(exp), months }
}

function sign(args) {
  const base = basePayload(args)
  const org = flag(args, '--org')
  if (!org) {
    die('--org <instance uuid> is required.\n'
      + 'It is the id the updates and the setup tool already use for this clinic:\n'
      + 'the name is for a human, --org is what makes the key useless in another clinic.')
  }
  if (!isUuid(org)) die(`--org must be a UUID, got: ${org}`)

  const apiArg = flag(args, '--api')
  const api = (apiArg ?? '').split(',').map(s => s.trim()).filter(Boolean).map(a => {
    const o = origin(a)
    if (!o) die(`--api is not an address: ${a}`)
    return o
  })
  if (api.length === 0) {
    die('--api <https://…> is required.\n'
      + 'The app checks where it may connect BEFORE it connects, so the licence has\n'
      + 'to name the address. Several, comma separated, while a clinic is moving\n'
      + 'from one server to another (docs/OWN-SERVER.md).')
  }

  const modulesArg = flag(args, '--modules')
  const modules = modulesArg === 'all' || modulesArg === undefined
    ? [...MODULES]
    : modulesArg.split(',').map(s => s.trim()).filter(Boolean)
  if (modulesArg === undefined) {
    console.error('NOTE: no --modules given, so every module is switched on.')
  }
  const problem = moduleSetProblem(modules)
  if (problem) {
    die(`REFUSING: ${problem}.\n`
      + `Modules: ${MODULES.join(', ')} (or "all").\n`
      + 'A key that promises a page which cannot work is worse than a missing module.')
  }

  issue({
    v: 2, name: base.name, plan: base.plan, seats: base.seats,
    iat: base.iat, exp: base.exp, org, api, modules,
  }, resolve(root, flag(args, '--key') ?? PRIVATE_PATH), args.includes('--quiet'))
}

/**
 * Renew: carry `org`, `api` and `modules` over, move only `exp`.
 *
 * The whole point is that renewing cannot narrow a licence by accident. Typing
 * the module list again every year is how a clinic loses Stock in January.
 */
function renew(args) {
  const token = args.find(a => a.startsWith('WIVO1.'))
  if (!token) die('renew needs the old token: make-license.mjs renew WIVO1.… --months 12')
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts[0] !== 'WIVO1') die('That does not look like a Wivo token.')
  let old
  try {
    old = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    die('Could not read the old token.')
  }
  const base = basePayload(args, old)
  const payload = old.v === 2
    ? {
        v: 2, name: base.name, plan: base.plan, seats: base.seats,
        iat: base.iat, exp: base.exp,
        org: old.org, api: old.api, modules: old.modules,
      }
    // A v1 key renewed stays v1 and keeps meaning "everything": turning it
    // into a v2 key here would have to invent an org and an address.
    : { v: 1, name: base.name, plan: base.plan, seats: base.seats, iat: base.iat, exp: base.exp }
  issue(payload, resolve(root, flag(args, '--key') ?? PRIVATE_PATH), args.includes('--quiet'))
}

/** Check a token against a public key, the way the app does. */
function verify(args) {
  const token = args.find(a => a.startsWith('WIVO1.'))
  if (!token) die('verify needs a token')
  const pub = flag(args, '--public')
  if (!pub) die('--public <64 hex chars, or a file containing them>')
  const hex = (existsSync(resolve(root, pub)) ? readFileSync(resolve(root, pub), 'utf8') : pub)
    .trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) die('--public must be 32 bytes of hex')

  const [, payloadB64, sigB64] = token.trim().split('.')
  const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')])
  const ok = nodeVerify(
    null,
    signedBytes(payloadB64, payload.v),
    createPublicKey({ key: der, format: 'der', type: 'spki' }),
    Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  )
  console.log(ok ? `OK · v${payload.v} · ${payload.name} · kuni ${payload.exp}` : 'NOT VALID')
  if (!ok) process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'keygen') keygen(rest)
else if (cmd === 'sign') sign(rest)
else if (cmd === 'renew') renew(rest)
else if (cmd === 'verify') verify(rest)
else {
  console.log('Usage:')
  console.log('  node scripts/make-license.mjs keygen [--out license-test-private.pem]')
  console.log('  node scripts/make-license.mjs sign --org <uuid> --name "Lab OÜ" --api https://…')
  console.log('        [--modules jobs,payroll,stock|all] [--plan labor|labor_plus]')
  console.log('        [--months 12] [--seats 5|unlimited] [--key <pem>] [--quiet]')
  console.log('  node scripts/make-license.mjs renew WIVO1.… [--months 12]')
  console.log('  node scripts/make-license.mjs verify WIVO1.… --public <hex|file>')
  console.log('')
  console.log(`  modules: ${MODULES.join(', ')}`)
  process.exit(1)
}
