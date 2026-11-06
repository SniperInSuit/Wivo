/**
 * The YubiKey setup (docs/YUBIKEYS.md §3): what each key gets, and the checks
 * of what it has. Pure: setup-key.mjs drives the key through setup-device.py,
 * and the tests feed made-up states.
 */
import { createHash, X509Certificate } from 'node:crypto'
import { atLeast, attestedFacts, checkChain } from './attestation.mjs'
import { BATCH_F9_SHA256, KEYS, MIN_FIRMWARE } from './keys.mjs'

const SIGNING_SLOTS = [
  { slot: '9c', purpose: 'update' },
  { slot: '82', purpose: 'app' },
  { slot: '83', purpose: 'licence' },
]

/**
 * Kevin's decisions (2026-11-06): NFC off on all four; OTP, OATH, OpenPGP and
 * YubiHSM Auth off; the roots keep only PIV; C and D also FIDO2, with U2F.
 * `paper`: where a root's PIN on paper is kept, crosswise.
 */
export const PLAN = {
  A: { role: 'root A', slots: [{ slot: '9c', purpose: 'root' }], usb: ['PIV'], paper: 'root B' },
  B: { role: 'root B', slots: [{ slot: '9c', purpose: 'root' }], usb: ['PIV'], paper: 'root A' },
  C: { role: 'the signing key', slots: SIGNING_SLOTS, usb: ['U2F', 'FIDO2', 'PIV'] },
  D: { role: 'the spare signing key', slots: SIGNING_SLOTS, usb: ['U2F', 'FIDO2', 'PIV'] },
}

/** A certifies C's and D's keys, so it comes after them. */
export const ORDER = ['C', 'D', 'A', 'B']

/**
 * A key's name in certificates and lists: its purpose, its YubiKey, and the
 * start of its public key's SHA-256, so a key made again gets a new name.
 */
export const keyId = (purpose, letter, publicKeyHex) =>
  `${purpose}-${letter}-${createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest('hex').slice(0, 8)}`

/** The keys a set-up YubiKey holds, from what the setup recorded (piv.json). */
export const keysOf = (letter, piv) => PLAN[letter].slots.map(({ slot, purpose }) => {
  const hex = piv.slots[slot].public_key_hex
  return { slot, purpose, id: keyId(purpose, letter, hex), public_key_hex: hex, public_key: Buffer.from(hex, 'hex').toString('base64url') }
})

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))
const fullTries = ([left, total]) => left === total
/**
 * A wrong PIN typed once is fine: the next right one resets the count, so it
 * mustn't block the run that asks for it. With one try left, everything stops
 * before a third wrong PIN can block the key.
 */
const triesOk = ([left]) => left >= 2
const triesText = ([left, total]) => `${left} of ${total} tries left${left === 1 ? ': stop, and tell Claude before typing it again' : ''}`

/**
 * 'factory': as it left the factory, ready for the setup.
 * 'ours': set up by an earlier run, holding exactly the keys it recorded.
 * 'other': neither; nothing is done to it.
 */
export function pivSituation(letter, state, saved) {
  const used = Object.keys(state.slots)
  if (state.pin.default && state.puk.default && state.management_key.default
      && fullTries(state.pin.tries) && fullTries(state.puk.tries) && used.length === 0) return 'factory'
  const planned = PLAN[letter].slots.map(s => s.slot)
  const ours = saved?.complete === true && !state.pin.default && !state.puk.default && !state.management_key.default
    && sameSet(used, planned) && planned.every(s => state.slots[s].public_key_hex === saved.slots?.[s]?.public_key_hex)
  return ours ? 'ours' : 'other'
}

/**
 * One key's attestation: the batch's factory certificate, Yubico's chain from
 * it to the pinned root, and what the key states in it. Empty when all is well.
 */
export function attestationProblems(letter, made, f9Pem, yubico, firmware) {
  const problems = [...checkChain({ attestationPem: made.attestation_pem, f9Pem, ...yubico }).problems]
  if (new X509Certificate(f9Pem).fingerprint256 !== BATCH_F9_SHA256) problems.push("the factory certificate is not the batch's from the arrival test")
  const f = attestedFacts(made.attestation_pem)
  if (f.serial !== KEYS[letter]) problems.push(`it states serial ${f.serial}`)
  if (f.firmware?.join('.') !== firmware.join('.')) problems.push(`it states firmware ${f.firmware?.join('.')}`)
  if (f.pinPolicy !== 'always' || f.touchPolicy !== 'always') problems.push(`it states PIN ${f.pinPolicy}, touch ${f.touchPolicy}`)
  if (f.keyType !== 'ed25519' || f.publicKeyHex !== made.public_key_hex) problems.push('it is not the Ed25519 key recorded')
  return problems
}

