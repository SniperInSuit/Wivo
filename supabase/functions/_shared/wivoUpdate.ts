/**
 * wivo-update: each clinic's own updater (docs/ARCHITECTURE-INSTANCES.md 5b,
 * 5g). Installed in the clinic's project at setup. It checks Wivo's signed
 * list and, on an approver's word with a fresh code, installs a package's
 * migrations in one transaction, then runs the read-only checks.
 *
 * Everything that decides is here, with the database connection and the
 * network passed in, so Vitest runs it against the real migrations (PGlite)
 * and made-up signed releases. ../wivo-update/index.ts only wires it up.
 *
 * The caller is trusted for one thing only, who they are, and the database
 * decides that (sql/120 update_approval). The version they ask for is looked
 * up in a list this function fetched and checked itself, and every byte
 * installed is checked against Wivo's signature first.
 *
 * Not here yet: Edge Functions in a package (the functions token, 5c, phase
 * 1 slice 3), the first install (the setup tool, slice 5) and automatic
 * installs (after Riga is running).
 */
import * as release from './generated/release.ts'
import type { Channel, Fetcher, Index, RootKey, SerialFloor, Trust } from './generated/release.ts'

export type { Fetcher }
export { limitedFetcher } from './generated/release.ts'

/** The project's own database connection (SUPABASE_DB_URL). */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  /** A script of several statements without parameters: a migration. */
  exec(text: string): Promise<void>
  /** Everything inside stands or falls together. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

export interface Updater {
  db: Db
  fetch: Fetcher
  /** release.PINNED_ROOTS: in the function's own code, never a table or a secret. */
  pinned: RootKey[]
  /** release.UPDATE_SOURCES: tried in order. */
  sources: string[]
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

const dbNow = async (db: Db): Promise<Date> =>
  new Date((await db.query<{ now: string | Date }>(`select now() as now`)).rows[0].now)

async function instanceChannel(db: Db): Promise<Channel | null> {
  const { rows } = await db.query<{ channel: Channel }>(`select channel from public.wivo_instance`)
  return rows[0]?.channel ?? null
}

/** The installed version: the highest package version in the ledger. Null before the first install. */
async function installedVersion(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ v: string }>(`select distinct package_version as v from public.wivo_schema_migration`)
  return rows.map(r => r.v).sort(release.compareVersions).at(-1) ?? null
}

async function ledger(db: Db): Promise<release.LedgerRow[]> {
  return (await db.query<release.LedgerRow>(`select file, sha256 from public.wivo_schema_migration`)).rows
}

// ─── The list ─────────────────────────────────────────────────────────────────

export type ListCheck =
  | { ok: true; index: Index; signedSha256: string; trust: Trust; source: string; stale: boolean }
  | { ok: false; reason: string; stale: boolean }

/** Refusals worth more than "unreachable" when several sources answered: the one that says the most. */
const tellingFirst = (reasons: string[]): string =>
  reasons.find(r => r !== 'unreachable' && r !== 'malformed') ?? reasons.find(r => r === 'malformed') ?? 'unreachable'

/**
 * Fetches the list from each source in turn and checks it (5g): signed by a
 * certified key, not revoked, for this channel, unexpired by the database's
 * clock, and not older than one already accepted. Records the check, every
 * new revocation, and every new certificate that checks out. `by`: who asked,
 * or null for the project's own scheduled check.
 */
