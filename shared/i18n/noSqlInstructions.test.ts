/**
 * Never tell people using Wivo to run SQL (Kevin, after a test-copy bug whose
 * message said "Run sql/020_invoices.sql"): no text anyone reads names a
 * migration file, the SQL editor or a database command. A database that lacks
 * something shows a neutral message (app.notAvailableYet, app.contactSupport).
 *
 * Checked in the text catalogs and in every string and piece of JSX text in
 * the app (comments do not count: they are for developers).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import ts from 'typescript'
import { en } from './en'
import { et } from './et'
import { ru } from './ru'

const SQL_ADVICE = /sql\/\d|\.sql\b|sql[ -]?(editor|redaktor)|supabase sql|notify pgrst|reload schema|net\._http_response|cron\.job_run_details/i
const ROOT = execSync('git rev-parse --show-toplevel').toString().trim()

/** A message as text: a function message is called with a sample number; one that needs more is read from source below. */
function text(m: unknown): string {
  if (typeof m !== 'function') return String(m)
  try { return String((m as (p: Record<string, unknown>) => string)(new Proxy({}, { get: () => 2 }))) } catch { return '' }
}

describe('no SQL advice anywhere a person reads', () => {
  it.each([['en', en], ['et', et], ['ru', ru]] as const)('the %s catalog', (_lang, catalog) => {
    const bad = Object.entries(catalog as Record<string, unknown>).filter(([, m]) => SQL_ADVICE.test(text(m))).map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('nor in the catalogs\' source (function messages included)', () => {
    for (const f of ['en', 'et', 'ru']) {
      const lines = readFileSync(`${ROOT}/shared/i18n/${f}.ts`, 'utf8').split('\n')
      const bad = lines.filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l) && SQL_ADVICE.test(l))
      expect(bad, f).toEqual([])
    }
  })

  it('no string or JSX text in the app names a migration, the SQL editor or a database command', () => {
    const files = execSync(`git ls-files 'src/renderer/src/**/*.tsx' 'src/renderer/src/**/*.ts'`, { cwd: ROOT })
      .toString().trim().split('\n').filter(f => f && !/\.test\./.test(f))
    const bad: string[] = []
    for (const file of files) {
      const src = ts.createSourceFile(file, readFileSync(`${ROOT}/${file}`, 'utf8'), ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node): void => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node)
             || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && SQL_ADVICE.test(node.text)) {
          bad.push(`${file}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(src)
    }
    expect(bad).toEqual([])
  })
})
