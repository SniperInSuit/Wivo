#!/usr/bin/env node
/**
 * The YubiKey setup (docs/YUBIKEYS.md §3). KEVIN runs this, one key at a
 * time, in the order C, D, A, B; Claude never does.
 *
 *   node scripts/yubikey/setup-key.mjs C
 *
 * For the key with that letter:
 *   1. checks it is that key, with the batch's factory certificate;
 *   2. sets up PIV, once, on a key as it left the factory (setup-device.py piv):
 *      a new random PIN and PUK, which Kevin saves and types back before
 *      anything changes; the Ed25519 keys made on the key, PIN and touch for
 *      every use, each attested; a random AES-256 management key kept on the
 *      key under the PIN;
 *   3. checks every key made: Yubico's attestation up to the pinned root;
 *   4. signs (setup-device.py sign):
 *        C, D and B: a test statement with each key, verified as the release code verifies;
 *        A: the certificates for C's and D's update and app keys (shared/release);
 *   5. turns off what the key won't use (`ykman config`), each command shown first;
 *   6. reads the key again and checks everything, then keeps the public part
 *      in ~/wivo-yubikey-setup/<letter>-<serial>/public.json.
 *
 * After a stop, run it again: what is done is checked and skipped. It writes
 * public keys, certificates and signatures only, never a PIN, PUK or
 * management key.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atLeast, checkSignature } from './attestation.mjs'
import { KEYS, MIN_YKMAN } from './keys.mjs'
import { loadRelease } from './load-release.mjs'
import {
  ORDER, PLAN, attestationProblems, certificateLabel, certificatePayloads, checkConfig, checkPiv, configCommands,
  keysOf, pivSituation, publicRecord, testStatement,
} from './setup-plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(homedir(), 'wivo-yubikey-setup')

const letter = (process.argv[2] ?? '').toUpperCase()
if (!(letter in PLAN)) {
  console.error(`Usage: node scripts/yubikey/setup-key.mjs <letter>, one key at a time, in the order ${ORDER.join(', ')}`)
  process.exit(64)
}
const serial = KEYS[letter]
const plan = PLAN[letter]
const dir = join(root, `${letter}-${serial}`)
const file = name => join(dir, name)
const readJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null)
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2))
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const hex = text => Buffer.from(text).toString('hex')

function stop(text, startOver = false) {
  console.log(`\nKey ${letter}: STOPPED. ${text}`)
  if (startOver) {
    console.log(`To start this key over: ykman --device ${serial} piv reset   (answer y), then run this again.`)
    console.log('The PIN and PUK shown before are then void: the next run shows new ones for the same Apple Passwords entry.')
  }
  process.exit(1)
}

const ykman = spawnSync('ykman', ['--version'], { encoding: 'utf8' })
const ykmanVersion = (ykman.stdout ?? '').match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
if (!ykmanVersion || !atLeast(ykmanVersion, MIN_YKMAN)) {
  console.error(`Needs ykman ${MIN_YKMAN.join('.')} or later (found: ${ykman.stdout?.trim() || 'none'}). Run: brew upgrade ykman`)
  process.exit(69)
}

// A certifies C's and D's keys, so they come first.
const before = ORDER.slice(0, ORDER.indexOf('A'))
const others = letter === 'A' ? Object.fromEntries(before.map(l => [l, readJson(join(root, `${l}-${KEYS[l]}`, 'public.json'))])) : {}
const missing = Object.keys(others).filter(l => !others[l]?.passed)
if (missing.length) {
  console.error(`Set up ${missing.join(' and ')} first: the order is ${ORDER.join(', ')}.`)
  process.exit(1)
}

mkdirSync(dir, { recursive: true })
const yubico = {
  intermediatesPem: readFileSync(join(here, 'yubico', 'yubico-intermediate.pem'), 'utf8'),
  rootPem: readFileSync(join(here, 'yubico', 'yubico-ca-1.pem'), 'utf8'),
}
const release = await loadRelease()

/** One step of setup-device.py, through Yubico's `ykman script`. The key's prompts go straight to the terminal. */
const device = (step, ...args) =>
  spawnSync('ykman', ['script', '--force', join(here, 'setup-device.py'), step, String(serial), ...args], { stdio: 'inherit' }).status

/** What the key has now. After a configuration change the key restarts, so then it tries a few times. */
function readState(name, tries = 1) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    writeJson(file(name), {})
    if (device('state', file(name)) === 0) return readJson(file(name))
    if (attempt < tries) pause(3000)
  }
  stop('The key could not be read (above says why).')
}

