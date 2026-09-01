/**
 * These are the brakes, so they are tested harder than the feature.
 *
 * The mailbox this sends from is the clinic's MAIN address. A loop here does
 * not merely annoy someone — it gets that address throttled or blacklisted by
 * the host and takes the clinic's ordinary mail down with it. Every test below
 * is a way that could happen.
 */
import { describe, it, expect } from 'vitest'
import {
  maySendInvoice, looksLikeEmail, remainingToday,
  SAFE_MAIL_POLICY, type MailPolicy, type SendableInvoice,
} from './sendGuard'

const TODAY = '2026-09-02'

const policy = (over: Partial<MailPolicy> = {}): MailPolicy => ({
  ...SAFE_MAIL_POLICY,
  saatmineLubatud: true,
  lubaArved: true,
  paevaLimiit: 20,
  saatjaAadress: 'info@fullgevitydental.ee',
  ...over,
})

const invoice = (over: Partial<SendableInvoice> = {}): SendableInvoice => ({
  status: 'mustand',
  issue_date: '2026-09-02',
  gross_total: 1220,
  sent_at: null,
  payments: [],
  ...over,
})

const run = (
  inv: Partial<SendableInvoice> = {},
  pol: Partial<MailPolicy> = {},
  to: string | null = 'mari@example.ee',
  sentToday = 0
) => maySendInvoice(invoice(inv), policy(pol), to, sentToday, TODAY)

describe('the default policy sends nothing', () => {
  it('refuses with the shipped defaults', () => {
    const v = maySendInvoice(invoice(), SAFE_MAIL_POLICY, 'mari@example.ee', 0, TODAY)
    expect(v.send).toBe(false)
    expect(v).toMatchObject({ code: 'valjas' })
  })

  it('has the master switch OFF and invoices NOT permitted out of the box', () => {
    expect(SAFE_MAIL_POLICY.saatmineLubatud).toBe(false)
    expect(SAFE_MAIL_POLICY.lubaArved).toBe(false)
  })
})

describe('permission gates', () => {
  it('refuses when the master switch is off, whatever else is set', () => {
    expect(run({}, { saatmineLubatud: false })).toMatchObject({ code: 'valjas' })
  })

  it('refuses when invoices specifically are not permitted', () => {
    expect(run({}, { lubaArved: false })).toMatchObject({ code: 'liik-keelatud' })
  })

  it('refuses without a configured sender address', () => {
    expect(run({}, { saatjaAadress: '' })).toMatchObject({ code: 'saatja-puudub' })
    expect(run({}, { saatjaAadress: 'mitte-aadress' })).toMatchObject({ code: 'saatja-puudub' })
  })
})

describe('never twice', () => {
  it('refuses an invoice that has already been sent', () => {
    // The single most important guard: cron fires more often than anyone
    // expects, and without this the patient gets a second copy every run.
    expect(run({ sent_at: '2026-09-02T06:00:00Z' })).toMatchObject({ code: 'juba-saadetud' })
  })
})

describe('never for the wrong invoice', () => {
  it('refuses a cancelled invoice', () => {
    expect(run({ status: 'tuhistatud' })).toMatchObject({ code: 'tuhistatud' })
  })

  it('refuses one with nothing outstanding', () => {
    expect(run({ payments: [{ amount: 1220 }] })).toMatchObject({ code: 'tasutud' })
  })

  it('still sends a part-paid invoice', () => {
    expect(run({ payments: [{ amount: 200 }] })).toMatchObject({ send: true })
  })

  it('refuses one whose issue date has not arrived', () => {
    // THE worst thing this feature could do: a payment plan writes five
    // invoices up front, four dated in the future. Without this the first run
    // posts all five on day one.
    expect(run({ issue_date: '2026-10-02' })).toMatchObject({ code: 'tulevik' })
  })

  it('sends one dated today or earlier', () => {
    expect(run({ issue_date: '2026-09-02' })).toMatchObject({ send: true })
    expect(run({ issue_date: '2026-08-02' })).toMatchObject({ send: true })
  })

  it('refuses one with no issue date at all', () => {
    expect(run({ issue_date: null })).toMatchObject({ code: 'tulevik' })
  })
})

describe('the daily cap', () => {
  it('refuses once the cap is reached', () => {
    expect(run({}, { paevaLimiit: 20 }, 'mari@example.ee', 20))
      .toMatchObject({ code: 'paevalimiit' })
  })

  it('still sends one below the cap', () => {
    expect(run({}, { paevaLimiit: 20 }, 'mari@example.ee', 19))
      .toMatchObject({ send: true })
  })

  it('sends nothing at all with a cap of zero', () => {
    expect(run({}, { paevaLimiit: 0 })).toMatchObject({ code: 'paevalimiit' })
  })

  it('treats a corrupted cap as zero rather than as infinity', () => {
    expect(run({}, { paevaLimiit: NaN as number })).toMatchObject({ code: 'paevalimiit' })
    expect(remainingToday(policy({ paevaLimiit: NaN as number }), 0)).toBe(0)
  })

  it('is checked BEFORE the address, so bad addresses cannot burn it', () => {
    // Otherwise a run against a list of unreachable people would spend the
    // whole day's allowance on refusals.
    expect(run({}, { paevaLimiit: 0 }, null)).toMatchObject({ code: 'paevalimiit' })
  })

  it('never reports a negative remainder', () => {
    expect(remainingToday(policy({ paevaLimiit: 5 }), 9)).toBe(0)
  })
})

describe('the test address', () => {
  it('redirects everything away from the patient', () => {
    const v = run({}, { testAadress: 'mina@example.ee' })
    expect(v).toEqual({ send: true, to: 'mina@example.ee', redirected: true })
  })

  it('redirects even when the patient has no address of their own', () => {
    // The whole point is that a week can be watched without one patient being
    // written to — including the ones that would otherwise have been skipped.
    expect(run({}, { testAadress: 'mina@example.ee' }, null))
      .toMatchObject({ send: true, redirected: true })
  })

  it('refuses rather than falling back to the patient when it is malformed', () => {
    expect(run({}, { testAadress: 'katki' })).toMatchObject({ code: 'aadress-vigane' })
  })
})

describe('the recipient', () => {
  it('refuses when there is none', () => {
    expect(run({}, {}, null)).toMatchObject({ code: 'aadress-puudub' })
    expect(run({}, {}, '   ')).toMatchObject({ code: 'aadress-puudub' })
  })

  it('refuses one that is not an address', () => {
    expect(run({}, {}, 'mari at example')).toMatchObject({ code: 'aadress-vigane' })
  })

  it('trims what it accepts', () => {
    expect(run({}, {}, '  mari@example.ee ')).toEqual({
      send: true, to: 'mari@example.ee', redirected: false,
    })
  })
})

describe('looksLikeEmail', () => {
  it.each(['mari@example.ee', 'a.b+c@sub.domain.co.uk'])('accepts %s', (v) => {
    expect(looksLikeEmail(v)).toBe(true)
  })

  it.each([
    '', '   ', null, undefined, 'mari', 'mari@', '@example.ee', 'mari@example',
    'mari @example.ee', 'a@b.ee, c@d.ee', 'a@b.ee;c@d.ee',
  ])('refuses %p', (v) => {
    // Comma and semicolon are refused on purpose: a header that smuggles a
    // second recipient past the cap is the cheapest way to turn this into a
    // spam cannon.
    expect(looksLikeEmail(v as string)).toBe(false)
  })

  it('refuses an absurdly long address', () => {
    expect(looksLikeEmail(`${'a'.repeat(250)}@example.ee`)).toBe(false)
  })
})