export async function checkList(u: Updater, by: string | null): Promise<ListCheck> {
  const channel = await instanceChannel(u.db)
  if (!channel) return { ok: false, reason: 'not_instance', stale: true }
  const now = await dbNow(u.db)
  const { rows: seen } = await u.db.query<{ kind: string; token: string }>(`select kind, token from public.wivo_trust`)
  const seenRevocations = seen.filter(t => t.kind === 'revocation').map(t => t.token)
  const seenCertificates = seen.filter(t => t.kind === 'certificate').map(t => t.token)
  const floor = (await u.db.query<{ f: SerialFloor }>(`select public.wivo_update_floor() as f`)).rows[0].f

  const reasons: string[] = []
  for (const source of u.sources) {
    const bytes = await u.fetch(release.listAddress(source, channel), release.MAX_INDEX_BYTES * 2)
    const list = bytes && release.parsePublishedList(bytes)
    if (!list) { reasons.push(bytes ? 'malformed' : 'unreachable'); continue }

    const listed = release.listedRevocations(list.index)
    for (const token of listed.filter(t => !seenRevocations.includes(t))) await recordRevocation(u, token)
    const trust = await release.trustFrom(u.pinned, [...seenRevocations, ...listed])
    const r = await release.checkIndex(list.index, [...new Set([...seenCertificates, ...list.certificates])], trust, now, channel, floor)
    if (!r.ok) { reasons.push(r.reason); continue }

    for (const token of list.certificates.filter(t => !seenCertificates.includes(t))) await recordCertificate(u.db, token, trust, now)
    const stale = await recordCheck(u.db, by, 'accepted', null, r.index, r.signedSha256)
    return { ok: true, index: r.index, signedSha256: r.signedSha256, trust, source, stale }
  }
  const reason = u.sources.length === 0 ? 'no_source' : tellingFirst(reasons)
  return { ok: false, reason, stale: await recordCheck(u.db, by, 'refused', reason) }
}

/** A revocation signed by a pinned root (and not by the root it revokes) is kept for good. */
async function recordRevocation(u: Updater, token: string): Promise<void> {
  const [r] = (await release.trustFrom(u.pinned, [token])).revocations
  if (r) await u.db.query(`select public.wivo_record_trust('revocation', $1, $2)`, [r.key_id, token])
}

/** A certificate a pinned root signed, valid now, for update or app keys, is kept for good. */
async function recordCertificate(db: Db, token: string, trust: Trust, now: Date): Promise<void> {
  for (const purpose of ['update', 'app'] as const) {
    const c = await release.checkCertificate(token, trust, purpose, now)
    if (c.ok) {
      await db.query(`select public.wivo_record_trust('certificate', $1, $2)`, [c.payload.key_id, token])
      return
    }
  }
}

async function recordCheck(db: Db, by: string | null, result: 'accepted' | 'refused', reason: string | null,
  index?: Index, sha256?: string): Promise<boolean> {
  const list = index ? JSON.stringify({ versions: index.versions, withdrawn: index.withdrawn, app: index.app ?? null }) : null
  const { rows } = await db.query<{ stale: boolean }>(
    `select public.wivo_record_check($1, $2, $3, $4, $5, $6, $7, $8::jsonb) as stale`,
    [by, result, reason?.slice(0, 100) ?? null, index?.key_id ?? null, index?.serial ?? null, sha256 ?? null, index?.expires ?? null, list])
  return rows[0].stale
}

// ─── Installing ───────────────────────────────────────────────────────────────

export interface Approval {
  /** Null: the project's own scheduled job (automatic installs, not built yet). */
  by: string | null
  mode: 'manual' | 'automatic'
}

export type Installed =
  | { ok: true; from: string | null; to: string; applied: string[]; checks: Record<string, number | string> }
  | { ok: false; reason: string }

class Refused extends Error {
  constructor(readonly reason: string) { super(reason) }
}

/**
 * A migration must run inside the install's one transaction (5b): no
 * statement that ends it, starts another, or can't run in one. The release
 * tool refuses these before signing; this refuses them again before running.
 * Dollar-quoted bodies and comments are skipped, so PL/pgSQL's own BEGIN and
 * END don't count.
 */
export function transactionSafe(sql: string): boolean {
  const code = sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
  return !/\b(commit|rollback|savepoint|vacuum|concurrently)\b|\bbegin\s*(;|transaction\b|work\b|isolation\b)|\bstart\s+transaction\b|\balter\s+system\b|\bcreate\s+database\b|\bdrop\s+database\b/i.test(code)
}

