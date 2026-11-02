/**
 * The sound system's decisions, with no audio in them so they can be tested
 * (soundCore.test.ts). lib/sound.ts does the playing.
 *
 * A SOUND NEVER CARRIES INFORMATION ON ITS OWN. Every sound accompanies
 * something visible — a badge, a notification, a message in a thread, a
 * progress bar, a control changing state. Interface sounds are off by default,
 * and anything can be silenced per device or by quiet hours.
 */

export type SoundCategory = 'notification' | 'interface'

/**
 * Every sound Wivo knows, and its file under `public/sounds/` — the folder
 * Vite serves at `/sounds/`, so the phone app (Phase 1b, same code base) can
 * serve the same files. A file that is not there is skipped without a word:
 * `ui-tab` and `ui-tick` have no recording yet.
 */
export const SOUNDS = {
  'notify-message':           { file: 'notify-message.wav', category: 'notification' },
  'notify-mention':           { file: 'notify-mention.wav', category: 'notification' },
  'message-sent':             { file: 'message-sent.wav', category: 'notification' },
  'notify-upload-done':       { file: 'notify-upload-done.wav', category: 'notification' },
  'notify-error':             { file: 'notify-error.wav', category: 'notification' },
  'notify-new-work':          { file: 'notify-new-work.wav', category: 'notification' },
  'notify-handoff':           { file: 'notify-handoff.wav', category: 'notification' },
  // Registered for events that do not exist yet — see wivo-2.0-spec.md, "Sounds".
  'notify-stock-warning':     { file: 'notify-stock-warning.wav', category: 'notification' },
  'notify-booking-confirmed': { file: 'notify-booking-confirmed.wav', category: 'notification' },
  'ui-toggle-on':             { file: 'ui-toggle-on.wav', category: 'interface' },
  'ui-toggle-off':            { file: 'ui-toggle-off.wav', category: 'interface' },
  'ui-check':                 { file: 'ui-check.wav', category: 'interface' },
  'ui-tab':                   { file: 'ui-tab.wav', category: 'interface' },
  'ui-pickup':                { file: 'ui-pickup.wav', category: 'interface' },
  'ui-drop':                  { file: 'ui-drop.wav', category: 'interface' },
  'ui-move':                  { file: 'ui-move.wav', category: 'interface' },
  'ui-tick':                  { file: 'ui-tick.wav', category: 'interface' },
} as const satisfies Record<string, { file: string; category: SoundCategory }>

export type SoundName = keyof typeof SOUNDS

/** Per device, in localStorage — never in the database. */
export interface SoundSettings {
  enabled: boolean
  /** 0…1 */
  volume: number
  notifications: boolean
  interface: boolean
  /** 'HH:MM' or null. Quiet when both are set; may cross midnight (22:00–07:00). */
  quietFrom: string | null
  quietTo: string | null
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.7,
  notifications: true,
  interface: false,
  quietFrom: null,
  quietTo: null,
}

/** Interface sounds sit about 8 dB under notifications: 10^(−8/20). */
export const INTERFACE_GAIN = 0.398
/** ±3 % pitch on every interface sound, so repeats do not sound mechanical. */
export const PITCH_SPREAD = 0.03
/** The same interface sound at most once per 80 ms (dragging, sliding). */
export const INTERFACE_MIN_GAP_MS = 80
/** A notification never plays over another: one per second at most. */
export const NOTIFICATION_MIN_GAP_MS = 1000

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Anything → valid settings, losing as little as possible. */
export function normaliseSoundSettings(raw: unknown): SoundSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const time = (v: unknown) => (typeof v === 'string' && HHMM.test(v) ? v : null)
  const vol = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : DEFAULT_SOUND_SETTINGS.volume
  return {
    enabled: bool(r.enabled, DEFAULT_SOUND_SETTINGS.enabled),
    volume: vol,
    notifications: bool(r.notifications, DEFAULT_SOUND_SETTINGS.notifications),
    interface: bool(r.interface, DEFAULT_SOUND_SETTINGS.interface),
    quietFrom: time(r.quietFrom),
    quietTo: time(r.quietTo),
  }
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Is `now` inside quiet hours? From inclusive, to exclusive; crossing midnight allowed. */
export function inQuietHours(now: Date, from: string | null, to: string | null): boolean {
  if (!from || !to || from === to) return false
  const m = now.getHours() * 60 + now.getMinutes()
  const f = minutes(from)
  const t = minutes(to)
  return f < t ? m >= f && m < t : m >= f || m < t
}

/** What the last plays were, for the gap rules. */
export interface SoundGate {
  lastNotificationAt: number
  lastByName: Partial<Record<SoundName, number>>
}

export const emptyGate = (): SoundGate => ({ lastNotificationAt: -Infinity, lastByName: {} })

export type SoundDecision =
  | { play: true; rate: number; gain: number }
  | { play: false; reason: 'missing' | 'off' | 'category-off' | 'quiet-hours' | 'overlap' | 'throttled' }

/**
 * Should `name` play now, and how? Pure: the clock, the gate and the random
 * source are passed in. The caller records the play in the gate.
 */
export function decideSound(
  name: SoundName,
  ctx: { nowMs: number; now: Date; settings: SoundSettings; gate: SoundGate; loaded: boolean; random?: () => number },
): SoundDecision {
  const { category } = SOUNDS[name]
  const s = ctx.settings
  if (!ctx.loaded) return { play: false, reason: 'missing' }
  if (!s.enabled || s.volume <= 0) return { play: false, reason: 'off' }
  if (category === 'notification' ? !s.notifications : !s.interface) return { play: false, reason: 'category-off' }
  if (inQuietHours(ctx.now, s.quietFrom, s.quietTo)) return { play: false, reason: 'quiet-hours' }
  if (category === 'notification') {
    if (ctx.nowMs - ctx.gate.lastNotificationAt < NOTIFICATION_MIN_GAP_MS) return { play: false, reason: 'overlap' }
    return { play: true, rate: 1, gain: s.volume }
  }
  const last = ctx.gate.lastByName[name] ?? -Infinity
  if (ctx.nowMs - last < INTERFACE_MIN_GAP_MS) return { play: false, reason: 'throttled' }
  const r = (ctx.random ?? Math.random)()
  return { play: true, rate: 1 + (r * 2 - 1) * PITCH_SPREAD, gain: s.volume * INTERFACE_GAIN }
}

/** Record a play in the gate. */
export function recordSound(gate: SoundGate, name: SoundName, nowMs: number): void {
  if (SOUNDS[name].category === 'notification') gate.lastNotificationAt = nowMs
  gate.lastByName[name] = nowMs
}
