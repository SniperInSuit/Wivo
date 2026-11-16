#!/usr/bin/env node
/**
 * Handover export of ONE clinic's Supabase project. YOU run this; a clinic
 * never does, and neither does Claude.
 *
 *   node scripts/export-clinic.mjs
 *
 * It asks for three things, one at a time, and nothing else:
 *   1. the project ref        (the sub-domain, e.g. abcdefghijklmnop)
 *   2. the database URL       (Supabase → Settings → Database → Connection string)
 *   3. the service_role key   (Supabase → Settings → API)
 * then a password for the archive, typed twice.
 *
 * ── Read-only, by construction ──────────────────────────────────────────────
 * `pg_dump` and `psql \copy … TO` only read. The Storage calls are GET and
 * LIST. There is no INSERT, UPDATE, DELETE, COPY FROM or Storage upload in
 * this file, and the one `psql` invocation that runs SQL runs it inside a
 * `read only` transaction, so the server refuses a write even if one were ever
 * added here by mistake.
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *   <out>/database.dump          pg_dump custom format (restore with pg_restore)
 *   <out>/csv/<schema>.<table>.csv  every table, header row included
 *   <out>/storage/<bucket>/<path>   every object, original folder structure
 *   <out>/README.md              what is inside, row counts, SHA-256 of each file
 * and then packs that folder into `<out>.7z` — AES-256 with the header
 * encrypted, so the file NAMES are behind the password as well as the
 * contents — and deletes the unencrypted folder. Opening it needs 7-Zip;
 * Windows Explorer cannot open a .7z at all.
 *
 * ── What it never does ──────────────────────────────────────────────────────
 * The service key, the database URL and the archive password are read with the
 * terminal echo off, held in memory only, never written to a file, never
 * printed, and never passed as a command-line argument — on Windows any other
 * process on the machine can read another process's command line, so a secret
 * in `argv` is a secret on display. They go to the child processes in their
 * environment instead. The one exception is 7-Zip, which has no other way to
 * take a password; see `packFolder`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { stdin, stdout, exit } from 'node:process'

// ── Asking ───────────────────────────────────────────────────────────────────

const ask = (question, { secret = false } = {}) => new Promise(resolveAnswer => {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true })
  if (secret) {
    // `terminal: true` echoes every keystroke. Swallowing the output while the
    // answer is being typed is the only way readline offers to hide it, and
    // the prompt itself still has to reach the screen.
    stdout.write(question)
    rl._writeToOutput = () => {}
  }
  rl.question(secret ? '' : question, answer => {
    rl.close()
    if (secret) stdout.write('\n')
    resolveAnswer(answer.trim())
  })
})

const die = (message) => { console.error(`\n${message}\n`); exit(1) }

// ── Finding the tools ────────────────────────────────────────────────────────

/**
 * Where a Windows install of the PostgreSQL client tools puts itself, newest
 * first. Looked up rather than required on PATH because the installer does not
 * add it, and "pg_dump is not recognized" is the first thing that goes wrong.
 */
function findPgTool(name) {
  const onPath = spawnSync(name, ['--version'], { shell: false })
  if (onPath.status === 0) return name
  const roots = ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL']
  const found = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const version of readdirSync(root)) {
      const exe = join(root, version, 'bin', `${name}.exe`)
      if (existsSync(exe)) found.push({ version: Number(version) || 0, exe })
    }
  }
  found.sort((a, b) => b.version - a.version)
  return found[0]?.exe ?? null
}

function find7z() {
  const onPath = spawnSync('7z', ['i'], { shell: false })
  if (onPath.status === 0) return '7z'
  for (const exe of ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe']) {
    if (existsSync(exe)) return exe
  }
  return null
}

/** Runs a child process, inheriting the console, and rejects on a bad exit. */
const run = (exe, args, env) => new Promise((ok, no) => {
  const child = spawn(exe, args, { env: { ...process.env, ...env }, stdio: 'inherit', shell: false })
  child.on('error', no)
  child.on('close', code => (code === 0 ? ok() : no(new Error(`${exe} exited with ${code}`))))
})

