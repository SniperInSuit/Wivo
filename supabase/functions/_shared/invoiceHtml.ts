/**
 * The invoice as an email.
 *
 * Tables and inline styles, not because it is 2005 but because mail clients
 * strip `<style>` blocks and ignore flexbox, grid and most of CSS. This is the
 * one rendering in the project that cannot use the app's stylesheet, and that
 * is exactly why `shared/billing/invoiceDoc.ts` exists: every number and every
 * formatted string below comes from there, so the emailed copy and the printed
 * one cannot say different things.
 *
 * Nothing is computed here. If a number appears in this file that is not read
 * straight off the doc, that is a bug.
 */
import type { InvoiceDoc } from '@shared/billing/invoiceDoc.ts'

/** HTML-escape. Every value below is user data — a clinic name with an
 *  ampersand must not become broken markup, and a note is free text. */
const esc = (v: string | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const CELL = 'padding:6px 0;font-size:14px;color:#111;'
const MUTED = 'color:#666;'

export function invoiceSubject(doc: InvoiceDoc): string {
  return `Arve ${doc.number}${doc.hasDueDate ? ` — tähtaeg ${doc.dueDate}` : ''}`
}

/**
 * A plain-text alternative, sent alongside the HTML.
 *
 * Not decoration: a message with no text part scores worse with spam filters,
 * and this is going out from the clinic's main mailbox — the one address that
 * must not end up classified as spam.
 */
export function invoiceText(doc: InvoiceDoc): string {
  const lines = [
    `ARVE ${doc.number}`,
    `Kuupäev: ${doc.issueDate}`,
    doc.hasDueDate ? `Maksetähtaeg: ${doc.dueDate}` : '',
    '',
    `Maksja: ${doc.buyer.name}`,
    '',
    ...doc.lines.map(l => `${l.description} — ${l.qtyText} × ${l.unitPriceText} = ${l.totalText}`),
    '',
    `Summa: ${doc.totals.netText}`,
    `${doc.totals.vatLabel}: ${doc.totals.vatText}`,
    `Kokku tasuda: ${doc.totals.grossText}`,
    doc.totals.showPaid ? `Laekunud: ${doc.totals.paidText}` : '',
    doc.totals.showPaid ? `Tasumata: ${doc.totals.dueText}` : '',
    '',
    doc.payment ? `Makse: ${doc.payment.bankName ?? ''} ${doc.payment.iban ?? ''}`.trim() : '',
    doc.payment ? `Selgitus: ${doc.payment.reference}` : '',
    '',
    doc.note ?? '',
    '',
    doc.seller.name,
    ...doc.seller.lines,
  ]
  return lines.filter(l => l !== '').join('\n')
}

export function invoiceHtml(doc: InvoiceDoc): string {
  const rows = doc.lines.map(l => `
    <tr>
      <td style="${CELL}border-bottom:1px solid #ddd;">${esc(l.description)}</td>
      <td style="${CELL}border-bottom:1px solid #ddd;text-align:right;">${esc(l.qtyText)}</td>
      <td style="${CELL}border-bottom:1px solid #ddd;text-align:right;">${esc(l.unitPriceText)}</td>
      <td style="${CELL}border-bottom:1px solid #ddd;text-align:right;">${esc(l.totalText)}</td>
    </tr>`).join('')

  const paidRows = doc.totals.showPaid ? `
    <tr>
      <td style="${CELL}${MUTED}padding-right:24px;">Laekunud</td>
      <td style="${CELL}text-align:right;">${esc(doc.totals.paidText)}</td>
    </tr>
    <tr>
      <td style="${CELL}padding-right:24px;font-weight:600;">Tasumata</td>
      <td style="${CELL}text-align:right;font-weight:600;">${esc(doc.totals.dueText)}</td>
    </tr>` : ''

  return `<!doctype html>
<html lang="et">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#fff;padding:32px;">
  <tr><td>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-size:22px;font-weight:bold;color:#111;">ARVE</div>
          <div style="${CELL}"><span style="${MUTED}">Number </span><strong>${esc(doc.number)}</strong></div>
          <div style="${CELL}"><span style="${MUTED}">Kuupäev </span>${esc(doc.issueDate)}</div>
          ${doc.hasDueDate
            ? `<div style="${CELL}"><span style="${MUTED}">Maksetähtaeg </span><strong>${esc(doc.dueDate)}</strong></div>`
            : ''}
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="font-size:15px;font-weight:bold;color:#111;">${esc(doc.seller.name)}</div>
          ${doc.seller.lines.map(l => `<div style="font-size:13px;${MUTED}">${esc(l)}</div>`).join('')}
        </td>
      </tr>
    </table>

    <div style="margin-top:28px;">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;${MUTED}">Maksja</div>
      <div style="font-size:15px;font-weight:600;color:#111;">${esc(doc.buyer.name)}</div>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <th align="left"   style="${CELL}border-bottom:2px solid #111;">Kirjeldus</th>
        <th align="right"  style="${CELL}border-bottom:2px solid #111;">Kogus</th>
        <th align="right"  style="${CELL}border-bottom:2px solid #111;">Ühiku hind</th>
        <th align="right"  style="${CELL}border-bottom:2px solid #111;">Summa</th>
      </tr>
      ${rows}
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 auto;">
      <tr>
        <td style="${CELL}${MUTED}padding-right:24px;">Summa</td>
        <td style="${CELL}text-align:right;">${esc(doc.totals.netText)}</td>
      </tr>
      <tr>
        <td style="${CELL}${MUTED}padding-right:24px;">${esc(doc.totals.vatLabel)}</td>
        <td style="${CELL}text-align:right;">${esc(doc.totals.vatText)}</td>
      </tr>
      <tr>
        <td style="${CELL}border-top:2px solid #111;font-weight:bold;padding-right:24px;">Kokku tasuda</td>
        <td style="${CELL}border-top:2px solid #111;text-align:right;font-weight:bold;font-size:16px;">${esc(doc.totals.grossText)}</td>
      </tr>
      ${paidRows}
    </table>

    ${doc.payment ? `
    <div style="margin-top:28px;">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;${MUTED}">Makse</div>
      ${doc.payment.bankName ? `<div style="${CELL}">${esc(doc.payment.bankName)}</div>` : ''}
      ${doc.payment.iban ? `<div style="${CELL}">IBAN ${esc(doc.payment.iban)}</div>` : ''}
      <div style="${CELL}${MUTED}">Selgitus: ${esc(doc.payment.reference)}</div>
    </div>` : ''}

    ${doc.note ? `
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;${CELL}white-space:pre-wrap;">${esc(doc.note)}</div>`
      : ''}

  </td></tr>
</table>
</body>
</html>`
}
