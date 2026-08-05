#!/usr/bin/env node
/**
 * Licence key tool. YOU run this; a customer never does.
 *
 *   node scripts/make-license.mjs keygen
 *   node scripts/make-license.mjs sign --name "Hambalabor OÜ" --plan labor --months 12
 *
 * KEYGEN writes `license-private.pem` (gitignored, KEEP IT) and prints the
 * public key to paste into src/main/license.ts. Run it ONCE, ever. Losing the
 * private key means every key you have issued becomes unverifiable the moment
 * you ship a build with a new public key; leaking it means anyone can mint
 * licences.
 *
 * SIGN prints a token to paste into the customer's app, or to put on a stick.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateKeyPairSync, createPrivateKey, createPublicKey, sign as nodeSign,
} from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE_PATH = resolve(root, 'license-private.pem')

// Same encoding as shared/license/token.ts. Node has Buffer, so this is the
// short version — the round-trip is verified by that file's tests.
const b64url = buf => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function keygen() {
  if (existsSync(PRIVATE_PATH)) {
    console.error(`REFUSING: ${PRIVATE_PATH} already exists.`)
    console.error('Generating a second keypair invalidates every licence signed with the first.')
    process.exit(1)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(PRIVATE_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })

  // Raw 32-byte Ed25519 public key, which is what the app verifies against.
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const raw = der.subarray(der.length - 32)

  console.log(`\nPrivate key written to ${PRIVATE_PATH} (mode 600).`)
  console.log('It is gitignored. Back it up somewhere you would back up a bank login.\n')
  console.log('Paste this into src/main/license.ts as LICENCE_PUBLIC_KEY:\n')
  console.log(`  '${raw.toString('hex')}'\n`)
}

function sign(args) {
  if (!existsSync(PRIVATE_PATH)) {
    console.error(`No ${PRIVATE_PATH}. Run: node scripts/make-license.mjs keygen`)
    process.exit(1)
  }
  const get = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback
  }
  const name = get('--name')
  if (!name) { console.error('--name "Hambalabor OÜ" is required'); process.exit(1) }

  const plan = get('--plan', 'labor')
  if (!['labor', 'labor_plus'].includes(plan)) {
    console.error('--plan must be labor or labor_plus'); process.exit(1)
  }
  const months = Number(get('--months', '12'))
  const seatsArg = get('--seats', plan === 'labor_plus' ? 'unlimited' : '5')
  const seats = seatsArg === 'unlimited' ? null : Number(seatsArg)

  const today = new Date()
  const exp = new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth() + months, today.getUTCDate()
  ))
  const iso = d => d.toISOString().slice(0, 10)

  const payload = {
    v: 1, name, plan, seats, iat: iso(today), exp: iso(exp),
  }

  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const key = createPrivateKey(readFileSync(PRIVATE_PATH))
  // Ed25519 signs the message directly — the algorithm argument must be null.
  const sig = nodeSign(null, Buffer.from(`WIVO1.${payloadB64}`, 'utf8'), key)
  const token = `WIVO1.${payloadB64}.${b64url(sig)}`

  console.log(`\n${name} · ${plan} · ${seats ?? 'piiramatu'} kasutajat`)
  console.log(`Kehtib kuni ${payload.exp} (+14 päeva armuaega)\n`)
  console.log(token)
  console.log('')
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'keygen') keygen()
else if (cmd === 'sign') sign(rest)
else {
  console.log('Usage:')
  console.log('  node scripts/make-license.mjs keygen')
  console.log('  node scripts/make-license.mjs sign --name "Lab OÜ" [--plan labor|labor_plus] [--months 12] [--seats 5|unlimited]')
  process.exit(1)
}
