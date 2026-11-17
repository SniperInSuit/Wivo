#!/usr/bin/env node
/**
 * sql/demo/seed.sql with the demo password filled in, for piping into psql.
 *
 *   node scripts/demo-seed.mjs > demo-seed.sql
 *
 * It asks for the password and reads it with the echo off. NOT from an
 * environment variable and never as an argument: typed on a command line it
 * stays in the shell's history afterwards, and PowerShell's history is a file
 * on disk (ConsoleHost_history.txt) that nothing ever clears.
 *
 * The question goes to STDERR, because stdout is the SQL — a prompt written
 * there would end up inside the file this produces.
 *
 * DELETE the file it makes once psql has run it. It holds the password in
 * clear text, exactly as `fresh.sql` holds a service-role key; see
 * docs/DEMO-SETUP.md, which says so at the step where it matters.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const PLACEHOLDER = '<DEMO_' + 'PASSWORD>'

const askHidden = (question) => new Promise(resolve => {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  process.stderr.write(question)
  rl._writeToOutput = () => {}
  rl.question('', answer => {
    rl.close()
    process.stderr.write('\n')
    resolve(answer.trim())
  })
})

const pw = await askHidden('Demo accounts\' password (hidden, min 12 chars): ')
if (pw.length < 12) {
  console.error(`That is ${pw.length} characters. The seed file refuses anything under 12.`)
  process.exit(2)
}
if (pw === PLACEHOLDER) {
  console.error('That is the placeholder itself, not a password.')
  process.exit(2)
}
// A single quote would end the SQL string it is pasted into and the rest of
// the file would be read as code. Doubling it is the correct escape, but a
// password that needs escaping in a demo is a password worth changing.
if (pw.includes("'") || pw.includes('\\')) {
  console.error("Leave out ' and \\ — they have to be escaped inside SQL and this is a demo password, not a vault.")
  process.exit(2)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sql = readFileSync(join(root, 'sql', 'demo', 'seed.sql'), 'utf8')
if (!sql.includes(PLACEHOLDER)) {
  console.error('sql/demo/seed.sql has no password placeholder in it any more. Refusing to guess.')
  process.exit(2)
}

process.stdout.write(sql.replaceAll(PLACEHOLDER, pw))
