/**
 * No NEW Estonian written into a string literal in the renderer.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * `noHardcodedText` reads JSX text and a list of readable attributes. It does
 * not — and cannot cheaply — follow a value through an expression, so this got
 * past it for as long as it existed:
 *
 *     const STAGE_LABELS = { disain: 'Disain', print: 'Printimine', … }
 *     <span>{STAGE_LABELS[row.status]}</span>
 *
 * The CSV import preview named every stage in Estonian whatever language the
 * interface was in, and nothing in the suite had an opinion about it.
 *
 * ── Why letters and not words ───────────────────────────────────────────────
 * õ, ä, ö, ü, š and ž are not in English. A rule about them needs no dictionary
 * and no guessing, and it is exactly the shape of mistake worth catching:
 * someone typing a sentence in Estonian, rather than someone naming a variable.
 *
 * It is a net with holes — "Tere" has no such letter — and that is fine. This
 * is the second net, not the first.
 *
 * ── Why there is a baseline and not a clean sheet ───────────────────────────
 * Turning this on found 37 strings already in the tree, and most of them are
 * one real job: `lib/exports.ts` writes every CSV column heading in Estonian,
 * so an English interface still exports "Kuupäev" and "Köndivärv".
 *
 * Fixing those is worth doing and is not worth blocking this guard on, because
 * the guard is what stops the list from growing while they are fixed. So the
 * 37 are written down. Nothing may be added; an entry that is cleaned up must
 * be deleted from the list, and the last test here fails if a stale one is
 * left behind.
 *
 * KNOWN_GAPS is a to-do list, in other words, and it is ordered by how much it
 * matters: the export headings first.
 *
 * ── The allowlist is by file, and each one says why ─────────────────────────
 * Some Estonian in this app is DATA, not language: the words a CSV header may
 * use, the terms a free-text work type is matched against. Those are compared
 * with what a person typed in Estonian, so they must stay Estonian in every
 * interface language — translating them would break the matching.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim()

/**
 * Files whose Estonian is data rather than interface language.
 *
 * A whole file rather than a line number, because these are lists that grow:
 * pinning line numbers would fail on the next entry and teach everyone to edit
 * the test instead of thinking about it.
 */
const DATA_NOT_LANGUAGE: Record<string, string> = {
  'src/renderer/src/components/ImportCSVButton.tsx':
    'Matches Estonian CSV headers and stage words as they were typed by a person.',
  'src/renderer/src/components/NewJobWizard/jobtype/ToothGlyph.tsx':
    'Matches free-text work type names against Estonian terms.',
  'src/renderer/src/components/Invoices/InvoiceForm.tsx':
    'Writes invoice line text, and an invoice is Estonian by spec — see InvoicePrintView DOC_LANG.',
}

/**
 * Estonian that is already here. Delete a line when it is fixed; never add one.
 *
 * Keyed without a line number on purpose — a baseline pinned to line numbers
 * breaks on the next edit above it, and then it gets re-recorded rather than
 * read.
 */
