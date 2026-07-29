import { useRef, useState } from 'react'
import { Upload, X, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

// ─── Status mapping — covers Estonian sheet values ────────────────────────────
const STATUS_MAP: Record<string, string> = {
  // Your actual sheet values
  'tehtud':       'valmis',    // done
  'uus tehtud':   'valmis',
  'tellimata':    'disain',    // not yet ordered → design queue
  'tellitud':     'disain',    // ordered
  'uus tellitud': 'disain',
  'printimata':   'print',     // waiting to print
  'prinditud':    'poleeri',   // printed → polish
  'valmis':       'valmis',
  // Generic fallbacks
  'default':      'disain',
  'disain':       'disain',
  'print':        'print',     'printimine':   'print',
  'poleeri':      'poleeri',   'poleerimine':  'poleeri',
  'puhasta':      'puhasta',   'puhastamine':  'puhasta',
  'varvi':        'varvi',     'värvimine':    'varvi',
  'done':         'valmis',
}

function mapStatus(raw: string): string {
  return STATUS_MAP[raw.trim().toLowerCase()] ?? 'disain'
}

// ─── Date helpers — handles DD.MM.YY, DD.MM (no year), "kell HH:MM" ─────────
function parseDateTime(raw: string): string | null {
  if (!raw?.trim()) return null
  const s = raw.trim()
  const year = new Date().getFullYear()

  // "DD.MM.YY kell HH:MM" or "DD.MM.YYYY kell HH:MM"
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
    return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:00+00:00`
  }

  // "DD.MM.YY" or "DD.MM.YYYY" date only
  const dateOnly = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (dateOnly) {
    let [, d, m, y] = dateOnly
    if (y.length === 2) y = '20' + y
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00+00:00`
  }

  return null
}

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null
  const dt = parseDateTime(raw)
  return dt ? dt.slice(0, 10) : null
}

function parseNumber(raw: string): number | null {
  if (!raw?.trim()) return null
  const n = parseFloat(raw.replace(',', '.').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? null : n
}

function parseBool(raw: string): boolean {
  return ['1','true','yes','jah','x','✓','✔'].includes(raw.trim().toLowerCase())
}

// ─── Header aliases — includes both clean UTF-8 and Latin-1-mangled versions ──
// (When Google Sheets exports Windows-1252, ä/ö may appear as Ã¤/Ã¶ if read wrong)
const HEADER_ALIASES: Record<string, string[]> = {
  status:        ['status','staatus'],
  kuupaev:       ['kuupäev','kuupaev','kuupã¤ev','date','received'],
  patsient:      ['patsient','patient','nimi','name'],
  too:           ['töö','too','tã¶ã¶','work','type'],
  materjal:      ['materjal','material'],
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

// Score a row for how likely it is to be the header row
function headerScore(row: string[]): number {
  let score = 0
  const flat = row.map(c => c.trim().toLowerCase()).join(' ')
  const keywords = ['patsient','patient','kuup','tÃ¶','töö','too','materjal','värv','vã','ham','valmis']
  keywords.forEach(k => { if (flat.includes(k)) score++ })
  return score
}

function normaliseHeaders(headers: string[]): string[] {
  return headers.map(h => {
    const lower = h.trim().toLowerCase()
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some(a => lower.includes(a))) return field
    }
    return lower.replace(/\s+/g, '_')
  })
}

// ─── Delimiter detection ──────────────────────────────────────────────────────
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, 2000).split('\n')[0] ?? ''
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis  = (firstLine.match(/;/g) ?? []).length
  const tabs   = (firstLine.match(/\t/g) ?? []).length
  if (tabs > commas && tabs > semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '') // strip BOM
  const delim = detectDelimiter(cleaned)
  const lines = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return lines.filter(l => l.trim()).map(line => {
    const row: string[] = []
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
    return row
  })
}

// Find the actual header row — scan first 5 rows and pick the best match
function findHeaderRowIndex(rows: string[][]): number {
  let best = 0, bestScore = -1
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const score = headerScore(rows[i])
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}

// ─── Component ────────────────────────────────────────────────────────────────
interface ImportCSVButtonProps {
  onSuccess: () => void
}

type ImportState = 'idle' | 'preview' | 'inserting' | 'done' | 'error'

