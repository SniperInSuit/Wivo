import { describe, it, expect, vi } from 'vitest'
import {
  decideRequiredRestart, decidePhoneReload, canPostpone, POSTPONE_MS, PHONE_RELOAD_GAP_MS, type DesktopInput, type PhoneInput,
} from './updatePolicy'
import { versionBelow, versionParts, versionWatchingFetch, onUpdateRequired, isUpdateRequired, appHeaders } from './appVersion'

describe('versions (as sql/104)', () => {
  it('compare as numbers, three parts', () => {
    expect(versionParts('2.1')).toEqual([2, 1, 0])
    expect(versionBelow('2.0.9', '2.0.10')).toBe(true)
    expect(versionBelow('2.0.10', '2.0.9')).toBe(false)
    expect(versionBelow('2.1', '2.1.0')).toBe(false)
    expect(versionBelow('', '2.1.0')).toBe(true)
    expect(versionBelow(null, '2.1.0')).toBe(true)
    expect(versionBelow('2.0.3', null)).toBe(false)
  })
})

describe('the version on every request, and the database\'s 426', () => {
  it('sends the version and the kind of app', () => {
    expect(Object.keys(appHeaders()).sort()).toEqual(['x-wivo-client', 'x-wivo-version'])
  })

  it('a 426 on the way back tells whoever listens; other answers do not', async () => {
    const heard = vi.fn()
    const off = onUpdateRequired(heard)
    const fake = (status: number) => versionWatchingFetch((async () => new Response('{}', { status })) as typeof fetch)
    await fake(200)('https://x')
    await fake(403)('https://x')
    expect(heard).not.toHaveBeenCalled()
    await fake(426)('https://x')
    expect(heard).toHaveBeenCalledTimes(1)
    off()
  })

  it('knows the database\'s refusal by its hint, code or status', () => {
    expect(isUpdateRequired({ hint: 'update_required' })).toBe(true)
    expect(isUpdateRequired({ code: 'PT426' })).toBe(true)
    expect(isUpdateRequired({ status: 426 })).toBe(true)
    expect(isUpdateRequired({ code: '42501' })).toBe(false)
    expect(isUpdateRequired(null)).toBe(false)
  })
})

describe('desktop: a required update', () => {
  const base: DesktopInput = {
    running: '2.0.3', minimum: { min_version: '2.1.0', required: true }, downloaded: true, blocked: false, postponedUntil: 0, now: 1_000,
  }

  it('nothing to do when no minimum, it is not required, or this build is new enough', () => {
    expect(decideRequiredRestart({ ...base, minimum: null })).toBe('none')
    expect(decideRequiredRestart({ ...base, minimum: { min_version: '2.1.0', required: false } })).toBe('none')
    expect(decideRequiredRestart({ ...base, running: '2.1.0' })).toBe('none')
  })

  it('not downloaded yet: fetch it', () => {
    expect(decideRequiredRestart({ ...base, downloaded: false })).toBe('fetch')
  })

  it('never while a form, an upload, a download or a print is open', () => {
    expect(decideRequiredRestart({ ...base, blocked: true })).toBe('wait')
  })

  it('postponed: waits until the time is up, then counts down again', () => {
    expect(decideRequiredRestart({ ...base, postponedUntil: base.now + POSTPONE_MS })).toBe('wait')
    expect(decideRequiredRestart({ ...base, postponedUntil: base.now - 1 })).toBe('countdown')
  })

  it('ready and nothing open: the countdown', () => {
    expect(decideRequiredRestart(base)).toBe('countdown')
  })

  it('three postponements at most', () => {
    expect([0, 1, 2, 3].map(canPostpone)).toEqual([true, true, true, false])
  })
})

describe('phone: reload to the new version', () => {
  const base: PhoneInput = { running: '2.0.3', minimum: '2.1.0', refused: false, blocked: false, lastReloadAt: null, now: 10 * PHONE_RELOAD_GAP_MS }

  it('new enough, or no minimum: nothing', () => {
    expect(decidePhoneReload({ ...base, running: '2.1.0' })).toBe('ok')
    expect(decidePhoneReload({ ...base, minimum: null })).toBe('ok')
  })

  it('too old: reload; a refused save counts as too old', () => {
    expect(decidePhoneReload(base)).toBe('reload')
    expect(decidePhoneReload({ ...base, minimum: null, refused: true })).toBe('reload')
  })

  it('waits while the camera is open or something is typed', () => {
    expect(decidePhoneReload({ ...base, blocked: true })).toBe('wait')
  })

  it('no reload loop: just reloaded and still too old → a notice with a button', () => {
    expect(decidePhoneReload({ ...base, lastReloadAt: base.now - 60_000 })).toBe('notice')
    expect(decidePhoneReload({ ...base, lastReloadAt: base.now - PHONE_RELOAD_GAP_MS - 1 })).toBe('reload')
  })
})
