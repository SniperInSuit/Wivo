import { describe, it, expect } from 'vitest'
import {
  parseMessage, jobIdsIn, jobToken, insertMention, hasContent, previewOf,
  unreadCount, retentionMonths, pruneCutoff, DEFAULT_RETENTION_MONTHS,
} from './message'

const A = '11111111-2222-3333-4444-555555555555'
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('parseMessage', () => {
  it('splits text around a mention, in order', () => {
    expect(parseMessage(`vaata ${jobToken(A)} üle`)).toEqual([
      { kind: 'text', text: 'vaata ' },
      { kind: 'job', jobId: A },
      { kind: 'text', text: ' üle' },
    ])
  })

  it('handles a body that is only a mention', () => {
    expect(parseMessage(jobToken(A))).toEqual([{ kind: 'job', jobId: A }])
  })

  it('keeps a half-typed token as text', () => {
    // Somebody is still writing. It must not vanish mid-keystroke.
    const body = '[[job:1111'
    expect(parseMessage(body)).toEqual([{ kind: 'text', text: body }])
  })

  it('REFUSES anything that is not a real uuid', () => {
    const body = '[[job:kustuta-koik]]'
    expect(parseMessage(body)).toEqual([{ kind: 'text', text: body }])
  })

  it('drops no characters at all', () => {
    const body = `a ${jobToken(A)} b ${jobToken(B)} c`
    const rebuilt = parseMessage(body)
      .map(s => (s.kind === 'text' ? s.text : jobToken(s.jobId)))
      .join('')
    expect(rebuilt).toBe(body)
  })

  it('is empty for an empty body', () => {
    expect(parseMessage('')).toEqual([])
  })
})

describe('jobIdsIn', () => {
  it('lists every mentioned job once, in first-seen order', () => {
    expect(jobIdsIn(`${jobToken(B)} ja ${jobToken(A)} ja jälle ${jobToken(B)}`))
      .toEqual([B, A])
  })

  it('lower-cases, so one job cannot become two rows', () => {
    // `message_jobs` is keyed on (message, job); two cases of one id would
    // list the same job twice under "everything said about this job".
    expect(jobIdsIn(jobToken(A.toUpperCase()))).toEqual([A])
  })

  it('is empty when nothing is mentioned', () => {
    expect(jobIdsIn('lihtsalt tekst')).toEqual([])
  })
})

describe('insertMention', () => {
  it('adds a space before when the text does not end in one', () => {
    const got = insertMention('vaata', 5, A)
    expect(got.body).toBe(`vaata ${jobToken(A)} `)
    expect(got.cursor).toBe(got.body.length)
  })

  it('does not double the space when there already is one', () => {
    expect(insertMention('vaata ', 6, A).body).toBe(`vaata ${jobToken(A)} `)
  })

  it('does not indent a message that starts with a mention', () => {
    expect(insertMention('', 0, A).body).toBe(`${jobToken(A)} `)
  })

  it('inserts in the middle without eating the rest', () => {
    const got = insertMention('vaata üle', 6, A)
    expect(got.body).toBe(`vaata ${jobToken(A)} üle`)
  })

  it('clamps a cursor outside the text instead of producing undefined', () => {
    expect(insertMention('abc', 999, A).body).toBe(`abc ${jobToken(A)} `)
    expect(insertMention('abc', -5, A).body).toBe(`${jobToken(A)} abc`)
  })
})

describe('hasContent', () => {
  it('is true for words', () => {
    expect(hasContent('tere')).toBe(true)
  })

  it('REFUSES whitespace', () => {
    expect(hasContent('   \n ')).toBe(false)
    expect(hasContent('')).toBe(false)
  })

  it('REFUSES a body of only mentions', () => {
    // A misfire of the picker, not a message.
    expect(hasContent(`${jobToken(A)} ${jobToken(B)}`)).toBe(false)
  })

  it('is true once there are words beside the mention', () => {
    expect(hasContent(`${jobToken(A)} vaata üle`)).toBe(true)
  })
})