/**
 * Installs one version, as approved: the list fetched and checked again, the
 * package fetched, checked against the list and Wivo's signature, planned
 * against the ledger, then every migration and its ledger row in one
 * transaction. Then the read-only checks. Every attempt is recorded, with
 * who, from and to, the package hash, and the result.
 */
export async function install(u: Updater, version: string, who: Approval): Promise<Installed> {
  if (!release.isVersion(version)) return { ok: false, reason: 'bad_version' }
  const installed = await installedVersion(u.db)
  const refuse = async (reason: string, sha: string | null = null): Promise<Installed> => {
    await recordInstall(u.db, installed, version, sha, who, 'refused', reason, null)
    return { ok: false, reason }
  }
  if (installed === null) return refuse('not_set_up')

  const list = await checkList(u, who.by)
  if (!list.ok) return refuse(`list_${list.reason}`)
  const entry = list.index.versions.find(e => e.version === version)
  if (!entry) return refuse('not_listed')
  if (list.index.withdrawn.some(w => w.version === version)) return refuse('withdrawn', entry.sha256)
  const now = await dbNow(u.db)
  if (who.mode === 'automatic' && (entry.manual_only || Date.parse(entry.auto_after) > now.getTime())) {
    return refuse('not_automatic', entry.sha256)
  }

  const bytes = await u.fetch(release.packageAddress(list.source, list.index.channel, entry.package), entry.size)
  if (!bytes) return refuse('package_unreachable', entry.sha256)
  const sha = await release.sha256Hex(bytes)
  const listed = release.checkListed(list.index, version, sha, bytes.length)
  if (!listed.ok) return refuse(listed.reason, entry.sha256)
  let pkg: unknown
  try { pkg = JSON.parse(utf8.decode(bytes)) } catch { return refuse('malformed', sha) }
  const checked = await release.checkPackage(pkg, list.trust, now, list.index.channel, bytes.length)
  if (!checked.ok) return refuse(checked.reason, sha)
  if (checked.manifest.version !== version) return refuse('not_listed', sha)
  if (checked.manifest.files.some(f => f.path.startsWith('functions/'))) return refuse('functions_not_yet', sha)
  const texts = new Map<string, string>()
  try {
    for (const [path, b] of checked.files) texts.set(path, utf8.decode(b))
  } catch {
    return refuse('malformed', sha)
  }
  if ([...texts].some(([path, text]) => path.startsWith('migrations/') && !transactionSafe(text))) return refuse('not_transaction_safe', sha)

  let current = 'install'
  let applied: string[] = []
  try {
    await u.db.transaction(async tx => {
      // Two approvers at once: the second waits, then plans against what the first installed.
      await tx.query(`select pg_advisory_xact_lock(hashtext('wivo-update'))`)
      const plan = release.planInstall(checked.manifest, await installedVersion(tx), await ledger(tx))
      if (!plan.ok) throw new Refused(plan.reason)
      for (const m of plan.migrations) {
        current = m.path
        await tx.exec(texts.get(m.path)!)
        await tx.query(`select public.wivo_record_migration($1, $2, $3, $4, $5, $6)`, [m.path, m.sha256, version, sha, who.mode, who.by])
      }
      applied = plan.migrations.map(m => m.path)
    })
  } catch (e) {
    if (e instanceof Refused) return refuse(e.reason, sha)
    // The migration and the SQLSTATE only: an error's text can quote data.
    const code = (e as { code?: unknown }).code
    const reason = `${current} ${typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'error'}`.slice(0, 200)
    await recordInstall(u.db, installed, version, sha, who, 'failed', reason, null)
    return { ok: false, reason }
  }

  // The API reads the new schema now, not at its next restart.
  await u.db.query(`notify pgrst, 'reload schema'`)
  const checks = await runChecks(u.db, checked.manifest.files.filter(f => f.path.startsWith('checks/')).map(f => [f.path, texts.get(f.path)!]))
  await recordInstall(u.db, installed, version, sha, who, 'installed', null, checks)
  return { ok: true, from: installed, to: version, applied, checks }
}

