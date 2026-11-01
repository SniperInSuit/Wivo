import { describe, it, expect } from 'vitest'
import { decideLanguage } from './index'

describe('decideLanguage', () => {
  it('the user\'s own setting wins over everything', () => {
    expect(decideLanguage({ profile: 'en', organisation: 'et', current: 'et', chosenOnThisMachine: true }))
      .toEqual({ lang: 'en', saveToProfile: false })
  })
  it('no setting, but chosen on this machine: kept, and saved to the profile', () => {
    expect(decideLanguage({ profile: null, organisation: 'et', current: 'en', chosenOnThisMachine: true }))
      .toEqual({ lang: 'en', saveToProfile: true })
  })
  it('nothing chosen anywhere: the organisation default', () => {
    expect(decideLanguage({ profile: null, organisation: 'en', current: 'et', chosenOnThisMachine: false }))
      .toEqual({ lang: 'en', saveToProfile: false })
  })
  it('no organisation default either: stay as is', () => {
    expect(decideLanguage({ profile: undefined, organisation: undefined, current: 'et', chosenOnThisMachine: false }))
      .toEqual({ lang: 'et', saveToProfile: false })
  })
})