/** Same, but captures stdout instead of showing it. */
const capture = (exe, args, env) => new Promise((ok, no) => {
  const child = spawn(exe, args, { env: { ...process.env, ...env }, shell: false })
  let out = ''
  let err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  child.on('error', no)
  child.on('close', code => (code === 0 ? ok(out) : no(new Error(err.trim() || `${exe} exited with ${code}`))))
})

// ── The connection, without putting it in argv ───────────────────────────────

/**
 * Splits the connection string into the environment variables the PostgreSQL
 * tools read, so neither the password nor the URL appears in a command line.
 */
function pgEnvFrom(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    die('That does not look like a connection string. It starts with postgresql:// and\n'
      + 'is on Supabase → Settings → Database → Connection string → URI.')
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) die('The connection string must start with postgresql://')
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    // Supabase requires TLS. Without this the tools may negotiate plaintext
    // and the connection is refused with a message about SSL that reads like a
    // wrong password.
    PGSSLMODE: 'require',
    // So a stray prompt can never leave the script waiting for a keystroke
    // nobody is there to give.
    PGCONNECT_TIMEOUT: '15',
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** Every ordinary table in the schemas worth handing over. */
async function listTables(psql, env) {
  const sql = `
    select table_schema || '.' || table_name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('public', 'storage', 'auth')
    order by 1`
  const out = await capture(psql, [
    '--no-psqlrc', '--tuples-only', '--no-align', '--quiet',
    // Read-only at the SERVER, not just by intention: the whole session
    // refuses a write, whatever is sent down it.
    '--command', 'begin read only',
    '--command', sql,
  ], env)
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

async function dumpDatabase(pgDump, env, outDir) {
  console.log('\n[1/4] Database → database.dump')
  await run(pgDump, [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--verbose',
    `--file=${join(outDir, 'database.dump')}`,
  ], env)
}

async function dumpCsv(psql, env, outDir, tables) {
  console.log(`\n[2/4] ${tables.length} tables → csv/`)
  const csvDir = join(outDir, 'csv')
  mkdirSync(csvDir, { recursive: true })
  const counts = {}
  for (const qualified of tables) {
    const [schema, table] = qualified.split('.')
    const file = join(csvDir, `${schema}.${table}.csv`)
    // `\copy` runs client-side, so it writes where this script can reach and
    // needs no server file permissions. The identifiers are quoted because a
    // table may be named with a reserved word or mixed case.
    await run(psql, [
      '--no-psqlrc', '--quiet',
      '--command', 'begin read only',
      '--command', `\\copy (select * from "${schema}"."${table}") to '${file.replace(/\\/g, '/')}' with (format csv, header true)`,
    ], env)
    // The header line is not a row.
    counts[qualified] = Math.max(0, readFileSync(file, 'utf8').split('\n').filter(Boolean).length - 1)
    process.stdout.write(`  ${qualified}: ${counts[qualified]}\n`)
  }
  return counts
}

/** Storage, over the REST API, with the service key. Listing and GET only. */
async function dumpStorage(ref, serviceKey, outDir) {
  console.log('\n[3/4] Storage → storage/')
  const base = `https://${ref}.supabase.co/storage/v1`
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  const bucketsRes = await fetch(`${base}/bucket`, { headers })
  if (!bucketsRes.ok) {
    throw new Error(`Storage: could not list buckets (${bucketsRes.status}). `
      + 'Check the project ref and that the key is the service_role one.')
  }
  const buckets = await bucketsRes.json()
  const files = []

  for (const bucket of buckets) {
    // The list endpoint pages and does not recurse, so each folder is asked
    // for in turn. A bucket with more than `limit` entries in one folder would
    // otherwise come back silently short.
    const queue = ['']
    while (queue.length > 0) {
      const prefix = queue.shift()
      let offset = 0
      for (;;) {
        const res = await fetch(`${base}/object/list/${encodeURIComponent(bucket.name)}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
        })
        if (!res.ok) throw new Error(`Storage: listing ${bucket.name}/${prefix} failed (${res.status})`)
        const page = await res.json()
        for (const entry of page) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name
          // A folder comes back with no id.
          if (entry.id === null || entry.id === undefined) queue.push(path)
          else files.push({ bucket: bucket.name, path })
        }
        if (page.length < 100) break
        offset += page.length
      }
    }
  }

  for (const f of files) {
    const res = await fetch(`${base}/object/${encodeURIComponent(f.bucket)}/${f.path.split('/').map(encodeURIComponent).join('/')}`, { headers })
    if (!res.ok) throw new Error(`Storage: downloading ${f.bucket}/${f.path} failed (${res.status})`)
    const target = join(outDir, 'storage', f.bucket, ...f.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(await res.arrayBuffer()))
  }
  console.log(`  ${buckets.length} buckets, ${files.length} files`)
  return { buckets: buckets.map(b => b.name), fileCount: files.length }
}

/** Every file under `dir`, with its size and SHA-256. */
function inventory(dir) {
  const rows = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      rows.push({
        path: relative(dir, full).replace(/\\/g, '/'),
        bytes: statSync(full).size,
        sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
      })
    }
  }
  walk(dir)
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}

function writeReadme(outDir, { ref, counts, storage, when }) {
  const rows = inventory(outDir)
  const total = rows.reduce((n, r) => n + r.bytes, 0)
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

  const body = `# Wivo — clinic export

Project: \`${ref}\`
Taken: ${when}
Contents: ${rows.length} files, ${mb(total)}

This is a complete copy of the clinic's data as it stood at the time above.
Nothing in the project was changed to produce it: the export only reads.

## Opening this

You are reading this because the archive is already open. It is a \`.7z\` with
AES-256 encryption and an encrypted header, so **7-Zip is needed** to open it —
Windows Explorer cannot, and without the password 7-Zip will not even list the
file names. Get it from https://www.7-zip.org/.

## What is inside

| Folder | What it is |
|---|---|
| \`database.dump\` | The whole database, pg_dump custom format. Restore with \`pg_restore\`. |
| \`csv/\` | The same tables as CSV, one file per table, first row is the column names. Open in Excel. |
| \`storage/\` | Every uploaded file, in its original bucket and folder. |

The dump and the CSVs hold the same data twice, on purpose: the dump is what
you restore into a database, the CSVs are what a person can read without one.

## Rows per table

| Table | Rows |
|---|---|
${Object.entries(counts).map(([t, n]) => `| \`${t}\` | ${n} |`).join('\n')}

## Storage

${storage.buckets.length} buckets (${storage.buckets.map(b => `\`${b}\``).join(', ') || 'none'}), ${storage.fileCount} files.

## Checksums

SHA-256 of every file, so the archive can be checked after it is copied.

| File | Bytes | SHA-256 |
|---|---|---|
${rows.map(r => `| \`${r.path}\` | ${r.bytes} | \`${r.sha256}\` |`).join('\n')}
`
  writeFileSync(join(outDir, 'README.md'), body, 'utf8')
  return rows.length
}

/**
 * AES-256 .7z with the header encrypted, so the NAMES are behind the password
 * too.
 *
 * ── Why not a ZIP ───────────────────────────────────────────────────────────
 * A ZIP keeps its central directory in the clear whatever the encryption, so
 * the contents of each file would be unreadable while the list of names —
 * `csv/public.patients.csv` and the rest — stayed readable to anyone holding
 * the archive. For a clinic handover the names are themselves information: how
 * many buckets, which tables, that there are patients at all.
 *
 * `-mhe=on` is a .7z-only switch: it encrypts the header, and 7-Zip then asks
 * for the password before it will even list the archive. The cost is that
 * Windows Explorer cannot open a .7z at all, so the clinic needs 7-Zip — which
 * it needed anyway, because Explorer has never supported AES-256 ZIP either.
 *
 * ── The password is on the command line ─────────────────────────────────────
 * 7-Zip offers no other way to give it one: no stdin option, no password file.
 * On Windows another process can read this one's command line while it runs,
 * so for the seconds this takes the password is visible on the machine. That
 * is a real limitation and the reason the password should be one used for this
 * archive and nothing else.
 */
async function packFolder(sevenZip, outDir, password) {
  console.log('\n[4/4] Packing')
  const archivePath = `${outDir}.7z`
  if (existsSync(archivePath)) rmSync(archivePath)
  await run(sevenZip, [
    'a', '-t7z', '-m0=lzma2', '-mx=5', '-mhe=on', `-p${password}`, '-bso0', '-bsp1',
    archivePath, outDir,
  ])
  return archivePath
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nWivo — clinic handover export\n'
    + 'Reads one Supabase project and writes an encrypted archive. Changes nothing.\n')

  const pgDump = findPgTool('pg_dump')
  const psql = findPgTool('psql')
  const sevenZip = find7z()
  if (!pgDump || !psql) {
    die('PostgreSQL client tools not found.\n'
      + 'Install them from https://www.postgresql.org/download/windows/ (the\n'
      + 'installer may be called "PostgreSQL"; only "Command Line Tools" is needed),\n'
      + 'then run this again.')
  }
  if (!sevenZip) {
    die('7-Zip not found.\nInstall it from https://www.7-zip.org/ and run this again.')
  }

  const ref = await ask('Project ref (the sub-domain, e.g. abcdefghijklmnop): ')
  if (!/^[a-z0-9]{16,24}$/.test(ref)) die('A project ref is 16–24 lowercase letters and digits.')

  const dbUrl = await ask('Database connection string (hidden): ', { secret: true })
  if (!dbUrl) die('No connection string given.')
  const env = pgEnvFrom(dbUrl)

  const serviceKey = await ask('service_role key (hidden): ', { secret: true })
  if (!/^(eyJ|sb_)/.test(serviceKey)) {
    die('That does not look like a service_role key. Copy it from\n'
      + 'Supabase → Settings → API → service_role.')
  }

  const password = await ask('Password for the archive (hidden): ', { secret: true })
  if (password.length < 12) die('Use at least 12 characters: this archive is the whole clinic.')
  const again = await ask('Password again (hidden): ', { secret: true })
  if (password !== again) die('The two passwords are not the same.')

  const when = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const outDir = resolve(process.cwd(), `wivo-export-${ref}-${when}`)
  if (existsSync(outDir)) die(`${outDir} already exists.`)
  mkdirSync(outDir, { recursive: true })

  let ok = false
  try {
    const tables = await listTables(psql, env)
    if (tables.length === 0) die('No tables found — is this the right project?')
    await dumpDatabase(pgDump, env, outDir)
    const counts = await dumpCsv(psql, env, outDir, tables)
    const storage = await dumpStorage(ref, serviceKey, outDir)
    const fileCount = writeReadme(outDir, { ref, counts, storage, when: new Date().toISOString() })
    const archivePath = await packFolder(sevenZip, outDir, password)
    ok = true

    console.log(`\nDone.\n\n  ${archivePath}\n\n`
      + `${fileCount} files inside, AES-256 with the file names encrypted too.\n\n`
      + 'OPENING IT NEEDS 7-ZIP (https://www.7-zip.org/). Windows Explorer cannot\n'
      + 'open a .7z, and without the password 7-Zip will not even list what is\n'
      + 'inside — that is the point.\n\n'
      + 'Send the archive and the password separately — not in the same message.\n')
  } finally {
    // The unencrypted copy goes whether or not the run finished. A half-made
    // export of a clinic's patients is exactly as sensitive as a whole one,
    // and leaving it behind on a failure is how it gets forgotten.
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
    if (!ok) console.error('\nThe unencrypted folder was removed. Nothing was changed in the project.\n')
  }
}

main().catch(err => die(err?.message ?? String(err)))
