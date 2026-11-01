#!/usr/bin/env node
/**
 * The spec's "API self-check", against a REAL project (the test project —
 * never production): signed in as the Riga test user, call PostgREST and
 * Storage directly for Tallinn's data. Every call must come back empty or
 * refused. Release condition: if this fails, there is no release.
 *
 * The same rules are tested on every `npm test` in PGlite (sql/test/*). This
 * script checks what PGlite cannot: that the DEPLOYED database, PostgREST and
 * Storage agree with them.
 *
 *   SUPABASE_URL=https://<test-ref>.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   RIGA_EMAIL=riga-test@... RIGA_PASSWORD=... \
 *   TALLINN_ORG_ID=<uuid> TALLINN_JOB_ID=<an UNshared job> \
 *   node scripts/leak-check.mjs
 *
 * Exit code 0 = nothing leaked. 1 = something did; each leak is printed.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const env = name => {
  const v = process.env[name]
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}
const url = env('SUPABASE_URL')
if (/wrtucsfmpbwekugzzzxw/.test(url)) { console.error('Refusing to run against the production project.'); process.exit(2) }

const db = createClient(url, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
const TALLINN = env('TALLINN_ORG_ID')
const JOB = env('TALLINN_JOB_ID')

const { data: session, error: loginError } = await db.auth.signInWithPassword({ email: env('RIGA_EMAIL'), password: env('RIGA_PASSWORD') })
if (loginError) { console.error('Login failed:', loginError.message); process.exit(2) }
const me = session.user.id
const { data: myProfile } = await db.from('profiles').select('clinic_id').eq('id', me).single()
const RIGA = myProfile?.clinic_id
if (!RIGA || RIGA === TALLINN) { console.error('The test user must belong to the Riga organisation.'); process.exit(2) }

const leaks = []
const leak = (what, detail) => { leaks.push(what); console.log(`LEAK  ${what}${detail ? ` — ${detail}` : ''}`) }
const ok = what => console.log(`ok    ${what}`)

// Every table the migrations create, read straight from sql/.
const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql')
const tables = new Set()
for (const f of readdirSync(sqlDir).filter(f => /^\d{3}_.*\.sql$/.test(f))) {
  for (const m of readFileSync(join(sqlDir, f), 'utf8').matchAll(/create table if not exists public\.(\w+)/gi)) tables.add(m[1])
}

/** A row "belongs to Tallinn" if any organisation column says so. */
const ORG_COLUMNS = ['clinic_id', 'org_id', 'owner_org', 'org_a', 'org_b', 'partner_org']
for (const table of [...tables].sort()) {
  const { data, error } = await db.from(table).select('*').limit(1000)
  if (error) { ok(`${table}: refused (${error.code ?? error.message})`); continue }
  const foreign = (data ?? []).filter(row =>
    ORG_COLUMNS.some(c => row[c] === TALLINN) && !(row.partner_org === RIGA || row.org_a === RIGA || row.org_b === RIGA))
  if (table === 'clinics') {
    if ((data ?? []).some(r => r.id === TALLINN)) leak('clinics: Tallinn readable')
    else ok('clinics')
    continue
  }
  if (table === 'jobs' && (data ?? []).some(r => r.id === JOB)) leak('jobs: the unshared Tallinn job is readable')
  if (foreign.length) leak(`${table}: ${foreign.length} Tallinn rows`)
  else ok(table)
}

// The partner layer must not hand over what was not shared.
const pv = await db.from('partner_job_view').select('job_id').eq('job_id', JOB)
if ((pv.data ?? []).length) leak('partner_job_view returns the unshared job'); else ok('partner_job_view')
for (const [fn, args] of [
  ['open_partner_job', { p_job: JOB }], ['job_thread', { p_job: JOB }], ['job_files', { p_job: JOB }],
  ['request_job_previews', { p_job: JOB }], ['move_job_stage', { p_job: JOB, p_to: 'valmis' }],
  ['post_job_comment', { p_job: JOB, p_body: 'leak-check' }], ['patient_export', { p_patient: JOB }],
]) {
  const { data, error } = await db.rpc(fn, args)
  if (!error && data && (!Array.isArray(data) || data.length)) leak(`rpc ${fn} answered for an unshared job`)
  else ok(`rpc ${fn}`)
}

// Storage: nothing under Tallinn's prefix, no signed link for its objects.
const list = await db.storage.from('job-files').list(TALLINN, { limit: 100 })
if ((list.data ?? []).length) leak(`storage: ${list.data.length} entries listed under Tallinn`); else ok('storage list')
const signed = await db.storage.from('job-files').createSignedUrl(`${TALLINN}/${JOB}/anything`, 60)
if (signed.data?.signedUrl) leak('storage: signed URL issued for a Tallinn path'); else ok('storage signed URL')

console.log(leaks.length ? `\n${leaks.length} LEAK(S). No release.` : '\nNothing leaked.')
process.exit(leaks.length ? 1 : 0)
