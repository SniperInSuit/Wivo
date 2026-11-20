#!/usr/bin/env node
/**
 * Riga's temporary Windows installer (docs/RIGA-TEMPORARY.md). Run on Kevin's
 * machine, never in CI:
 *
 *   npm run dist:riga
 *
 * What it does, in order, and stops at the first refusal:
 *   1. branch is `testing`, working tree clean (so the installer is a known commit);
 *   2. reads riga.env (two public values), refuses production's and the test
 *      copy's project, a key that is not the public one, any secret;
 *   3. builds with those two values in the PROCESS environment (they win over
 *      the root .env, which is not read for them and may hold production's),
 *      the other Wivo variables blanked, and no token from the environment
 *      passed on (nothing here talks to GitHub);
 *   4. scans the built app (out/) for a secret or a JWT that is not the key;
 *   5. packages with scripts/electron-builder.riga.cjs: no `.env` resource,
 *      output in dist-riga/, nothing published;
 *   6. checks the package holds no .env and none of the above, and prints the
 *      installer's SHA-256 for the handover.
 *
 * It sends nothing anywhere and reads no secret: riga.env holds only what
 * ships in every phone's bundle anyway.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forbiddenIn, parseRigaEnv } from './riga-env.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = 'dist-riga'

const fail = (msg) => { console.error(`\nRefused: ${msg}\n`); process.exit(1) }
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const run = (script, args, env) => execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env, stdio: 'inherit' })

/** Every file under `dir` up to `maxBytes`, as [path, latin1 text]. */
function* filesIn(dir, maxBytes) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* filesIn(p, maxBytes)
    else if (st.size <= maxBytes) yield [p, readFileSync(p, 'latin1')]
  }
}

function scan(dir, key, maxBytes) {
  const bad = []
  let n = 0
  for (const [p, text] of filesIn(dir, maxBytes)) {
    n++
    for (const what of forbiddenIn(text, key)) bad.push(`${p}: ${what}`)
  }
  if (bad.length) fail(`the build holds what it may not:\n  ${bad.join('\n  ')}`)
  console.log(`  scanned ${n} files in ${dir}: no secret, no other token`)
}

function findEnvFiles(dir) {
  const hits = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) hits.push(...findEnvFiles(p))
    else if (name === '.env' || name.startsWith('.env.')) hits.push(p)
  }
  return hits
}

// 1. a known commit
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'testing') fail(`the branch is "${branch}"; the installer is built from testing`)
if (git('status', '--porcelain') !== '') fail('the working tree has changes; commit or stash them first, so the installer is a known commit')
const commit = git('rev-parse', '--short', 'HEAD')

// 2. the two public values
const envPath = join(ROOT, 'riga.env')
if (!existsSync(envPath)) fail('riga.env is missing (docs/RIGA-TEMPORARY.md, step A3)')
const rigaEnv = parseRigaEnv(readFileSync(envPath, 'utf8'))
if (rigaEnv.problems.length) fail(`riga.env:\n  ${rigaEnv.problems.join('\n  ')}`)
console.log(`Riga's project: ${rigaEnv.ref} · commit ${commit}`)

// 3. the build, with a clean environment
const env = {}
for (const [name, value] of Object.entries(process.env)) {
  if (/token|secret|password|passwd|credential|api_?key/i.test(name)) continue // GH_TOKEN and the like: not passed on
  if (name.startsWith('VITE_') || name.startsWith('MAIN_VITE_') || name.startsWith('RENDERER_VITE_') || name.startsWith('PRELOAD_VITE_')) continue
  env[name] = value
}
Object.assign(env, {
  VITE_SUPABASE_URL: rigaEnv.url,
  VITE_SUPABASE_ANON_KEY: rigaEnv.key,
  MAIN_VITE_SENTRY_DSN: '', // Riga's errors do not go to a project of Tallinn's
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  WIN_CSC_LINK: '',
})
console.log('\nBuilding the app…')
run('node_modules/electron-vite/bin/electron-vite.js', ['build'], env)

// 4. scan the build
console.log('\nChecking the build…')
scan(join(ROOT, 'out'), rigaEnv.key, 50_000_000)

// 5. package
console.log('\nPackaging…')
run('node_modules/electron-builder/cli.js',
  ['--win', '--x64', '--publish', 'never', '--config', 'scripts/electron-builder.riga.cjs', '--config.forceCodeSigning=false'], env)

// 6. check the package
console.log('\nChecking the package…')
const unpacked = join(ROOT, OUT, 'win-unpacked')
if (!existsSync(unpacked)) fail(`${OUT}/win-unpacked is missing, so the package cannot be checked`)
const envFiles = findEnvFiles(unpacked)
if (envFiles.length) fail(`the package holds an env file:\n  ${envFiles.join('\n  ')}`)
console.log('  no .env in the package')
scan(join(unpacked, 'resources'), rigaEnv.key, 50_000_000)

const exes = readdirSync(join(ROOT, OUT)).filter(f => /^Wivo-Riga-Setup-.*\.exe$/.test(f))
if (exes.length !== 1) fail(`expected one installer in ${OUT}/, found ${exes.length}`)
const sha = createHash('sha256').update(readFileSync(join(ROOT, OUT, exes[0]))).digest('hex')
console.log(`\nDone.\n  Installer: ${OUT}/${exes[0]}\n  Commit:    ${commit}\n  Project:   ${rigaEnv.ref}\n  SHA-256:   ${sha}\n`)
console.log('Send the SHA-256 by another channel than the installer. Windows will warn that the file is unsigned: that is expected.')
