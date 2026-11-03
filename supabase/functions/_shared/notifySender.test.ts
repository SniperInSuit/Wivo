/**
 * send-notifications' work (notifySender.ts), against stand-ins for the
 * database, Resend and the push service. The bug this was written for: on a
 * project without the e-mail secrets the function answered 500 before it
 * reached the pushes, so no phone ever rang.
 */
import { describe, it, expect } from 'vitest'
import { runSender, EMAIL_NOT_SET, PUSH_BATCH, type SenderDeps, type PushResult } from './notifySender'

const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:ops@test.invalid' }
const EMAIL = { RESEND_API_KEY: 're_test', NOTIFY_FROM: 'Wivo <noreply@test.invalid>', APP_LINK: 'https://wivo-test.pages.dev/job/{id}' }

function harness(opts: {
  env?: Record<string, string>
  pending?: { notification_id: string; subscription_id: string; endpoint: string }[]
  emails?: { id: string; email: string; job_id: string | null; job_code: string | null; kind: string; language: string }[]
  push?: (endpoint: string) => PushResult
  rpcError?: string
} = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const pushed: string[] = []
  const mailed: { to: string; subject: string }[] = []
  const warnings: string[] = []
  const deps: SenderDeps = {
    env: name => opts.env?.[name],
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      if (opts.rpcError === fn) return { data: null, error: { message: `${fn} broke` } }
      if (fn === 'pending_pushes') return { data: opts.pending ?? [], error: null }
      if (fn === 'pending_notification_emails') return { data: opts.emails ?? [], error: null }
      return { data: [], error: null }
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body) as { to: string; subject: string }
      mailed.push({ to: body.to, subject: body.subject })
      return { ok: true, status: 200, text: async () => '' }
    },
    signingKey: async () => ({}) as CryptoKey,
    push: async endpoint => { pushed.push(endpoint); return opts.push?.(endpoint) ?? 'ok' },
    warn: m => warnings.push(m),
  }
  const called = (fn: string) => calls.filter(c => c.fn === fn)
  return { deps, calls, called, pushed, mailed, warnings }
}

const phone = (n: string, sub = 's1') => ({ notification_id: n, subscription_id: sub, endpoint: `https://web.push.apple.com/${sub}` })

describe('without the e-mail secrets', () => {
  it('skips e-mail with a warning, and still sends the pushes (the bug)', async () => {
    const h = harness({ env: VAPID, pending: [phone('n1')] })
    const r = await runSender(h.deps, false)
    expect(h.warnings).toEqual([EMAIL_NOT_SET])
    expect(h.called('pending_notification_emails')).toEqual([])
    expect(h.called('pending_bug_reports')).toEqual([])
    expect(h.mailed).toEqual([])
    expect(h.pushed).toEqual(['https://web.push.apple.com/s1'])
    expect(h.called('mark_pushed')[0].args).toEqual({ p_notifications: ['n1'], p_ok_subscriptions: ['s1'], p_gone_subscriptions: [] })
    expect(r).toMatchObject({ ok: true, email: { status: 'skipped', sent: 0 }, pushes: { sent: 1, gone: 0 } })
  })

  it('one secret of the two is not enough either', async () => {
    const h = harness({ env: { ...VAPID, RESEND_API_KEY: 're_test' }, pending: [phone('n1')] })
    expect((await runSender(h.deps, false)).email.status).toBe('skipped')
    expect(h.pushed).toHaveLength(1)
  })
})