/** PIV, read back from the key (`state`) against what the setup made (`piv`). */
export function checkPiv(letter, state, piv, yubico) {
  const serial = KEYS[letter]
  const results = []
  const check = (ok, text) => results.push({ ok: Boolean(ok), text })
  check(state.serial === serial, `Serial ${state.serial} is key ${letter}'s (${serial})`)
  check(atLeast(state.version, MIN_FIRMWARE), `Firmware ${state.version.join('.')} is 5.7 or later`)
  check(new X509Certificate(state.f9_pem).fingerprint256 === BATCH_F9_SHA256, "The factory certificate (f9) is the batch's, as in the arrival test")
  check(!state.pin.default && triesOk(state.pin.tries), `A new PIN, not the factory's; ${triesText(state.pin.tries)}`)
  check(!state.puk.default && triesOk(state.puk.tries), `A new PUK, not the factory's; ${triesText(state.puk.tries)}`)
  const m = state.management_key
  check(m.type === 'AES256' && !m.default && m.stored_under_pin,
    `Management key: ${m.type}, ${m.default ? "the factory's" : 'random'}, ${m.stored_under_pin ? 'kept on the key under the PIN' : 'NOT kept under the PIN'}`)
  const extra = Object.keys(state.slots).filter(s => !PLAN[letter].slots.some(p => p.slot === s))
  check(extra.length === 0, extra.length ? `Keys in slots outside the plan: ${extra.join(', ')}` : 'No keys in other slots')
  for (const { slot, purpose } of PLAN[letter].slots) {
    const made = piv.slots?.[slot]
    const now = state.slots[slot]
    check(made && now?.key_type === 'ED25519' && now.generated && now.pin_policy === 'ALWAYS' && now.touch_policy === 'ALWAYS'
      && now.public_key_hex === made.public_key_hex,
      `Slot ${slot}, ${made ? keyId(purpose, letter, made.public_key_hex) : purpose}: Ed25519 made on the key, PIN and touch for every use`)
    const problems = made ? attestationProblems(letter, made, state.f9_pem, yubico, state.version) : ['nothing recorded']
    check(problems.length === 0, `Slot ${slot}: attested, up to Yubico's root${problems.length ? ` (${problems.join('; ')})` : ''}`)
  }
  return results
}

const listed = caps => (caps.length ? caps.join(', ') : 'nothing')

export function checkConfig(letter, state) {
  const usb = state.enabled.usb ?? [], nfc = state.enabled.nfc ?? []
  const want = PLAN[letter].usb
  return [
    { ok: sameSet(usb, want), text: `Over USB: ${listed(usb)}${sameSet(usb, want) ? '' : ` (should be ${listed(want)})`}` },
    { ok: nfc.length === 0, text: `Over NFC: ${listed(nfc)}${nfc.length ? ' (should be nothing)' : ''}` },
  ]
}

/** The `ykman` commands that bring the key to the plan; none once it is there. */
export function configCommands(letter, enabled) {
  const serial = String(KEYS[letter]), want = PLAN[letter].usb
  const usb = enabled.usb ?? [], nfc = enabled.nfc ?? []
  const commands = []
  if (nfc.length) commands.push(['--device', serial, 'config', 'nfc', '--disable-all', '--force'])
  const on = want.filter(c => !usb.includes(c)), off = usb.filter(c => !want.includes(c))
  if (on.length || off.length) {
    commands.push(['--device', serial, 'config', 'usb', ...on.flatMap(c => ['--enable', c]), ...off.flatMap(c => ['--disable', c]), '--force'])
  }
  return commands
}

/** What a key signs to show it works. No release, certificate or licence starts this way, so it can't pass for one. */
export const testStatement = id => `WIVOTEST1.setup check: ${id}`

const day = d => d.toISOString().slice(0, 10)

/**
 * Root A's certificates for C's and D's update and app keys, from `today` for
 * two years (docs/ARCHITECTURE-INSTANCES.md §5e). Licence keys get none: the
 * app pins them itself.
 */
export function certificatePayloads(rootId, keys, today) {
  const from = new Date(`${today}T00:00:00Z`)
  const to = new Date(Date.UTC(from.getUTCFullYear() + 2, from.getUTCMonth(), from.getUTCDate()))
  return keys.filter(k => k.purpose === 'update' || k.purpose === 'app').map(k => ({
    v: 1, key_id: k.id, public_key: k.public_key, purpose: k.purpose,
    not_before: `${day(from)}T00:00:00Z`, not_after: `${day(to)}T00:00:00Z`, root_id: rootId,
  }))
}

export const certificateLabel = c =>
  `${c.key_id} may sign ${c.purpose === 'update' ? 'update packages and lists' : 'desktop releases'}, ${c.not_before.slice(0, 10)} to ${c.not_after.slice(0, 10)}`

/** public.json: what the next steps need (pinning, certifying), and nothing secret. */
export function publicRecord(letter, state, piv, extra) {
  return {
    letter, serial: KEYS[letter], role: PLAN[letter].role, version: state.version, f9_pem: state.f9_pem,
    keys: keysOf(letter, piv).map(k => ({ ...k, attestation_pem: piv.slots[k.slot].attestation_pem })),
    ...extra,
  }
}
