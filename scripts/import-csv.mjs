/**
 * import-csv.mjs — One-time migration from Google Sheets CSV export → Supabase
 *
 * Usage:
 *   1. In Google Sheets: File → Download → Comma-separated values (.csv)
 *   2. Save the file as  scripts/jobs.csv  (next to this script)
 *   3. Make sure your .env exists with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *   4. node scripts/import-csv.mjs
 *      (or:  node scripts/import-csv.mjs path/to/my-export.csv)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'

// ─── Load .env manually ───────────────────────────────────────────────────────
function loadEnv() {
  const env = {}
  const envFile = new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
  if (!existsSync(envFile)) throw new Error('.env not found — copy .env.example and fill in your keys')
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...rest] = line.split('=')
    if (k && rest.length) env[k.trim()] = rest.join('=').trim()
  })
  return env
}

// ─── Status mapping — covers actual sheet values ──────────────────────────────
const STATUS_MAP = {
  'tehtud':       'valmis',
  'uus tehtud':   'valmis',
  'tellimata':    'disain',
  'tellitud':     'disain',
  'uus tellitud': 'disain',
  'printimata':   'print',
  'prinditud':    'poleeri',
  'valmis':       'valmis',
  'default':      'disain',
  'disain':       'disain',
  'print':        'print',  'printimine':  'print',
  'poleeri':      'poleeri','poleerimine': 'poleeri',
  'puhasta':      'puhasta','puhastamine': 'puhasta',
  'varvi':        'varvi',  'värvimine':   'varvi',
  'done':         'valmis',
}

function mapStatus(raw) {
  if (!raw) return 'disain'
  return STATUS_MAP[raw.trim().toLowerCase()] ?? 'disain'
}

// ─── Date helpers — handles "DD.MM kell HH:MM" (no year) too ─────────────────
const THIS_YEAR = new Date().getFullYear()

function parseDateTime(raw) {
  if (!raw?.trim()) return null
  const s = raw.trim()

  // "DD.MM.YY kell HH:MM" or "DD.MM.YYYY kell HH:MM" or without "kell"
  const fullDT = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(?:kell\s+)?(\d{1,2})[:.h](\d{2})/)
  if (fullDT) {
    let [, d, m, y, h, min] = fullDT
    if (y.length === 2) y = '20' + y
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:00+00:00`
  }

  // "DD.MM kell HH:MM" — no year, assume current year
  const shortDT = s.match(/^(\d{1,2})\.(\d{1,2})\s+(?:kell\s+)?(\d{1,2})[:.h](\d{2})/)
  if (shortDT) {
    const [, d, m, h, min] = shortDT
    return `${THIS_YEAR}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:00+00:00`
  }

  // Date only DD.MM.YY or DD.MM.YYYY
  const dateOnly = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (dateOnly) {
    let [, d, m, y] = dateOnly
    if (y.length === 2) y = '20' + y
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00+00:00`
  }

  return null
}

function parseDate(raw) {
  const dt = parseDateTime(raw)
  return dt ? dt.slice(0, 10) : null
}

function parseBool(raw) {
  if (!raw?.trim()) return false
  return ['1','true','yes','jah','x','✓','✔'].includes(raw.trim().toLowerCase())
}

function parseNumber(raw) {
  if (!raw?.trim()) return null
  const n = parseFloat(raw.replace(',', '.').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? null : n
}

// ─── Header aliases — includes Latin-1-mangled Estonian chars ────────────────
const HEADER_ALIASES = {
  status:        ['status','staatus'],
  kuupaev:       ['kuupäev','kuupaev','kuupã¤ev','date','received'],
  patsient:      ['patsient','patient','nimi','name'],
  too:           ['töö','too','tã¶ã¶','work','type'],
  materjal:      ['materjal','material','resin'],
  varv:          ['värv','varv','vã¤rv','shade'],
  hambad:        ['x ham','hambad','teeth','ham'],
  valmis_aeg:    ['valmis aeg','valmis_aeg','deadline','tähtaeg'],
  muudatused:    ['muudatused','changes','notes'],
  rev_hambad:    ['rev ham','rev. ham','rev_hambad'],
  rev_varv:      ['rev värv','rev. värv','rev_varv','rev. vã¤rv'],
  uus_valmis:    ['uus valmis','uus_valmis'],
  hind:          ['hind','price'],
  makstud:       ['makstud','paid'],
  makse_kuupaev: ['makse kuupäev','makse_kuupaev','payment date'],
}

function normaliseHeaders(headers) {
  return headers.map(h => {
    const lower = h.trim().toLowerCase()
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some(a => lower.includes(a))) return field
    }
    return lower.replace(/\s+/g, '_')
  })
}

// Score a row for likelihood of being the header row
function headerScore(row) {
  const flat = row.map(c => (c ?? '').trim().toLowerCase()).join(' ')
  const keywords = ['patsient','patient','kuup','tö','too','tã¶','materjal','värv','varv','vã','ham','valmis']
  return keywords.reduce((s, k) => s + (flat.includes(k) ? 1 : 0), 0)
}

function findHeaderRowIndex(rows) {
  let best = 0, bestScore = -1
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const score = headerScore(rows[i])
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const firstLine = text.slice(0, 2000).split('\n')[0] ?? ''
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis  = (firstLine.match(/;/g) ?? []).length
  const tabs   = (firstLine.match(/\t/g) ?? []).length
  if (tabs > commas && tabs > semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

function parseCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, '')
  const delim = detectDelimiter(cleaned)
  console.log(`  Delimiter: ${delim === '\t' ? 'TAB' : `"${delim}"`}`)
  const lines = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result = []
  for (const line of lines) {
    if (!line.trim()) continue
    const row = []
    let inQuote = false, cell = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') { cell += '"'; i++ }
        else inQuote = !inQuote
      } else if (c === delim && !inQuote) { row.push(cell); cell = '' }
      else cell += c
    }
    row.push(cell)
    result.push(row)
  }
  return result
}

// ─── Prompt helper ────────────────────────────────────────────────────────────
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim().toLowerCase()) }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2]
    ?? new URL('jobs.csv', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

  if (!existsSync(csvPath)) {
    console.error(`\n  CSV not found: ${csvPath}`)
    console.error('  Save your export as scripts/jobs.csv\n')
    process.exit(1)
  }

  const env = loadEnv()
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

  const raw = readFileSync(csvPath, 'utf8')
  const rows = parseCSV(raw)
  if (rows.length < 2) { console.error('CSV has no data rows'); process.exit(1) }

  const headerIdx = findHeaderRowIndex(rows)
  const rawHeaders = rows[headerIdx]
  const headers = normaliseHeaders(rawHeaders)

  console.log(`\n  Header row detected at row ${headerIdx + 1}`)
  console.log('─── Column mapping ─────────────────────────────────')
  rawHeaders.forEach((h, i) => { if (h.trim()) console.log(`  "${h}"  →  ${headers[i]}`) })
  console.log('────────────────────────────────────────────────────\n')

  function cell(row, field) {
    const idx = headers.indexOf(field)
    return idx >= 0 ? (row[idx] ?? '').trim() : ''
  }

  const jobs = rows.slice(headerIdx + 1)
    .filter(r => cell(r, 'patsient').trim())
    .map(row => ({
      status:        mapStatus(cell(row, 'status')),
      kuupaev:       parseDate(cell(row, 'kuupaev')) ?? new Date().toISOString().slice(0, 10),
      patsient:      cell(row, 'patsient'),
      too:           cell(row, 'too') || null,
      materjal:      cell(row, 'materjal') || null,
      varv:          cell(row, 'varv') || null,
      hambad:        cell(row, 'hambad') || null,
      valmis_aeg:    parseDateTime(cell(row, 'valmis_aeg')),
      muudatused:    cell(row, 'muudatused') || null,
      rev_hambad:    cell(row, 'rev_hambad') || null,
      rev_varv:      cell(row, 'rev_varv') || null,
      uus_valmis:    parseDateTime(cell(row, 'uus_valmis')),
      hind:          parseNumber(cell(row, 'hind')),
      makstud:       parseBool(cell(row, 'makstud')),
      makse_kuupaev: parseDate(cell(row, 'makse_kuupaev')),
    }))

  if (jobs.length === 0) {
    console.error('No rows found with a Patsient value. Check that the Patsient column exists.')
    process.exit(1)
  }

  console.log(`Found ${jobs.length} jobs. First 3:\n`)
  jobs.slice(0, 3).forEach((j, i) =>
    console.log(`  [${i+1}] ${j.kuupaev}  ${j.patsient.padEnd(22)}  ${j.status.padEnd(10)}  ${j.too ?? ''}`)
  )

  const ans = await confirm(`\nInsert all ${jobs.length} jobs into Supabase? (y/N) `)
  if (ans !== 'y') { console.log('Aborted.'); process.exit(0) }

  const BATCH = 50
  let inserted = 0
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH)
    const { error } = await supabase.from('jobs').insert(batch)
    if (error) { console.error(`\nError on batch ${i+1}:`, error.message); process.exit(1) }
    inserted += batch.length
    process.stdout.write(`\r  Inserted ${inserted}/${jobs.length}…`)
  }

  console.log(`\n\nDone! ${inserted} jobs imported.\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
