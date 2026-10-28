/**
 * Per-user interface preferences: what they are, and how to read a stored blob
 * without destroying half of it.
 *
 * Pure. No React, no Supabase, no store — this file is where the data loss
 * would actually happen, so it is the file with the tests. The store around it
 * (stores/useUiPrefs.ts) only decides when to call these.
 *
 * ── The rule that shapes everything here ─────────────────────────────────────
 *
 * A desktop app updates one machine at a time. Somebody adds a panel on their
 * laptop running 1.62; the same account opens on the bench workstation still
 * running 1.58, which has never heard of that panel id. If the older build
 * dropped what it did not recognise, the next drag on the bench would delete
 * the laptop's panel permanently, and nothing would say so.
 *
 * So: RENDER THE INTERSECTION, STORE THE UNION. An unknown id is kept, kept in
 * roughly its place, and simply not drawn.
 *
 * This is the same trap `workTypeList()` fell into — a loader that rebuilt a
 * stored shape field by field silently deleted every field added later. The
 * lesson there was "spread, do not rebuild"; the lesson here is the same one
 * about list members instead of object keys.
 */

/** Bumped only for a shape change this file cannot read forwards. */
export const UI_PREFS_VERSION = 1

/**
 * A corrupted or hostile value must not be able to grow without bound. Well
 * above any real dashboard — the catalogue is ~40 panels.
 */
export const MAX_PANELS = 60

/**
 * Panel size in GRID CELLS, never pixels: [columns, rows] on a four-column
 * grid. Cells rather than pixels is what makes a layout survive a different
 * window width, a different text scale and a different screen — the same reason
 * a widget grid beats free-form dragging.
 */
export type PanelSize = readonly [number, number]

export const GRID_COLS = 4
export const MAX_PANEL_ROWS = 6

export const clampSize = (w: number, h: number): [number, number] => [
  Math.min(GRID_COLS, Math.max(1, Math.round(w) || 1)),
  Math.min(MAX_PANEL_ROWS, Math.max(1, Math.round(h) || 1)),
]

export interface DashboardPrefs {
  /**
   * Which preset this list came from, for the picker to say "CFO (muudetud)"
   * rather than pretending a hand-edited layout is still the preset. Never used
   * to re-derive the list.
   */
  preset: string | null
  /** Every id as stored, known or not. Order IS the layout. */
  panels: string[]
  /**
   * Per-panel size overrides, [cols, rows]. Absent = the catalogue's default
   * for that panel.
   *
   * A SEPARATE map rather than a field on each entry, so `panels` stays a plain
   * list of ids: the forward-compatibility rules — keep the unknown, keep its
   * place — are about order, and giving each entry a shape would mean an older
   * client had to preserve fields inside it too.
   */
  sizes?: Record<string, [number, number]>
  /**
   * Per-gauge bounds, keyed by panel id — the same shape as `sizes`, and for
   * the same reason: `panels` stays a plain list of ids, so an older client's
   * only job is to keep an unknown id in its place rather than to preserve
   * fields inside it.
   *
   * Absent for a gauge means the metric's own default range. That is a real
   * state, not a missing one: a dial is readable before anybody sets a target,
   * and the target is what the colour needs, not the arc.
   */
  gauges?: Record<string, GaugeBoundsPrefs>
}

/** Stored bounds for one gauge. Every field optional — see `gauges`. */
export interface GaugeBoundsPrefs {
  min?: number
  max?: number
  target?: number
}

export interface OdontogramPrefs {
  /**
   * Which chart to draw. Typed as a plain string, NOT a union, and this is
   * deliberate — see `normaliseOdontogram` below.
   */
  view?: string
  /**
   * Patient view vs dentist view. Moved off the machine-global
   * `wivo_odonto_mirror` localStorage key: which way round somebody reads an
   * arch is a property of the PERSON, and one of them works in another
   * building.
   */
  mirror?: boolean
}

export interface UiPrefs {
  v: number
  /**
   * ABSENT means "never customised" — the caller applies a role default and
   * does not write it back. An empty `panels` array is a different answer: "I
   * removed everything". Collapsing the two would resurrect deleted panels on
   * every load.
   */
  dashboard?: DashboardPrefs
  odontogram?: OdontogramPrefs
  /** Anything a newer version stored. Carried through untouched. */
  [key: string]: unknown
}

/**
 * Ids WE retired or renamed, on purpose. `null` = gone for good, drop it.
 *
 * A retired id and an id from the future are indistinguishable to a client, so
 * the only way to ever remove one is to say so here explicitly.
 */
export const RETIRED_PANEL_IDS: Record<string, string | null> = {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Dedupe keeping first occurrence, drop non-strings and blanks, cap the length. */
function cleanIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    // A rename is applied on read and written back on the next save.
    if (id in RETIRED_PANEL_IDS) {
      const to = RETIRED_PANEL_IDS[id]
      if (to === null || seen.has(to)) continue
      seen.add(to)
      out.push(to)
      continue
    }
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_PANELS) break
  }
  return out
}