describe('previewOf', () => {
  it('names the job rather than dropping it', () => {
    // "vaata üle" without the job is missing the only part that says what it
    // is about.
    expect(previewOf(`vaata ${jobToken(A)} üle`, () => 'Kroon · Mari'))
      .toBe('vaata Kroon · Mari üle')
  })

  it('falls back to a word when the job is not loaded', () => {
    expect(previewOf(`vaata ${jobToken(A)} üle`)).toBe('vaata töö üle')
  })

  it('collapses newlines so the list stays one line', () => {
    expect(previewOf('esimene\n\nteine')).toBe('esimene teine')
  })
})

describe('unreadCount', () => {
  const msg = (created_at: string, author_id: string | null) => ({ created_at, author_id })

  it('counts messages after the last read', () => {
    const got = unreadCount(
      [msg('2026-10-01T10:00:00Z', 'muu'), msg('2026-10-02T10:00:00Z', 'muu')],
      '2026-10-01T12:00:00Z', 'mina',
    )
    expect(got).toBe(1)
  })

  it('REFUSES to count my own messages', () => {
    // Sending one and watching the badge go to 1 is how people stop trusting it.
    expect(unreadCount([msg('2026-10-02T10:00:00Z', 'mina')], null, 'mina')).toBe(0)
  })

  it('counts everything when the channel was never opened', () => {
    expect(unreadCount([msg('2026-10-01T10:00:00Z', 'muu')], null, 'mina')).toBe(1)
  })

  it('counts a message from somebody who has since been deleted', () => {
    // `author_id` is set null when a profile goes. The message is still unread.
    expect(unreadCount([msg('2026-10-01T10:00:00Z', null)], null, 'mina')).toBe(1)
  })

  it('is zero for an empty channel', () => {
    expect(unreadCount([], null, 'mina')).toBe(0)
  })
})

describe('retentionMonths', () => {
  it('defaults when nothing is stored', () => {
    expect(retentionMonths(undefined)).toBe(DEFAULT_RETENTION_MONTHS)
    expect(retentionMonths(null)).toBe(DEFAULT_RETENTION_MONTHS)
  })

  it('takes a real number', () => {
    expect(retentionMonths(36)).toBe(36)
  })

  it('treats zero and below as "keep forever"', () => {
    expect(retentionMonths(0)).toBe(0)
    expect(retentionMonths(-5)).toBe(0)
  })

  it('REFUSES a value that is not a number, rather than deleting on it', () => {
    // This number deletes health data on a schedule.
    expect(retentionMonths('24')).toBe(DEFAULT_RETENTION_MONTHS)
    expect(retentionMonths(Number.NaN)).toBe(DEFAULT_RETENTION_MONTHS)
    expect(retentionMonths(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RETENTION_MONTHS)
  })

  it('caps at ten years, past which it is a typo and not a policy', () => {
    expect(retentionMonths(99999)).toBe(120)
  })

  it('rounds a fraction instead of carrying it into an interval', () => {
    expect(retentionMonths(24.6)).toBe(25)
  })
})

describe('pruneCutoff', () => {
  it('is the date that many months back', () => {
    expect(pruneCutoff(new Date('2026-10-28T00:00:00Z'), 24))
      .toBe('2024-10-28T00:00:00.000Z')
  })

  it('is null when nothing expires', () => {
    expect(pruneCutoff(new Date('2026-10-28T00:00:00Z'), 0)).toBeNull()
  })

  it('handles a month that is shorter than the one it lands on', () => {
    // 31 March minus one month is not 31 February. Whatever it rolls to, it
    // must be a real date in the past, not Invalid Date.
    const got = pruneCutoff(new Date('2026-03-31T00:00:00Z'), 1)
    expect(got).not.toBeNull()
    expect(new Date(got!).getTime()).toBeLessThan(new Date('2026-03-31T00:00:00Z').getTime())
  })
})