/** Each read-only check in a read-only transaction of its own: per check, the rows it returned, or its SQLSTATE. */
async function runChecks(db: Db, checks: [string, string][]): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {}
  for (const [path, text] of checks) {
    try {
      out[path] = await db.transaction(async tx => {
        await tx.query(`set transaction read only`)
        return (await tx.query(text)).rows.length
      })
    } catch (e) {
      const code = (e as { code?: unknown }).code
      out[path] = `error ${typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : ''}`.trim()
    }
  }
  return out
}

async function recordInstall(db: Db, from: string | null, to: string, sha: string | null, who: Approval,
  result: 'installed' | 'refused' | 'failed', reason: string | null, checks: Record<string, number | string> | null): Promise<void> {
  await db.query(`select public.wivo_record_install($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [from, to, sha, who.mode, who.by, result, reason, checks ? JSON.stringify(checks) : null])
}

// ─── The request ──────────────────────────────────────────────────────────────

export type Rpc = (fn: string) => PromiseLike<{ data: unknown; error: unknown }>

export interface RequestDeps {
  updater: Updater
  /** The project's own service key: the scheduled check (serviceAuth.ts). */
  isService: (authorization: string | null) => boolean
  /** As the caller, with their token: update_approval (sql/120). */
  asUser: Rpc
}

export interface Answer {
  status: number
  body: Record<string, unknown>
}

const no = (status: number, error: string): Answer => ({ status, body: { ok: false, error } })

/**
 *   { action: 'check' }                 the scheduled job (service key), or an approver
 *   { action: 'install', version }      an approver with a code under 5 minutes old
 */
export async function handleUpdateRequest(authorization: string | null, body: unknown, deps: RequestDeps): Promise<Answer> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (b.action !== 'check' && b.action !== 'install') return no(400, 'bad_request')
  if (b.action === 'install' && !release.isVersion(b.version)) return no(400, 'bad_request')

  if (deps.isService(authorization)) {
    if (b.action !== 'check') return no(403, 'not_approver')
    const r = await checkList(deps.updater, null)
    return { status: 200, body: { ok: r.ok, stale: r.stale, ...(r.ok ? { serial: r.index.serial } : { reason: r.reason }) } }
  }

  let approval: { user_id?: unknown; approver?: unknown; fresh?: unknown } | null = null
  try {
    const { data, error } = await deps.asUser('update_approval')
    if (!error && data && typeof data === 'object') approval = data as typeof approval
  } catch { /* answered below */ }
  if (!approval || typeof approval.user_id !== 'string') return no(401, 'sign_in')
  const by = approval.user_id

  if (b.action === 'check') {
    if (approval.approver !== true) return no(403, 'not_approver')
    const r = await checkList(deps.updater, by)
    return { status: 200, body: { ok: r.ok, stale: r.stale, ...(r.ok ? { serial: r.index.serial } : { reason: r.reason }) } }
  }

  const version = b.version as string
  if (approval.approver !== true || approval.fresh !== true) {
    const reason = approval.approver !== true ? 'not_approver' : 'not_fresh'
    // Recorded only where there is an instance to record it against.
    if (await instanceChannel(deps.updater.db)) {
      await recordInstall(deps.updater.db, await installedVersion(deps.updater.db), version, null, { by, mode: 'manual' }, 'refused', reason, null)
    }
    return no(403, reason)
  }
  const r = await install(deps.updater, version, { by, mode: 'manual' })
  return r.ok
    ? { status: 200, body: { ok: true, from: r.from, to: r.to, applied: r.applied, checks: r.checks } }
    : no(r.reason.includes(' ') ? 500 : 409, r.reason)
}
