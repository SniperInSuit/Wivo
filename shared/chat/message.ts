/**
 * Message bodies, job mentions and unread counts. Pure, no dependencies.
 *
 * ── Why a token in the text and a row in the database ───────────────────────
 * A mention has to be two things at once: part of a sentence, and a link that
 * survives. Storing only a row loses WHERE in the sentence it was ("vaata üle"
 * — which job?). Storing only text means "näita kõike, mis selle töö kohta on
 * öeldud" is a substring search over every message in the clinic.
 *
 * So the body carries `[[job:<uuid>]]` and `message_jobs` carries the row. The
 * body is the source: the rows are derived from it on save, which is why
 * `jobIdsIn` exists and why nothing writes those rows by hand.
 *
 * ── Why the token is readable ───────────────────────────────────────────────
 * It survives being copied into an email, and if rendering ever fails it reads
 * as something a person can act on rather than as mojibake. The same message
 * seen by a client that cannot resolve the job still says a job was meant.
 */

/** A UUID as Postgres writes it. Deliberately strict — see `jobIdsIn`. */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const TOKEN = new RegExp(`\\[\\[job:(${UUID})\\]\\]`, 'g')

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'job'; jobId: string }

/**
 * Splits a body into text and job mentions, in order.
 *
 * Never throws and never drops characters: anything that is not a well-formed
 * token stays text, including a half-typed `[[job:` somebody is still writing.
 */
export function parseMessage(body: string): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const m of body.matchAll(TOKEN)) {
    const start = m.index ?? 0
    if (start > at) out.push({ kind: 'text', text: body.slice(at, start) })
    out.push({ kind: 'job', jobId: m[1].toLowerCase() })
    at = start + m[0].length
  }
  if (at < body.length) out.push({ kind: 'text', text: body.slice(at) })
  return out
}

/**
 * Every job this message mentions, deduplicated, in first-seen order.
 *
 * Lower-cased, because `message_jobs` has a primary key on (message, job) and
 * the same id in two cases would be two rows pointing at one job — and then
 * "all messages about this job" lists it twice.
 */
export function jobIdsIn(body: string): string[] {
  const seen = new Set<string>()
  for (const seg of parseMessage(body)) {
    if (seg.kind === 'job') seen.add(seg.jobId)
  }
  return [...seen]
}

/** The token for a job, as it is written into a body. */
export const jobToken = (jobId: string): string => `[[job:${jobId}]]`

/**
 * Inserts a mention at `cursor`, returning the new body and where the caret
 * should land.
 *
 * Surrounding spaces are added only where there is not one already, so picking
 * two jobs in a row does not produce a double space, and picking one at the
 * very start does not indent the message.
 */
export function insertMention(
  body: string, cursor: number, jobId: string,
): { body: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, body.length))
  const before = body.slice(0, at)
  const after = body.slice(at)
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : ' '
  const inserted = `${lead}${jobToken(jobId)}${trail}`
  return { body: before + inserted + after, cursor: at + inserted.length }
}

/**
 * Is there anything to send?
 *
 * A body of only whitespace is nothing, and so is one of only mentions with no
 * words — that is a misfire of the picker, not a message. The database has the
 * same rule as a CHECK constraint; this is so the button can be disabled
 * rather than the insert rejected.
 */
export function hasContent(body: string): boolean {
  return parseMessage(body).some(s => s.kind === 'text' && s.text.trim().length > 0)
}

/**
 * A one-line preview for the channel list.
 *
 * Mentions become a word rather than disappearing: a preview reading "vaata
 * üle" when the message was "vaata üle [job]" is missing the only part that
 * says what it is about.
 */
export function previewOf(body: string, jobLabel?: (id: string) => string | null): string {
  return parseMessage(body)
    .map(s => (s.kind === 'text' ? s.text : (jobLabel?.(s.jobId) ?? 'töö')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Unread ───────────────────────────────────────────────────────────────────

export interface UnreadInput {
  created_at: string
  author_id: string | null
}

/**
 * How many messages in this channel are new to me.
 *
 * Derived from `last_read_at` rather than kept as a counter, so it cannot drift
 * from the messages themselves — a counter that says 3 over an empty channel is
 * a bug nobody can explain, and incrementing one correctly across realtime,
 * reconnects and two open windows is harder than it looks.
 *
 * My OWN messages never count. Sending one and seeing the badge go to 1 is the
 * kind of wrong that makes people stop trusting the badge.
 */
export function unreadCount(
  messages: UnreadInput[], lastReadAt: string | null, myId: string,
): number {
  return messages.filter(m =>
    m.author_id !== myId && (lastReadAt === null || m.created_at > lastReadAt),
  ).length
}

// ── Retention ────────────────────────────────────────────────────────────────

export const DEFAULT_RETENTION_MONTHS = 24

/**
 * How long this clinic keeps messages. 0 means forever.
 *
 * ── Why it is clamped and not trusted ───────────────────────────────────────
 * This number deletes health data on a schedule. A corrupted value, or a typed
 * `2.5`, must not become a cutoff nobody intended — and the direction of the
 * error matters: too long keeps data that should have gone, too short destroys
 * a warranty conversation. Both are bad, so anything unreadable falls back to
 * the stated default rather than to either extreme.
 *
 * The ceiling is ten years, which is the retention a custom-made device's
 * documentation carries under MDR Annex XIII — past that the number is not a
 * policy, it is a typo.
 */
export function retentionMonths(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_RETENTION_MONTHS
  const n = Math.round(raw)
  if (n <= 0) return 0
  return Math.min(120, n)
}

/** The date before which messages are deleted. Null when nothing expires. */
export function pruneCutoff(now: Date, months: number): string | null {
  if (months <= 0) return null
  const d = new Date(now.getTime())
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString()
}
