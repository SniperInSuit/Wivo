import { describe, it, expect } from 'vitest'
import {
  renderTemplate, templateVars, unknownTokens,
  DEFAULT_MAIL_TEMPLATE, TEMPLATE_TOKENS,
} from './mailTemplate'

const doc = {
  number: '2026-0007',
  issueDate: '01.09.2026',
  dueDate: '15.09.2026',
  buyer: { name: 'Mari Maasikas' },
  totals: { grossText: '1220.00 €', dueText: '820.00 €' },
  seller: { name: 'Fullgevity Dental OÜ' },
}

describe('renderTemplate', () => {
  const vars = templateVars(doc)

  it('substitutes every documented token', () => {
    // If this fails, the settings screen is offering a token that does nothing.
    for (const { token } of TEMPLATE_TOKENS) {
      const out = renderTemplate(token, vars)
      expect(out).not.toBe(token)
      expect(out.length).toBeGreaterThan(0)
    }
  })

  it('fills a whole sentence', () => {
    expect(renderTemplate('Arve {arve} summas {summa}, tähtaeg {tahtaeg}.', vars))
      .toBe('Arve 2026-0007 summas 1220.00 €, tähtaeg 15.09.2026.')
  })

  it('LEAVES an unknown token as typed rather than blanking it', () => {
    // A visible {tahtaef} gets reported and fixed. An empty string leaves a
    // sentence with a hole in it that nobody notices.
    expect(renderTemplate('Tähtaeg {tahtaef}.', vars)).toBe('Tähtaeg {tahtaef}.')
  })

  it('repeats a token as many times as it appears', () => {
    expect(renderTemplate('{arve} / {arve}', vars)).toBe('2026-0007 / 2026-0007')
  })

  it('keeps blank lines, because they are paragraphs', () => {
    expect(renderTemplate('Tere\n\nAitäh', vars)).toBe('Tere\n\nAitäh')
  })

  it('survives empty and missing text', () => {
    expect(renderTemplate('', vars)).toBe('')
    expect(renderTemplate(undefined as unknown as string, vars)).toBe('')
  })
})

describe('unknownTokens', () => {
  const vars = templateVars(doc)

  it('names what cannot be filled', () => {
    expect(unknownTokens('{arve} ja {midagi} ja {muud}', vars)).toEqual(['midagi', 'muud'])
  })

  it('says nothing when every token is known', () => {
    expect(unknownTokens('{arve} {saaja} {summa}', vars)).toEqual([])
  })

  it('reports a repeated unknown once', () => {
    expect(unknownTokens('{x} {x}', vars)).toEqual(['x'])
  })
})

describe('the shipped default', () => {
  const vars = templateVars(doc)

  it('uses only tokens that exist', () => {
    for (const text of Object.values(DEFAULT_MAIL_TEMPLATE)) {
      expect(unknownTokens(text, vars)).toEqual([])
    }
  })

  it('is a real letter, not an empty box', () => {
    // An empty default would ship the blank-looking mail this exists to fix.
    const intro = renderTemplate(DEFAULT_MAIL_TEMPLATE.sissejuhatus, vars)
    expect(intro).toContain('Mari Maasikas')
    expect(intro).toContain('2026-0007')
    expect(renderTemplate(DEFAULT_MAIL_TEMPLATE.lopp, vars))
      .toContain('Fullgevity Dental OÜ')
  })

  it('puts the invoice number in the subject', () => {
    expect(renderTemplate(DEFAULT_MAIL_TEMPLATE.pealkiri, vars)).toContain('2026-0007')
  })
})
