/**
 * Which locale Chromium is started in.
 *
 * Worth a test because the failure is invisible to every other guard here:
 * `noHardcodedText` reads the app's own strings and these controls are drawn
 * by the browser, so an Estonian calendar can open over a fully English screen
 * and nothing in the suite notices.
 */
import { describe, it, expect } from 'vitest'
import { chromiumLocaleFor } from './uiLanguage'

describe('chromiumLocaleFor', () => {
  it('matches each interface language', () => {
    expect(chromiumLocaleFor('et')).toBe('et-EE')
    expect(chromiumLocaleFor('ru')).toBe('ru-RU')
    expect(chromiumLocaleFor('en')).toBe('en-GB')
  })

  it('falls back to English, not to Estonian', () => {
    // The old code pinned 'et-EE' unconditionally. On a machine that has never
    // reported a language — a fresh install, or the first launch after this
    // change — the fallback is what a demo actually gets.
    expect(chromiumLocaleFor(null)).toBe('en-GB')
    expect(chromiumLocaleFor(undefined)).toBe('en-GB')
    expect(chromiumLocaleFor('')).toBe('en-GB')
    expect(chromiumLocaleFor('kl')).toBe('en-GB')
  })

  it('keeps the 24-hour clock the switch existed for', () => {
    // en-US would give a 12-hour clock in `time` and `datetime-local`, which
    // is the one thing the original 'et-EE' was there to prevent.
    for (const lang of ['en', 'et', 'ru', null]) {
      expect(chromiumLocaleFor(lang)).not.toBe('en-US')
    }
  })
})
