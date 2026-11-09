/**
 * The desktop's own check of an app update before it installs
 * (docs/ARCHITECTURE-INSTANCES.md 5e). electron-updater's check (the sha512
 * in latest.yml) proves only that the file is the one the feed names; this
 * proves the release is Wivo's: a fresh signed list names it as the latest
 * desktop release, and a certified app key signed a statement of exactly
 * these bytes (shared/release checkAppUpdate).
 *
 * Until the root keys are pinned (the YubiKey setup, docs/YUBIKEYS.md) there
 * is nothing to check against, and updates install as before; the log says
 * so. From the first build with pinned roots, an update that isn't signed is
 * refused and the app stays on the version it has: an update never stops
 * anyone working (updater.ts).
 *
 * The highest list serial accepted is kept per signing key in userData, so a
 * desktop that has seen a newer list refuses an older one (TUF: rollback).
 */
import { createHash } from 'crypto'
import { createReadStream, readFileSync, statSync, writeFileSync } from 'fs'
import {
  PINNED_ROOTS, UPDATE_SOURCES, MAX_INDEX_BYTES, checkAppUpdate, limitedFetcher, listAddress, parsePublishedList,
  type Channel, type Fetcher, type RootKey, type SerialFloor,
} from '../../shared/release/release'

/** The desktop's channel. Every clinic's desktop is stable; test-channel desktops come with the test projects. */
const CHANNEL: Channel = 'stable'

export type AppCheck =
  | { ok: true; checked: boolean }
  | { ok: false; reason: string }

export interface ReleaseCheckDeps {
  pinned: RootKey[]
  sources: string[]
  fetch: Fetcher
  /** Where the serial floor is kept (userData/release-floor.json). */
  floorPath: string
  now: () => Date
  channel: Channel
}

export const releaseCheckDeps = (floorPath: string): ReleaseCheckDeps => ({
  pinned: PINNED_ROOTS, sources: UPDATE_SOURCES, fetch: limitedFetcher(fetch), floorPath, now: () => new Date(), channel: CHANNEL,
})

/** electron-updater's form of a file's hash: base64 of the raw sha512. */
export function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file).on('error', reject).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('base64')))
  })
}

function readFloor(path: string): SerialFloor {
  try {
    const v = JSON.parse(readFileSync(path, 'utf-8')) as SerialFloor
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Is this downloaded installer the release Wivo signed for `version`? */
export async function verifyDownloadedApp(file: string, version: string, deps: ReleaseCheckDeps): Promise<AppCheck> {
  if (deps.pinned.length === 0) return { ok: true, checked: false }
  let sha512: string
  let size: number
  try {
    size = statSync(file).size
    sha512 = await sha512Of(file)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const floor = readFloor(deps.floorPath)
  const reasons: string[] = []
  for (const source of deps.sources) {
    const bytes = await deps.fetch(listAddress(source, deps.channel), MAX_INDEX_BYTES * 2)
    const list = bytes && parsePublishedList(bytes)
    if (!list) { reasons.push(bytes ? 'malformed' : 'unreachable'); continue }
    const r = await checkAppUpdate({ list, version, sha512, size, pinned: deps.pinned, now: deps.now(), channel: deps.channel, floor })
    if (!r.ok) { reasons.push(r.reason); continue }
    try {
      writeFileSync(deps.floorPath, JSON.stringify({ ...floor, [r.key_id]: { serial: r.serial, sha256: r.signedSha256 } }))
    } catch {
      // The floor is a defence in depth; failing to write it must not refuse a good release.
    }
    return { ok: true, checked: true }
  }
  return { ok: false, reason: deps.sources.length === 0 ? 'no_source' : reasons.find(r => r !== 'unreachable') ?? 'unreachable' }
}
