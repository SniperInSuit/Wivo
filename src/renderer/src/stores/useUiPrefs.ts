/**
 * Per-user interface preferences — the store.
 *
 * Shaped exactly like `useSettings` and `PipelineContext`: a module-level
 * snapshot with listeners, read through `useSyncExternalStore`, cached in
 * localStorage, pushed to the database by an injected function that is
 * registered after login and absent before it. That shape is what lets the
 * first paint be right, the app work offline, and the sync layer hydrate a
 * store it cannot reach into.
 *
 * ── Why the cache key carries the user id ────────────────────────────────────
 *
 * `wivo_settings_v2` is machine-global, and that is fine for a theme. A
 * dashboard is not: two people sharing a bench workstation would each get a
 * flash of the other's layout before sync landed, and an offline session would
 * show the wrong one from start to finish.
 *
 * The row in `profiles.ui_prefs` is the truth. This is a cache.
 */
import { useSyncExternalStore } from 'react'
import {
  normaliseUiPrefs, withDashboard, reorderPreserving, clampSize,
  type UiPrefs, type DashboardPrefs,
} from '../lib/uiPrefs'

const cacheKey = (userId: string): string => `wivo_ui_prefs_v1:${userId}`

const EMPTY: UiPrefs = { v: 1 }

let currentUser: string | null = null
let snapshot: UiPrefs = EMPTY
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot(): UiPrefs {
  return snapshot
}

export function getUiPrefsSnapshot(): UiPrefs {
  return snapshot
}

type PrefsPusher = (prefs: UiPrefs) => void
let pusher: PrefsPusher | null = null

/** Registered by UiPrefsSync; absent before login and offline. */
export function setUiPrefsPusher(fn: PrefsPusher | null): void {
  pusher = fn
}

/**
 * Point the store at a person. Called on login and on logout (`null`), and it
 * swaps the cache namespace as well as the snapshot — leaving one person's
 * layout in memory while another is signed in is the whole bug this prevents.
 */
export function setUiPrefsUser(userId: string | null): void {
  if (userId === currentUser) return
  currentUser = userId
  snapshot = userId ? readCache(userId) : EMPTY
  notify()
}

function readCache(userId: string): UiPrefs {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    return raw ? normaliseUiPrefs(JSON.parse(raw)) : EMPTY
  } catch {
    return EMPTY
  }
}

function writeCache(next: UiPrefs): void {
  if (!currentUser) return
  try {
    localStorage.setItem(cacheKey(currentUser), JSON.stringify(next))
  } catch {
    // A full or disabled localStorage costs the offline cache, not the feature.
  }
}

/** DB → local. Never pushes back, or two clients would ping-pong forever. */
export function applyRemotePrefs(raw: unknown): void {
  const next = normaliseUiPrefs(raw)
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return
  snapshot = next
  writeCache(next)
  notify()
}

function commit(next: UiPrefs): void {
  snapshot = next
  writeCache(next)
  notify()
  pusher?.(next)
}

/**
 * The stored dashboard, or null when this person has never customised one.
 *
 * Null is not an empty list. An empty list means "I removed everything" and
 * must be honoured; null means "apply the role default" — and that default is
 * deliberately NOT written back, so two machines cannot race to seed different
 * defaults for the same account.
 */
export function useDashboardPrefs(): DashboardPrefs | null {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return prefs.dashboard ?? null
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Replace the visible list. `preset` records where it came from, nothing more. */
export function setDashboardPanels(panels: string[], preset: string | null): void {
  // Sizes survive a preset change on purpose: a panel you had made full width
  // should still be full width when it comes back in another view.
  commit(withDashboard(snapshot, { preset, panels, sizes: snapshot.dashboard?.sizes }))
}

/**
 * Apply a reordered list of the ids this build knows about, folding it back
 * into the stored list so ids from a newer version keep their place.
 */
export function reorderDashboard(nextKnownOrder: string[], known: ReadonlySet<string>): void {
  const stored = snapshot.dashboard?.panels ?? []
  const merged = reorderPreserving(stored, nextKnownOrder, known)
  commit(withDashboard(snapshot, {
    preset: snapshot.dashboard?.preset ?? null,
    panels: merged,
    sizes: snapshot.dashboard?.sizes,
  }))
}

/** Hand-editing the list means it is no longer the preset it came from. */
export function addPanel(id: string, after?: string): void {
  const stored = snapshot.dashboard?.panels ?? []
  if (stored.includes(id)) return
  const at = after ? stored.indexOf(after) : -1
  const panels = at >= 0
    ? [...stored.slice(0, at + 1), id, ...stored.slice(at + 1)]
    : [...stored, id]
  commit(withDashboard(snapshot, { preset: null, panels, sizes: snapshot.dashboard?.sizes }))
}

export function removePanel(id: string): void {
  const stored = snapshot.dashboard?.panels ?? []
  if (!stored.includes(id)) return
  // The size is kept, not deleted: adding the panel back should not silently
  // reset a width its owner chose.
  commit(withDashboard(snapshot, {
    preset: null, panels: stored.filter(p => p !== id), sizes: snapshot.dashboard?.sizes,
  }))
}

/**
 * Resize one panel, in grid cells.
 *
 * Resizing is NOT a hand edit in the "this is no longer the preset" sense — the
 * preset decides which panels you see, not how big they are, so the label
 * stays. Moving or removing one is a different question and does clear it.
 */
export function setPanelSize(id: string, w: number, h: number): void {
  const d = snapshot.dashboard
  const panels = d?.panels ?? []
  const sizes = { ...(d?.sizes ?? {}), [id]: clampSize(w, h) }
  commit(withDashboard(snapshot, { preset: d?.preset ?? null, panels, sizes }))
}

/** Back to "never customised" — the role default applies again. */
export function resetDashboard(): void {
  const next: UiPrefs = { ...snapshot }
  delete next.dashboard
  commit(next)
}