const KNOWN_GAPS: string[] = [
  // ── CSV column headings. An English interface exports Estonian columns.
  'src/renderer/src/lib/exports.ts: KM määr %',
  'src/renderer/src/lib/exports.ts: Kiirtöö',
  'src/renderer/src/lib/exports.ts: Kuupäev',
  'src/renderer/src/lib/exports.ts: Köndivärv',
  'src/renderer/src/lib/exports.ts: Maksetähtaeg',
  'src/renderer/src/lib/exports.ts: Märkus',
  'src/renderer/src/lib/exports.ts: Määr',
  'src/renderer/src/lib/exports.ts: Nõusolek',
  'src/renderer/src/lib/exports.ts: Nõusoleku aeg',
  'src/renderer/src/lib/exports.ts: Periood lõpp',
  'src/renderer/src/lib/exports.ts: Tähtaeg',
  'src/renderer/src/lib/exports.ts: Töö',
  'src/renderer/src/lib/exports.ts: Töö kaupa',
  'src/renderer/src/lib/exports.ts: Töötaja',
  'src/renderer/src/lib/exports.ts: Väljastus',
  'src/renderer/src/lib/exports.ts: Värv',
  'src/renderer/src/lib/exports.ts: Üle antud',
  // Same thing, in the payroll revaluation export.
  'src/renderer/src/components/Workers/PayrollView.tsx: Makstud määr',
  'src/renderer/src/components/Workers/PayrollView.tsx: Õige määr',

  // ── Defaults a NEW clinic is created with. Data, but ours, and an English
  //    clinic should not start with Estonian stages and visit types.
  'src/renderer/src/config/pipeline.ts: Värvimine',
  'src/renderer/src/config/visitTypes.ts: Hügieen',
  'src/renderer/src/config/visitTypes.ts: Jäljendi tegemine',
  'src/renderer/src/config/visitTypes.ts: Täidis',

  // ── Labels for stored values. Shown, so they want translating; the stored
  //    value itself must not change.
  'src/renderer/src/types/customer.ts: Üle antud',
  'src/renderer/src/types/invoice.ts: Tühistatud',
  'src/renderer/src/types/job.ts: Vale värv',
  'src/renderer/src/types/patient.ts: Küsimata',
  'src/renderer/src/components/NewJobWizard/steps/StepMaterial.tsx: Läikiv',

  // ── Sample values in placeholders. Harmless, and listed so the count is
  //    honest rather than quietly filtered.
  'src/renderer/src/components/Customers/CustomersView.tsx: Hambaravi OÜ',
  'src/renderer/src/components/Settings/EmailSection.tsx: Sinu Kliinik OÜ',

  // ── Developer console only. Never on screen.
  'src/renderer/src/components/teeth/ToothPicker.tsx: [wivo] 3D hambakaart ei laadinud, näitan 2D:',
  'src/renderer/src/context/AuthContext.tsx: [Wivo] kliiniku andmete laadimine ebaõnnestus:',

  // ── Stored discriminators, compared against data. Not language at all; here
  //    rather than in DATA_NOT_LANGUAGE because the rest of these files is.
  'src/renderer/src/components/NewJobWizard/review/PriceSummary.tsx: kiirtöö',
  'src/renderer/src/components/Patients/derive.ts: märkus',
  'src/renderer/src/components/Patients/derive.ts: töö',
  'src/renderer/src/lib/repriceJobs.ts: kiirtöö',
  'src/renderer/src/lib/repriceJobs.ts: tüüp',
]

/** Letters that exist in Estonian and not in English. */
const ESTONIAN = /[õäöüšžÕÄÖÜŠŽ]/

const files = execFileSync(
  'git',
  ['ls-files', 'src/renderer/src/**/*.tsx', 'src/renderer/src/**/*.ts'],
  { cwd: ROOT },
)
  .toString().split('\n').map(f => f.trim()).filter(Boolean)
  .filter(f => !/\.test\./.test(f))

if (files.length === 0) throw new Error('noEstonianStrings: git ls-files matched no files')

interface Hit { key: string; where: string }

/** Every Estonian string literal in the file. Comments are not visited. */
function estonianLiterals(f: string): Hit[] {
  const text = readFileSync(`${ROOT}/${f}`, 'utf8')
  const sf = ts.createSourceFile(
    f, text, ts.ScriptTarget.Latest, true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: Hit[] = []
  const visit = (n: ts.Node): void => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && ESTONIAN.test(n.text)) {
      found.push({
        key: `${f}: ${n.text}`,
        where: `${f}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`,
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

const scanned = files
  .filter(f => !(f in DATA_NOT_LANGUAGE))
  .flatMap(estonianLiterals)

describe('no new Estonian in renderer string literals', () => {
  it('finds files to read', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('adds nothing that is not already written down', () => {
    const known = new Set(KNOWN_GAPS)
    const added = scanned.filter(h => !known.has(h.key)).map(h => `${h.where}: ${h.key.split(': ').slice(1).join(': ')}`)
    expect(added, 'new Estonian string literals — put the text through t()').toEqual([])
  })

  it('has no stale entry in the backlog', () => {
    // A line that has been fixed must leave, or the list stops describing
    // anything and the next reader cannot tell what is still owed.
    const live = new Set(scanned.map(h => h.key))
    expect(KNOWN_GAPS.filter(k => !live.has(k)), 'fixed — delete these lines').toEqual([])
  })

  it('the file allowlist names only files that still need it', () => {
    for (const f of Object.keys(DATA_NOT_LANGUAGE)) {
      expect(files, `${f} is allowlisted but not in the repo`).toContain(f)
      expect(estonianLiterals(f).length, `${f} no longer needs an allowlist entry`)
        .toBeGreaterThan(0)
    }
  })
})
