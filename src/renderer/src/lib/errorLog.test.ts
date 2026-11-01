import { describe, it, expect } from 'vitest'
import { scrubPersonalData } from './errorLog'

describe('scrubPersonalData', () => {
  it('removes e-mail addresses, personal codes and phone numbers', () => {
    const out = scrubPersonalData('Failed for mari.maasikas@example.com, 48001010000, +372 5555 5555, 010180-12345')
    expect(out).not.toMatch(/maasikas|48001010000|5555|010180/)
    expect(out).toContain('[email]')
    expect(out).toContain('[personal-code]')
  })

  it('leaves ordinary error text and code locations alone', () => {
    const s = "TypeError: Cannot read properties of undefined (reading 'id') at JobCard (JobCard.tsx:42:7)"
    expect(scrubPersonalData(s)).toBe(s)
  })
})
