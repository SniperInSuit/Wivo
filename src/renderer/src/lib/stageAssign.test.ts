import { describe, expect, it } from 'vitest'
import { initials, visiblePeople, withPerson } from './stageAssign'

describe('stage people helpers', () => {
  it('initials: first and last name, or the first two letters of one name', () => {
    expect(initials('Anna Maria Tamm')).toBe('AT')
    expect(initials('kristjan')).toBe('KR')
    expect(initials('  ')).toBe('?')
    expect(initials(null)).toBe('?')
    expect(initials('Õie Šmidt')).toBe('ÕŠ')
  })
  it('adds and removes a person without duplicates', () => {
    expect(withPerson(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(withPerson(['a', 'b'], 'a', true)).toEqual(['b', 'a'])
    expect(withPerson(['a', 'b'], 'a', false)).toEqual(['b'])
  })
  it('shows two circles and a count for the rest', () => {
    expect(visiblePeople(['a', 'b'])).toEqual({ shown: ['a', 'b'], more: 0 })
    expect(visiblePeople(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b'], more: 2 })
  })
})
