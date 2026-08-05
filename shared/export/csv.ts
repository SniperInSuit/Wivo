/**
 * CSV, written for the spreadsheet it will actually be opened in.
 *
 * Every export in this app ends up in Excel on an Estonian Windows machine, and
 * two details decide whether that works or produces a mess a person then has to
 * clean by hand:
 *
 *   SEPARATOR  Excel does not read the file to decide how to split it. It uses
 *              the OS "list separator", which on an Estonian (and most European)
 *              locale is a SEMICOLON. A comma-separated file opens as one column
 *              per row. So: semicolon by default, and a `sep=;` hint line, which
 *              Excel honours and which Numbers/LibreOffice ignore harmlessly.
 *
 *   BOM        Without a UTF-8 byte-order mark, Excel guesses the encoding and
 *              guesses Windows-1252, turning "Tõnu Käär" into "TÃµnu KÃ¤Ã¤r".
 *              One three-byte prefix prevents every one of those support emails.
 *
 * Numbers are written with a COMMA decimal separator for the same reason: an
 * Estonian Excel reads "1234.50" as text, not money.
 */

export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn<T> {
  header: string
  /** Return a raw value; formatting and escaping happen here, not in callers. */
  value: (row: T) => CsvValue
}

export interface CsvOptions {
  /** Default ';' — see the note above before changing it. */
  separator?: string
  /** Default true. Excel needs it; everything else tolerates it. */
  bom?: boolean
  /** Default true. Excel honours it, other tools skip the line. */
  sepHint?: boolean
  /** Decimal mark for numbers. Default ',' for Estonian Excel. */
  decimal?: string
}

/** Quote only when needed, and double any quote inside — RFC 4180. */
function escapeCell(raw: string, separator: string): string {
  const needsQuotes =
    raw.includes(separator) || raw.includes('"') ||
    raw.includes('\n') || raw.includes('\r')
  return needsQuotes ? `"${raw.replace(/"/g, '""')}"` : raw
}

function formatValue(v: CsvValue, decimal: string): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'jah' : 'ei'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    // Two decimals for anything fractional, none for whole numbers: a tooth
    // count of "12,00" reads as a measurement rather than a count.
    const s = Number.isInteger(v) ? String(v) : v.toFixed(2)
    return decimal === '.' ? s : s.replace('.', decimal)
  }
  return v
}

/** Build the CSV text. Pure — the download side lives in the renderer. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], opts: CsvOptions = {}): string {
  const separator = opts.separator ?? ';'
  const decimal = opts.decimal ?? ','
  const lines: string[] = []

  if (opts.sepHint !== false) lines.push(`sep=${separator}`)
  lines.push(columns.map(c => escapeCell(c.header, separator)).join(separator))

  for (const row of rows) {
    lines.push(
      columns
        .map(c => escapeCell(formatValue(c.value(row), decimal), separator))
        .join(separator)
    )
  }

  // CRLF: Excel on Windows is the target, and it is the only one that cares.
  const body = lines.join('\r\n')
  return (opts.bom === false ? '' : '﻿') + body
}

/** `tood-2026-08-05.csv` — a name that sorts and says what it is. */
export function csvFileName(base: string, date: Date): string {
  const iso = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  return `${base}-${iso}.csv`
}