/** Sizes are clamped to the grid, not trusted: a stored 99×99 must not exist. */
function cleanSizes(raw: unknown): Record<string, [number, number]> | undefined {
  if (!isObject(raw)) return undefined
  const out: Record<string, [number, number]> = {}
  let n = 0
  for (const [id, value] of Object.entries(raw)) {
    if (n >= MAX_PANELS) break
    if (!Array.isArray(value) || value.length < 2) continue
    const [w, h] = value
    if (typeof w !== 'number' || typeof h !== 'number') continue
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue
    out[id] = clampSize(w, h)
    n++
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Gauge bounds, keyed by panel id.
 *
 * A field that is not a finite number is DROPPED rather than defaulted: a
 * missing bound means "use the metric's default", and writing 0 in its place
 * would pin an arc to zero and look deliberate. NaN and Infinity are what a
 * half-typed number produces, so this is the normal path, not the hostile one.
 */
function cleanGauges(raw: unknown): Record<string, GaugeBoundsPrefs> | undefined {
  if (!isObject(raw)) return undefined
  const out: Record<string, GaugeBoundsPrefs> = {}
  let n = 0
  for (const [id, value] of Object.entries(raw)) {
    if (n >= MAX_PANELS) break
    if (!isObject(value)) continue
    const one: GaugeBoundsPrefs = {}
    for (const field of ['min', 'max', 'target'] as const) {
      const v = value[field]
      if (typeof v === 'number' && Number.isFinite(v)) one[field] = v
    }
    if (Object.keys(one).length === 0) continue
    out[id] = one
    n++
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Anything → a shape this app can work with, losing as little as possible.
 * Never throws: this reads a value that may have been written by a newer
 * version, a corrupted localStorage entry, or nothing at all.
 */
export function normaliseUiPrefs(raw: unknown): UiPrefs {
  if (!isObject(raw)) return { v: UI_PREFS_VERSION }

  // Spread first, so keys belonging to a newer version survive the round trip.
  const out: UiPrefs = { ...raw, v: typeof raw.v === 'number' ? raw.v : UI_PREFS_VERSION }

  // BEFORE the dashboard branch: that one returns early in three places, and
  // handling the odontogram after any of them would silently drop it.
  const od = normaliseOdontogram(raw.odontogram)
  if (od) out.odontogram = od
  else delete out.odontogram

  const d = raw.dashboard
  if (!isObject(d)) {
    // Not "never customised" if the key exists but is junk — but treating junk
    // as absent is the only recoverable answer, and it costs a layout that was
    // already unreadable.
    delete out.dashboard
    return out
  }

  const panels = cleanIds(d.panels)
  if (panels === null) {
    delete out.dashboard
    return out
  }

  const sizes = cleanSizes(d.sizes)
  const gauges = cleanGauges(d.gauges)
  out.dashboard = {
    ...d,
    preset: typeof d.preset === 'string' ? d.preset : null,
    panels,
    // Written only when there is something to write, so an untouched dashboard
    // does not carry an empty object around forever.
    ...(sizes ? { sizes } : {}),
    ...(gauges ? { gauges } : {}),
  }
  if (!sizes) delete (out.dashboard as { sizes?: unknown }).sizes
  if (!gauges) delete (out.dashboard as { gauges?: unknown }).gauges
  return out
}

/** The subset this build can actually draw, in stored order. */
export function knownPanels(stored: string[], known: ReadonlySet<string>): string[] {
  return stored.filter(id => known.has(id))
}

/**
 * Fold a reordered list of KNOWN ids back into the stored list, keeping every
 * unknown id roughly where its owner left it.
 *
 * Each unknown id remembers its anchor — the id immediately before it in the
 * stored list, or `null` for "first" — and is spliced back in after that anchor.
 * Appending them all to the end would be simpler and would quietly reshuffle a
 * layout every time it was opened on an older build.
 */
export function reorderPreserving(
  stored: string[],
  nextKnownOrder: string[],
  known: ReadonlySet<string>,
): string[] {
  const unknowns: { id: string; anchor: string | null }[] = []
  stored.forEach((id, i) => {
    if (!known.has(id)) unknowns.push({ id, anchor: i > 0 ? stored[i - 1] : null })
  })

  // Fast path: nothing to preserve.
  if (unknowns.length === 0) return [...nextKnownOrder]

  const out = [...nextKnownOrder]
  for (const { id, anchor } of unknowns) {
    if (out.includes(id)) continue
    const at = anchor === null ? -1 : out.indexOf(anchor)
    if (anchor === null) out.unshift(id)
    else if (at >= 0) out.splice(at + 1, 0, id)
    // The anchor was removed in this edit — the end is the only honest place
    // left, and the panel is still there rather than gone.
    else out.push(id)
  }
  return out.slice(0, MAX_PANELS)
}

/** Replace the dashboard slice, leaving every other key alone. */
export function withDashboard(prefs: UiPrefs, dashboard: DashboardPrefs): UiPrefs {
  return { ...prefs, v: UI_PREFS_VERSION, dashboard }
}

export function withOdontogram(prefs: UiPrefs, odontogram: OdontogramPrefs): UiPrefs {
  return { ...prefs, v: UI_PREFS_VERSION, odontogram }
}

/**
 * Keeps whatever is stored, including a `view` this build has never heard of.
 *
 * The subtlety the dashboard never had to face: `view` is an ENUM. Validating
 * it against the values this build knows and overwriting anything else would
 * DESTROY a future build's `view: 'webgpu'` on the next write — which is the
 * exact data-loss this file exists to prevent, one level down. An unknown
 * VALUE is not the same thing as an unknown KEY.
 *
 * So: store the union, and let the consumer narrow to the intersection.
 */
function normaliseOdontogram(d: unknown): OdontogramPrefs | undefined {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return undefined
  const { view, mirror, ...rest } = d as Record<string, unknown>
  return {
    // Unknown keys survive untouched — that is the whole rule of this file.
    ...rest,
    // `view` is an ENUM and a future build's value is plausible, so any string
    // round-trips. `mirror` is a boolean and always will be: a string there is
    // junk, not a value from the future, and keeping it would hand the caller
    // something it has to guard against twice.
    ...(typeof view === 'string' ? { view } : {}),
    ...(typeof mirror === 'boolean' ? { mirror } : {}),
  }
}
