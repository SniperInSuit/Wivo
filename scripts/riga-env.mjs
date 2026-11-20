/**
 * The checks behind Riga's temporary installer (scripts/build-riga.mjs,
 * docs/RIGA-TEMPORARY.md). Pure, so scripts/rigaBuild.test.ts can run them.
 *
 * The installer carries two public values, Riga's project URL and its public
 * (anon / publishable) key, and nothing else. This file refuses anything
 * that could be more: a secret key, an access token, a Resend key, a private
 * key, a JWT that is not the public key, a project that is production's or
 * the test copy's, a key that belongs to another project than the URL.
 */

/** Keep in step with src/renderer/src/lib/testCopy.ts: rigaBuild.test.ts compares them. */
export const PRODUCTION_REF = 'wrtucsfmpbwekugzzzxw'
export const TEST_REF = 'jhqyvancrzykxhzwnost'

export const RIGA_ENV_NAMES = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g

/** Secrets that may not appear anywhere: in riga.env (comments included) or in the built app. */
export const SECRETS = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, 'a secret key (sb_secret_)'],
  [/sbp_[A-Za-z0-9]{8,}/, 'a Supabase access token (sbp_)'],
  [/\bre_[A-Za-z0-9_]{8,}/, 'a Resend key (re_)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
]

export function jwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** The project ref of `https://<ref>.supabase.co`, or null. */
export function refOf(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url.trim())
  return m ? m[1] : null
}

/**
 * Parse riga.env. `problems` empty means the build may go ahead.
 * @returns {{ url: string, key: string, ref: string, problems: string[] }}
 */
export function parseRigaEnv(text) {
  const values = new Map()
  const problems = []
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/^﻿/, '').trim() // Notepad and PowerShell 5.1 may write a BOM
    if (line === '' || line.startsWith('#')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) { problems.push(`line ${i + 1} is not NAME=value`); continue }
    const [, name, value] = m
    if (!RIGA_ENV_NAMES.includes(name)) problems.push(`${name}: only ${RIGA_ENV_NAMES.join(' and ')} belong here`)
    else if (values.has(name)) problems.push(`${name} is set twice`)
    else values.set(name, value.replace(/^(['"])(.*)\1$/, '$2').trim())
  }
  const url = values.get('VITE_SUPABASE_URL') ?? ''
  const key = values.get('VITE_SUPABASE_ANON_KEY') ?? ''

  const ref = refOf(url)
  if (!url) problems.push('VITE_SUPABASE_URL is missing')
  else if (!ref) problems.push('VITE_SUPABASE_URL must look like https://<20 letters and digits>.supabase.co')
  else if (ref === PRODUCTION_REF) problems.push("VITE_SUPABASE_URL is production's (Tallinn's old project), not Riga's")
  else if (ref === TEST_REF) problems.push("VITE_SUPABASE_URL is the test copy's, not Riga's")

  if (!key) problems.push('VITE_SUPABASE_ANON_KEY is missing')
  else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    const payload = jwtPayload(key)
    if (!payload) problems.push('VITE_SUPABASE_ANON_KEY is not a public key (the anon JWT, or sb_publishable_…)')
    else if (payload.role !== 'anon') problems.push(`VITE_SUPABASE_ANON_KEY is a ${String(payload.role ?? 'role-less')} key, not the anon key`)
    else if (ref && typeof payload.ref === 'string' && payload.ref !== ref) problems.push("VITE_SUPABASE_ANON_KEY belongs to another project than VITE_SUPABASE_URL's")
  }

  for (const [shape, what] of SECRETS) if (shape.test(text)) problems.push(`it holds ${what}`)
  if ((text.match(JWT) ?? []).some(token => token !== key)) problems.push('it holds a token outside VITE_SUPABASE_ANON_KEY')
  return { url: url.replace(/\/$/, ''), key, ref: ref ?? '', problems }
}

/**
 * What a built app (out/, or the unpacked app) may not hold: a secret of the
 * shapes above, or any JWT that is not the public key. (A project ref is not
 * searched for: lib/testCopy.ts carries production's and the test copy's on
 * purpose, to refuse them.)
 * @param {string} text  one file's text (latin1 is fine; an asar is scanned the same way)
 * @param {string} key   the public key the build was given
 */
export function forbiddenIn(text, key) {
  const found = []
  for (const [shape, what] of SECRETS) if (shape.test(text)) found.push(what)
  for (const token of new Set(text.match(JWT) ?? [])) {
    if (token === key) continue
    const role = jwtPayload(token)?.role
    found.push(`a token that is not the public key (role: ${String(role ?? 'none')})`)
  }
  return found
}
