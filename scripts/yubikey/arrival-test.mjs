#!/usr/bin/env node
/**
 * The YubiKey arrival test (docs/YUBIKEYS.md). KEVIN runs this, one key at a
 * time; Claude never does.
 *
 *   node scripts/yubikey/arrival-test.mjs A --probe-size   (the first key only)
 *   node scripts/yubikey/arrival-test.mjs B
 *
 * For the key with that letter it checks:
 *   - the serial is that letter's and the firmware is 5.7 or later;
 *   - the key is genuine: a key made on it is attested by its factory
 *     certificate (one per production batch, so shared with other keys),
 *     which chains to Yubico's root, pinned by its SHA-256;
 *   - inside that signed attestation: the serial, the firmware, the form
 *     factor, PIN and touch for every use, and the very key that was made;
 *   - an Ed25519 signature made with the PIN and a touch verifies, the way the
 *     release code verifies (WebCrypto), and a changed message doesn't;
 *   - a second signature without a fresh PIN is refused;
 *   - afterwards the key is clean: the throwaway key deleted, and PIV as it
 *     left the factory, ready for the real setup.
 * With --probe-size, also the largest message the key will sign.
 *
 * The part that talks to the key is device.py, run by Yubico's `ykman script`.
 * What it hands back is checked here, in Node only (attestation.mjs).
 *
 * It writes only to ~/wivo-yubikey-arrival/<letter>-<serial>/: public keys,
 * certificates and signatures, nothing secret. It never writes the PIN anywhere.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atLeast, attestedFacts, checkChain, checkSignature } from './attestation.mjs'
import { KEYS, MIN_FIRMWARE, MIN_YKMAN } from './keys.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const letter = (process.argv[2] ?? '').toUpperCase()
const probe = process.argv.includes('--probe-size')
if (!(letter in KEYS)) {
  console.error('Usage: node scripts/yubikey/arrival-test.mjs <A|B|C|D> [--probe-size]')
  process.exit(64)
}
const serial = KEYS[letter]

const ykman = spawnSync('ykman', ['--version'], { encoding: 'utf8' })
const ykmanVersion = (ykman.stdout ?? '').match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
if (!ykmanVersion || !atLeast(ykmanVersion, MIN_YKMAN)) {
  console.error(`Needs ykman ${MIN_YKMAN.join('.')} or later (found: ${ykman.stdout?.trim() || 'none'}). Run: brew upgrade ykman`)
  process.exit(69)
}

const dir = join(homedir(), 'wivo-yubikey-arrival', `${letter}-${serial}`)
mkdirSync(dir, { recursive: true })
const out = join(dir, 'device.json')
writeFileSync(out, '{}')

console.log(`Key ${letter}, expected serial ${serial}. Insert only this key.\n`)
const run = spawnSync(
  'ykman',
  ['script', '--force', join(here, 'device.py'), String(serial), out, ...(probe ? ['--probe-size'] : [])],
  { stdio: 'inherit' },
)
const d = JSON.parse(readFileSync(out, 'utf8'))
if (run.status !== 0 && !d.after) {
  console.log(`\nKey ${letter}: STOPPED (above says why).`)
  console.log(`If it stopped after "Making a throwaway Ed25519 key", clean the key with: ykman --device ${serial} piv reset`)
  process.exit(1)
}

const results = []
let chain, facts, largestSigned, sizeLine
const check = (ok, text) => results.push({ ok: Boolean(ok), text })

check(d.serial === serial, `Serial ${d.serial} is key ${letter}'s (${serial})`)
check(d.version && atLeast(d.version, MIN_FIRMWARE), `Firmware ${d.version?.join('.')} is 5.7 or later`)
check(d.before && d.before.differs.length === 0, 'PIV was as it left the factory before the test')

if (d.attestation_pem && d.f9_pem) {
  writeFileSync(join(dir, 'attestation-9c.pem'), d.attestation_pem)
  writeFileSync(join(dir, 'f9.pem'), d.f9_pem)
  chain = checkChain({
    attestationPem: d.attestation_pem,
    f9Pem: d.f9_pem,
    intermediatesPem: readFileSync(join(here, 'yubico', 'yubico-intermediate.pem'), 'utf8'),
    rootPem: readFileSync(join(here, 'yubico', 'yubico-ca-1.pem'), 'utf8'),
  })
  check(chain.ok, `Genuine: the attestation chains to Yubico Attestation Root 1${chain.ok ? '' : ` (${chain.problems.join('; ')})`}`)
  const f = (facts = attestedFacts(d.attestation_pem))
  check(f.serial === serial, `Attested serial: ${f.serial}`)
  check(f.firmware && atLeast(f.firmware, MIN_FIRMWARE) && f.firmware.join('.') === d.version?.join('.'), `Attested firmware: ${f.firmware?.join('.')}`)
  check(f.formFactor === 'USB-C keychain' && f.fips === false, `Attested form factor: ${f.formFactor}${f.fips ? ' (FIPS)' : ''}`)
  check(f.pinPolicy === 'always' && f.touchPolicy === 'always', `Attested policy: PIN ${f.pinPolicy}, touch ${f.touchPolicy}`)
  check(f.keyType === 'ed25519' && f.publicKeyHex === d.public_key_hex, 'Attested key: the Ed25519 key just made on the key')
  check(d.slot?.generated && d.slot.key_type === 'ED25519', 'Slot 9c: made on the key, not imported')
} else {
  check(false, 'Genuine: no attestation came back from the key')
}

if (d.signature_hex) {
  const s = await checkSignature(d.public_key_hex, d.message_hex, d.signature_hex)
  check(s.node && s.webcrypto, 'Ed25519 signature with PIN and touch verifies (WebCrypto, as the release code, and Node)')
  check(s.changedRefused, 'A changed message is refused')
} else {
  check(false, `Ed25519 signature: none (${d.signature_error ? `refused ${d.signature_error}` : 'not made'})`)
}
check(d.without_pin === 'refused 6982', `A second signature without a fresh PIN: ${d.without_pin ?? 'not tried'}`)

if (probe) {
  const signed = []
  for (const p of d.probe ?? []) {
    if (!p.signature_hex) continue
    const message = Buffer.from('WIVOPROBE.'.repeat(Math.ceil(p.size / 10) + 1)).subarray(0, p.size)
    if ((await checkSignature(d.public_key_hex, message.toString('hex'), p.signature_hex)).webcrypto) signed.push(p.size)
  }
  const refused = (d.probe ?? []).find(p => p.refused)
  largestSigned = signed.at(-1) ?? 0
  sizeLine = `Largest message signed and verified: ${largestSigned} bytes${refused ? `; ${refused.size} refused (${refused.refused})` : ''}.`
}

check(d.after && d.after.differs.length === 0 && !d.delete_error, `Clean afterwards${d.after?.differs.length ? `: NOT (${d.after.differs.join('; ')})` : ': throwaway key deleted, PIV as it left the factory'}`)

console.log(`\nKey ${letter} (${serial}):`)
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.text}`)
// Here, not above the checks, where the probe's own lines buried it (key A, 2026-11-06).
if (sizeLine) console.log(`  size  ${sizeLine}`)
const passed = results.every(r => r.ok)
writeFileSync(join(dir, 'report.json'), JSON.stringify({ letter, serial, at: new Date().toISOString(), passed, results, chain, facts, largestSigned }, null, 2))
console.log(`\n${passed ? 'PASSED' : 'FAILED'}. Kept in ${dir}`)
if (!passed && d.after?.differs.length) console.log(`To clean the key: ykman --device ${serial} piv reset`)
process.exit(passed ? 0 : 1)
