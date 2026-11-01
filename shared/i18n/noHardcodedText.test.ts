/**
 * Spec, Phase 0 acceptance: "there is not a single interface text written
 * directly in code". This keeps it true.
 *
 * 1. JSX text and the attributes people read (title, placeholder, aria-label,
 *    alt, label) must come from `t()`. What is allowed raw is listed below and
 *    is not language: brand names, codes, sample values, file names.
 * 2. No call is left in the old inline form `t('Estonian', 'English')`.
 * 3. The catalogs agree: every translated key exists in English, and a string
 *    message uses no placeholder the English one does not have.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import ts from 'typescript'
import { en } from './en'
import { et } from './et'
import { ru } from './ru'

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim()
const files = execSync(`git ls-files 'src/renderer/src/**/*.tsx' 'src/renderer/src/**/*.ts' 'shared/**/*.ts'`, { cwd: ROOT })
  .toString().trim().split('\n').filter(f => !/\.test\./.test(f) && !f.startsWith('shared/i18n/'))

/**
 * Raw text that is not language. Each entry is a brand, a code, a unit symbol
 * or an example value shown as a placeholder — the same in every language.
 */
const NOT_LANGUAGE = new Set([
  'Wivo', 'WivoLab', 'WivoDental', 'WivoX', 'IBAN', 'CSV', 'HH:MM', '.png', 'kroon.png',
  'Tallinn', 'EE123456789', 'LHV, SEB, Swedbank…', 'LHV, SEB…', 'EE00 1234 5678 9012 3456',
  'Dr. …', 'WIVO1.…', 'mail.elkdata.ee', 'fullgevity', 'Hambaravi OÜ', 'LICENCE_PUBLIC_KEY',
  'auto',
  // The language switch's heading names itself in both languages on purpose:
  // it is the one label someone who cannot read the current language must find.
  'Keel · Language',
])
/** File names, SQL and paths shown so someone can run or find them. */
const looksLikeCode = (s: string): boolean =>
  /^(sql\/|src\/|select |notify |cron\.|[\w.-]+\.(sql|png|ts|tsx)$)/.test(s)

const ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label'])

function scan(f: string): { raw: string[]; inline: string[] } {
  const text = readFileSync(`${ROOT}/${f}`, 'utf8')
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const raw: string[] = []
  const inline: string[] = []
  const where = (n: ts.Node): string => `${f}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const visit = (n: ts.Node): void => {
    let s: string | null = null
    if (ts.isJsxText(n)) s = n.text.replace(/\s+/g, ' ').trim()
    else if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText(sf)) && n.initializer && ts.isStringLiteral(n.initializer)) s = n.initializer.text
    if (s && /[A-Za-zÕÄÖÜõäöü]{2,}/.test(s) && !NOT_LANGUAGE.has(s) && !looksLikeCode(s)) raw.push(`${where(n)}: ${s}`)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 't'
        && n.arguments.length === 2 && !ts.isObjectLiteralExpression(n.arguments[1])) inline.push(where(n))
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { raw, inline }
}

describe('no interface text in code', () => {
  const results = files.map(scan)

  it('JSX text and readable attributes come from t()', () => {
    expect(results.flatMap(r => r.raw)).toEqual([])
  })

  it('no inline t(estonian, english) calls are left', () => {
    expect(results.flatMap(r => r.inline)).toEqual([])
  })
})

describe('catalogs', () => {
  const holders = (m: unknown): string[] =>
    typeof m === 'string' ? [...m.matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort() : []

  for (const [name, catalog] of [['et', et], ['ru', ru]] as const) {
    it(`${name}: every key exists in English, with the same placeholders`, () => {
      const problems: string[] = []
      for (const [key, msg] of Object.entries(catalog)) {
        if (!(key in en)) { problems.push(`${key}: not in en`); continue }
        const source = en[key as keyof typeof en]
        if (typeof msg === 'string' && typeof source === 'string') {
          const missing = holders(msg).filter(h => !holders(source).includes(h))
          if (missing.length) problems.push(`${key}: {${missing.join('}, {')}} not in English`)
        }
      }
      expect(problems).toEqual([])
    })
  }

  it('Estonian covers every key — it is the language the app was written in', () => {
    expect(Object.keys(en).filter(k => !(k in et))).toEqual([])
  })
})