const print = results => { for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.text}`) }

console.log(`Key ${letter} (${serial}), ${plan.role}. Insert only this key.\n`)
let state = readState('state-before.json')

// ─── PIV, once ────────────────────────────────────────────────────────────────
let piv = readJson(file('piv.json'))
const situation = pivSituation(letter, state, piv)
if (situation === 'other') {
  stop(piv?.complete
    ? 'This key no longer holds the keys an earlier run made. Nothing was changed.'
    : "This key's PIV is not as it left the factory, and no earlier run of this setup finished it. Nothing was changed.", true)
}
if (situation === 'factory') {
  console.log('PIV is as it left the factory: setting it up.')
  writeJson(file('piv-plan.json'), { letter, role: plan.role, slots: plan.slots.map(s => s.slot), paper: plan.paper ?? null })
  writeJson(file('piv.json'), {})
  device('piv', file('piv-plan.json'), file('piv.json'))
  piv = readJson(file('piv.json'))
  if (!piv?.complete) stop(piv?.error ? `The setup failed: ${piv.error}` : 'The setup did not finish (above says why).', Boolean(piv?.changed))
  state = readState('state-after-piv.json')
} else {
  console.log('PIV was set up by an earlier run: checked again, not done again.')
}

const pivChecks = checkPiv(letter, state, piv, yubico)
if (pivChecks.some(r => !r.ok)) {
  console.log('')
  print(pivChecks)
  stop('PIV is not as planned (FAIL above). Nothing was signed. Send Claude the output.')
}
const keys = keysOf(letter, piv)

// ─── Signing ──────────────────────────────────────────────────────────────────
const signed = readJson(file('signed.json')) ?? []
const wanted = []
const today = new Date().toISOString().slice(0, 10)
if (letter === 'A') {
  const rootKey = keys[0]
  const toCertify = []
  for (const [l, other] of Object.entries(others)) {
    for (const k of other.keys) {
      const problems = attestationProblems(l, k, other.f9_pem, yubico, other.version)
      if (problems.length) stop(`Key ${l}'s ${k.id} does not check out (${problems.join('; ')}). Nothing was certified.`)
      toCertify.push(k)
    }
  }
  for (const c of certificatePayloads(rootKey.id, toCertify, today)) {
    const id = `certificate:${c.key_id}`
    if (signed.some(s => s.id === id)) continue
    const { payloadB64, statement } = await release.prepare('certificate', c)
    wanted.push({ id, label: `Certificate: ${certificateLabel(c)}`, slot: rootKey.slot, hex: Buffer.from(statement).toString('hex'), payloadB64, certificate: c })
  }
} else {
  for (const k of keys) {
    const id = `test:${k.id}`
    if (!signed.some(s => s.id === id)) wanted.push({ id, label: `Test signature by ${k.id}`, slot: k.slot, hex: hex(testStatement(k.id)), key: k })
  }
}

if (wanted.length) {
  writeJson(file('sign-in.json'), {
    what: letter === 'A' ? 'Root A certifies the update and app keys on C and D' : `Key ${letter}: a test signature with each key`,
    statements: wanted.map(({ id, label, slot, hex }) => ({ id, label, slot, hex })),
  })
  writeJson(file('sign-out.json'), {})
  if (device('sign', file('sign-in.json'), file('sign-out.json')) !== 0) {
    stop('The signing stopped (above says why). Nothing more was done. Run this again: what is done is skipped.')
  }
  const out = readJson(file('sign-out.json'))?.signed ?? []
  const trust = letter === 'A' ? await release.trustFrom([{ id: keys[0].id, publicKey: keys[0].public_key }], []) : null
  for (const w of wanted) {
    const got = out.find(o => o.id === w.id && o.signature_hex)
    if (!got) continue
    if (w.certificate) {
      const token = release.assemble('certificate', w.payloadB64, Buffer.from(got.signature_hex, 'hex'))
      const r = await release.checkCertificate(token, trust, w.certificate.purpose, new Date())
      if (r.ok && r.payload.key_id === w.certificate.key_id) signed.push({ id: w.id, label: w.label, token })
      else console.log(`  ${w.label}: refused by shared/release (${r.reason ?? 'another key'}). Not kept.`)
    } else {
      const s = await checkSignature(w.key.public_key_hex, w.hex, got.signature_hex)
      if (s.node && s.webcrypto && s.changedRefused) signed.push({ id: w.id, label: w.label, hex: w.hex, signature_hex: got.signature_hex })
      else console.log(`  ${w.label}: the signature does not verify. Not kept.`)
    }
  }
  writeJson(file('signed.json'), signed)
}

// What this key must have signed: A, the current certificates; the others, a test per key.
const due = letter === 'A'
  ? Object.values(others).flatMap(o => o.keys).filter(k => k.purpose !== 'licence').map(k => `certificate:${k.id}`)
  : keys.map(k => `test:${k.id}`)
const signChecks = due.map(id => {
  const s = signed.find(x => x.id === id)
  return s
    ? { ok: true, text: s.token ? `${s.label}: signed by root A, accepted by shared/release` : `${s.label}: verifies, as the release code verifies` }
    : { ok: false, text: `${id}: not signed yet (run again)` }
})

// ─── Turning off what the key won't use ───────────────────────────────────────
const commands = configCommands(letter, state.enabled)
if (commands.length) console.log("\nTurning off what this key won't use. Each command is shown, then run.")
for (const c of commands) {
  console.log(`\n$ ykman ${c.join(' ')}`)
  if (spawnSync('ykman', c, { stdio: 'inherit' }).status !== 0) {
    stop('ykman could not change the configuration (above says why). Run this again: what is done is skipped.')
  }
  pause(3000) // the key restarts after a change
}

// ─── Everything again, read from the key ──────────────────────────────────────
console.log('\nReading the key again for the final check...')
state = readState('state-final.json', 4)
const results = [...checkPiv(letter, state, piv, yubico), ...signChecks, ...checkConfig(letter, state)]
const passed = results.every(r => r.ok)
const certificates = signed.filter(s => s.token && due.includes(s.id)).map(s => s.token)
writeJson(file('public.json'), publicRecord(letter, state, piv, { passed, set_up: today, ...(letter === 'A' ? { certificates } : {}) }))
writeJson(file('report.json'), { letter, serial, at: new Date().toISOString(), passed, results })

console.log(`\nKey ${letter} (${serial}), ${plan.role}:`)
print(results)
console.log(`\n${passed ? 'PASSED' : 'FAILED'}. Kept in ${dir}`)
if (passed) {
  const next = ORDER[ORDER.indexOf(letter) + 1]
  console.log(next ? `Next: take out key ${letter}, insert only key ${next}, and run: node scripts/yubikey/setup-key.mjs ${next}` : 'All four are set up. Tell Claude "done".')
}
process.exit(passed ? 0 : 1)
