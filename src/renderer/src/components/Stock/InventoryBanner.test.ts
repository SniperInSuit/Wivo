import { describe, it, expect } from 'vitest'
import { countIsDue } from './InventoryBanner'

describe('countIsDue: the red bar shows from the due date on', () => {
  const today = new Date('2026-11-02T15:30:00')
  it('due today or earlier: shown', () => {
    expect(countIsDue('2026-11-02', today)).toBe(true)
    expect(countIsDue('2026-09-30', today)).toBe(true)
  })
  it('due tomorrow, or no schedule: not shown', () => {
    expect(countIsDue('2026-11-03', today)).toBe(false)
    expect(countIsDue(null, today)).toBe(false)
    expect(countIsDue(undefined, today)).toBe(false)
  })
})