export function ImportCSVButton({ onSuccess }: ImportCSVButtonProps) {
  const [state, setState] = useState<ImportState>('idle')
  const [preview, setPreview] = useState<{ count: number; sample: { patsient: string; too: string | null; status: string; kuupaev: string }[] }>({
    count: 0, sample: []
  })
  const [parsedJobs, setParsedJobs] = useState<object[]>([])
  const [progress, setProgress] = useState(0)
  const [errMsg, setErrMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function processText(text: string) {
    const rows = parseCSV(text)
    if (rows.length < 2) { setErrMsg('CSV tühi'); setState('error'); return }

    const headerIdx = findHeaderRowIndex(rows)
    const rawHeaders = rows[headerIdx]
    const headers = normaliseHeaders(rawHeaders)

    function cell(row: string[], field: string): string {
      const idx = headers.indexOf(field)
      return idx >= 0 ? (row[idx] ?? '').trim() : ''
    }

    const dataRows = rows.slice(headerIdx + 1)
    // Only rows with a non-empty Patsient field
    const jobs = dataRows
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
      setErrMsg('Ühtegi tööd ei leitud. Veendu, et "Patsient" veerg on olemas.')
      setState('error')
      return
    }

    setParsedJobs(jobs)
    setPreview({
      count: jobs.length,
      sample: jobs.slice(0, 4).map(j => ({
        patsient: (j as any).patsient,
        too: (j as any).too,
        status: (j as any).status,
        kuupaev: (j as any).kuupaev,
      }))
    })
    setState('preview')
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Try UTF-8 first; if headers don't match we can retry with latin1
    const reader = new FileReader()
    reader.onload = (ev) => processText(ev.target?.result as string)
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  async function doInsert() {
    setState('inserting')
    setProgress(0)
    const BATCH = 50
    let inserted = 0
    for (let i = 0; i < parsedJobs.length; i += BATCH) {
      const batch = parsedJobs.slice(i, i + BATCH)
      const { error } = await supabase.from('jobs').insert(batch)
      if (error) { setErrMsg(error.message); setState('error'); return }
      inserted += batch.length
      setProgress(Math.round((inserted / parsedJobs.length) * 100))
    }
    setState('done')
    setTimeout(() => { setState('idle'); onSuccess() }, 1500)
  }

  const STAGE_LABELS: Record<string, string> = {
    disain: 'Disain', print: 'Printimine', poleeri: 'Poleerimine',
    puhasta: 'Puhastamine', varvi: 'Värvimine', valmis: 'Valmis'
  }

  return (
    <>
      <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} className="hidden" />

      <button onClick={() => fileRef.current?.click()} className="btn-ghost" title="Impordi CSV">
        <Upload size={14} />
        Import CSV
      </button>

      {state !== 'idle' && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-bg-card rounded-panel shadow-panel w-[500px] p-6 space-y-4">

            {state === 'preview' && (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-ink">Impordi {preview.count} tööd</h3>
                    <p className="text-xs text-ink-muted mt-0.5">Eelvaade (esimesed {preview.sample.length}):</p>
                  </div>
                  <button onClick={() => setState('idle')} className="text-ink-faint hover:text-ink">
                    <X size={16} />
                  </button>
                </div>
                <div className="space-y-1">
                  {preview.sample.map((row, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 bg-bg-sidebar rounded-lg text-sm">
                      <span className="font-medium text-ink w-36 truncate">{row.patsient}</span>
                      <span className="text-ink-muted flex-1 truncate">{row.too ?? '—'}</span>
                      <span className="text-xs text-ink-faint">{row.kuupaev}</span>
                      <span className="text-xs font-medium text-accent">{STAGE_LABELS[row.status]}</span>
                    </div>
                  ))}
                  {preview.count > preview.sample.length && (
                    <p className="text-xs text-ink-faint text-center pt-1">… ja veel {preview.count - preview.sample.length} tööd</p>
                  )}
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={() => setState('idle')} className="btn-ghost">Tühista</button>
                  <button onClick={doInsert} className="btn-primary">
                    <Upload size={13} /> Lisa Supabase'i
                  </button>
                </div>
              </>
            )}

            {state === 'inserting' && (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 size={28} className="animate-spin text-accent" />
                <p className="text-sm text-ink-muted">Importimine… {progress}%</p>
                <div className="w-full bg-bg-sidebar rounded-full h-2 overflow-hidden">
                  <div className="bg-accent h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {state === 'done' && (
              <div className="flex flex-col items-center gap-2 py-6">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <Check size={20} className="text-green-600" />
                </div>
                <p className="text-sm font-medium text-ink">Imporditud!</p>
              </div>
            )}

            {state === 'error' && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle size={20} className="text-red-500" />
                </div>
                <p className="text-sm text-ink text-center">{errMsg}</p>
                <button onClick={() => setState('idle')} className="btn-ghost">Sulge</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