describe('with the e-mail secrets', () => {
  it('sends e-mails (subject in the recipient\'s language, job link) and pushes', async () => {
    const h = harness({
      env: { ...VAPID, ...EMAIL },
      emails: [{ id: 'n1', email: 'tech@test.invalid', job_id: 'j1', job_code: 'TAL-26-0042', kind: 'stage_reached', language: 'et' }],
      pending: [phone('n1')],
    })
    const r = await runSender(h.deps, false)
    expect(h.warnings).toEqual([])
    expect(h.mailed).toEqual([{ to: 'tech@test.invalid', subject: 'Töö TAL-26-0042 liikus uude etappi' }])
    expect(h.called('mark_notifications_emailed')[0].args).toEqual({ p_ids: ['n1'] })
    expect(h.pushed).toHaveLength(1)
    expect(r).toMatchObject({ ok: true, email: { status: 'sent', sent: 1 }, pushes: { sent: 1 } })
  })

  it('a security notice (sql/097) has its own subject, not a job\'s', async () => {
    const texts: string[] = []
    const h = harness({
      env: { ...VAPID, ...EMAIL },
      emails: [
        { id: 'n1', email: 'mari@test.invalid', job_id: null, job_code: null, kind: 'mfa_reset', language: 'et' },
        { id: 'n2', email: 'kai@test.invalid', job_id: null, job_code: null, kind: 'mfa_removed', language: 'en' },
      ],
    })
    const fetch = h.deps.fetch
    h.deps.fetch = async (url, init) => { texts.push((JSON.parse(init.body) as { text: string }).text); return fetch(url, init) }
    await runSender(h.deps, false)
    // The link opens Settings, not a job page with "{id}" in it.
    expect(texts[0]).toBe('Sinu Wivo kaheastmeline sisselogimine lähtestati\n\nAva Wivos: https://wivo-test.pages.dev/settings\n')
    expect(h.mailed).toEqual([
      { to: 'mari@test.invalid', subject: 'Sinu Wivo kaheastmeline sisselogimine lähtestati' },
      { to: 'kai@test.invalid', subject: 'An authenticator was removed from your Wivo account' },
    ])
  })

  it('an e-mail error does not stop the pushes', async () => {
    const h = harness({ env: { ...VAPID, ...EMAIL }, pending: [phone('n1')], rpcError: 'pending_notification_emails' })
    const r = await runSender(h.deps, false)
    expect(r.email).toMatchObject({ status: 'error', error: 'pending_notification_emails broke' })
    expect(h.pushed).toHaveLength(1)
    expect(r.ok).toBe(false)
  })
})

describe('pushes', () => {
  it('one push per phone however many notifications wait; gone phones are dropped; failed ones are retried', async () => {
    const h = harness({
      env: VAPID,
      pending: [phone('n1', 'a'), phone('n2', 'a'), phone('n3', 'gone'), phone('n4', 'bad')],
      push: e => (e.endsWith('/gone') ? 'gone' : e.endsWith('/bad') ? 'failed' : 'ok'),
    })
    const r = await runSender(h.deps, false)
    expect(h.pushed.sort()).toEqual(['https://web.push.apple.com/a', 'https://web.push.apple.com/bad', 'https://web.push.apple.com/gone'])
    expect(h.called('mark_pushed')[0].args).toEqual({
      p_notifications: ['n1', 'n2', 'n3'], p_ok_subscriptions: ['a'], p_gone_subscriptions: ['gone'],
    })
    expect(r.pushes).toEqual({ sent: 1, gone: 1 })
  })

  it('without the VAPID keys: nothing pushed, said in the result and the log', async () => {
    const h = harness({ env: EMAIL, pending: [phone('n1')] })
    const r = await runSender(h.deps, false)
    expect(h.pushed).toEqual([])
    expect(r.pushes.error).toBe('VAPID keys not set')
    expect(h.warnings).toContain('push: VAPID keys not set')
    expect(r.ok).toBe(false)
  })

  it('a full batch leaves its last notification for the next run', async () => {
    const pending = Array.from({ length: PUSH_BATCH }, (_, i) => phone(`n${i}`, `s${i}`))
    const h = harness({ env: VAPID, pending })
    await runSender(h.deps, false)
    const marked = h.called('mark_pushed')[0].args.p_notifications as string[]
    expect(marked).toHaveLength(PUSH_BATCH - 1)
    expect(marked).not.toContain(`n${PUSH_BATCH - 1}`)
  })

  it('dry run: nothing is sent or marked, e-mail secrets or not', async () => {
    const h = harness({ env: VAPID, pending: [phone('n1')] })
    const r = await runSender(h.deps, true)
    expect(h.pushed).toEqual([])
    expect(h.called('mark_pushed')).toEqual([])
    expect(h.warnings).toEqual([])
    expect(r).toMatchObject({ dry: true, pushes: { sent: 1 } })
  })
})
