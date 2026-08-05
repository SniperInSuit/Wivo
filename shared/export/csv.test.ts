import { describe, expect, it } from 'vitest'
import { csvFileName, toCsv, type CsvColumn } from './csv'

interface Row { nimi: string; hind: number; tk: number; makstud: boolean; note: string | null }

const cols: CsvColumn<Row>[] = [
  { header: 'Nimi',    value: r => r.nimi },
  { header: 'Hind',    value: r => r.hind },
  { header: 'Tükki',   value: r => r.tk },
  { header: 'Makstud', value: r => r.makstud },
  { header: 'Märkus',  value: r => r.note },
]

const row = (over: Partial<Row> = {}): Row =>
  ({ nimi: 'Kroon', hind: 400.5, tk: 2, makstud: true, note: null, ...over })

const lines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n')

describe('Excel compatibility — the whole reason this file exists', () => {
  it('starts with a UTF-8 BOM so Excel does not mangle õäöü', () => {
    expect(toCsv([row()], cols).startsWith('﻿')).toBe(true)
  })

  it('emits a sep= hint and uses semicolons', () => {
    const out = lines(toCsv([row()], cols))
    expect(out[0]).toBe('sep=;')
    expect(out[1]).toBe('Nimi;Hind;Tükki;Makstud;Märkus')
  })

  it('writes decimals with a comma — Estonian Excel reads a dot as text', () => {
    expect(lines(toCsv([row({ hind: 400.5 })], cols))[2]).toContain('400,50')
  })

  it('leaves whole numbers whole — a count of 2 is not "2,00"', () => {
    const cells = lines(toCsv([row({ tk: 2 })], cols))[2].split(';')
    expect(cells[2]).toBe('2')
  })

  it('uses CRLF', () => {
    expect(toCsv([row()], cols)).toContain('\r\n')
  })
})

describe('escaping', () => {
  it('quotes a value containing the separator', () => {
    expect(lines(toCsv([row({ nimi: 'Kroon; Sild' })], cols))[2]).toContain('"Kroon; Sild"')
  })

  it('doubles embedded quotes rather than dropping them', () => {
    expect(lines(toCsv([row({ nimi: 'ta ütles "ei"' })], cols))[2])
      .toContain('"ta ütles ""ei"""')
  })

  it('quotes a value containing a newline, keeping the row intact', () => {
    const out = lines(toCsv([row({ note: 'rida1\nrida2' })], cols))
    // 3 logical lines (hint, header, row) but the row itself carries a newline
    expect(out.length).toBe(3)
    expect(out[2]).toContain('"rida1\nrida2"')
  })

  it('does not quote when it does not have to', () => {
    expect(lines(toCsv([row({ nimi: 'Kroon' })], cols))[2].startsWith('Kroon;')).toBe(true)
  })
})

describe('empty and odd values', () => {
  it('writes null and undefined as empty, not as the word null', () => {
    expect(lines(toCsv([row({ note: null })], cols))[2].endsWith(';')).toBe(true)
  })

  it('writes booleans in Estonian', () => {
    const cells = lines(toCsv([row({ makstud: false })], cols))[2].split(';')
    expect(cells[3]).toBe('ei')
  })

  it('writes NaN and Infinity as empty rather than as garbage', () => {
    const cells = lines(toCsv([row({ hind: NaN })], cols))[2].split(';')
    expect(cells[1]).toBe('')
  })

  it('still emits a header for an empty row set', () => {
    expect(lines(toCsv([], cols)).length).toBe(2)
  })
})

describe('csvFileName', () => {
  it('is sortable and says what it is', () => {
    expect(csvFileName('tood', new Date(2026, 7, 5))).toBe('tood-2026-08-05.csv')
  })

  it('pads single-digit months and days', () => {
    expect(csvFileName('arved', new Date(2026, 0, 9))).toBe('arved-2026-01-09.csv')
  })
})
