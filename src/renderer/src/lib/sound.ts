/**
 * Sounds: loaded once, played without delay (Web Audio). The decisions —
 * categories, quiet hours, the 1-second and 80-ms gaps, pitch — are in
 * soundCore.ts and tested there; this file only does the audio.
 *
 * Every file is fetched and DECODED at start-up, so `playSound` only starts a
 * buffer that is already in memory. Fetch works wherever the app is served
 * over http (development, the phone app); the installed desktop app runs from
 * `file://`, where Chromium refuses fetch, so there the main process reads the
 * bytes (same reason as the 3D model, src/main/index.ts).
 */
import { useSyncExternalStore } from 'react'
import {
  SOUNDS, DEFAULT_SOUND_SETTINGS, decideSound, recordSound, emptyGate, normaliseSoundSettings,
  type SoundName, type SoundSettings, type SoundCategory,
} from './soundCore'

export type { SoundName, SoundSettings } from './soundCore'

const SETTINGS_KEY = 'wivo_sound_v1'

let ctx: AudioContext | null = null
const buffers = new Map<SoundName, AudioBuffer>()
const gate = emptyGate()

// ── Settings: per device, localStorage only ─────────────────────────────────

function readSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? normaliseSoundSettings(JSON.parse(raw)) : DEFAULT_SOUND_SETTINGS
  } catch {
    return DEFAULT_SOUND_SETTINGS
  }
}

let settings: SoundSettings = typeof window === 'undefined' ? DEFAULT_SOUND_SETTINGS : readSettings()
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => settings

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function setSoundSettings(patch: Partial<SoundSettings>): void {
  settings = normaliseSoundSettings({ ...settings, ...patch })
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* the setting just does not persist */ }
  listeners.forEach(l => l())
}

// ── Loading ─────────────────────────────────────────────────────────────────

async function bytesOf(file: string): Promise<ArrayBuffer | null> {
  if (location.protocol === 'file:') {
    return (await window.wivo?.readSound?.(file).catch(() => null)) ?? null
  }
  try {
    // Relative: resolves against wherever the app is served (dev server, PWA).
    const res = await fetch(`sounds/${file}`)
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

/** Load and decode every sound. A missing or broken file is skipped silently. */
export async function initSounds(): Promise<void> {
  if (ctx || typeof window === 'undefined' || !('AudioContext' in window)) return
  ctx = new AudioContext()
  // Browsers start audio suspended until the person does something; resume on
  // the first interaction so the first notification is not lost.
  const resume = () => { void ctx?.resume() }
  window.addEventListener('pointerdown', resume, { once: true, capture: true })
  window.addEventListener('keydown', resume, { once: true, capture: true })
  await Promise.all((Object.keys(SOUNDS) as SoundName[]).map(async name => {
    const bytes = await bytesOf(SOUNDS[name].file)
    if (!bytes || !ctx) return
    try {
      buffers.set(name, await ctx.decodeAudioData(bytes))
    } catch { /* an undecodable file is the same as a missing one */ }
  }))
}

// ── Playing ─────────────────────────────────────────────────────────────────

function start(buffer: AudioBuffer, rate: number, gain: number): void {
  if (!ctx) return
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = rate
  const g = ctx.createGain()
  g.gain.value = gain
  source.connect(g).connect(ctx.destination)
  source.start()
}

/**
 * Play a sound, if the settings, quiet hours and the gap rules allow it.
 * Never throws, never waits: a sound is decoration on something visible.
 */
export function playSound(name: SoundName): void {
  const buffer = buffers.get(name)
  const nowMs = performance.now()
  const d = decideSound(name, { nowMs, now: new Date(), settings, gate, loaded: !!buffer })
  if (!d.play || !buffer) return
  recordSound(gate, name, nowMs)
  try { start(buffer, d.rate, d.gain) } catch { /* audio unavailable */ }
}

/** "Test" in Seaded: one sound of a category at the current volume, settings aside. */
export function previewSound(category: SoundCategory): void {
  const name: SoundName = category === 'notification' ? 'notify-message' : 'ui-check'
  const buffer = buffers.get(name)
  if (!buffer) return
  void ctx?.resume()
  start(buffer, 1, settings.volume * (category === 'interface' ? 0.398 : 1))
}

// ── Interface sounds for controls, in one place ────────────────────────────

/**
 * Checkboxes, switches, pressed-state buttons, tabs, sliders and number
 * steppers sound the same everywhere, so they are wired once here by event
 * delegation rather than in every component. Interface sounds are OFF by
 * default; with them off nothing here plays.
 */
export function installUiSounds(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('change', e => {
    const el = e.target as HTMLInputElement
    if (el?.tagName !== 'INPUT') return
    if (el.type === 'checkbox') {
      playSound(el.getAttribute('role') === 'switch' ? (el.checked ? 'ui-toggle-on' : 'ui-toggle-off') : 'ui-check')
    }
  }, true)
  document.addEventListener('input', e => {
    const el = e.target as HTMLInputElement
    if (el?.tagName === 'INPUT' && (el.type === 'range' || el.type === 'number')) playSound('ui-tick')
  }, true)
  document.addEventListener('click', e => {
    const el = (e.target as HTMLElement | null)?.closest?.('[role="switch"], [aria-pressed], [role="tab"]') as HTMLElement | null
    if (!el || el.tagName === 'INPUT') return
    if (el.getAttribute('role') === 'tab') { playSound('ui-tab'); return }
    // Read BEFORE React re-renders: the state the click is leaving.
    const was = el.getAttribute('role') === 'switch' ? el.getAttribute('aria-checked') : el.getAttribute('aria-pressed')
    playSound(was === 'true' ? 'ui-toggle-off' : 'ui-toggle-on')
  }, true)
}
