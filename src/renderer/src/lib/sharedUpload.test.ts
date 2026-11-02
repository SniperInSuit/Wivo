import { describe, it, expect } from 'vitest'
import { sharedFileWarnings } from './sharedUpload'

describe('sharedFileWarnings', () => {
  it('PDFs, photos and X-rays each warn once, in a fixed order', () => {
    expect(sharedFileWarnings([
      { name: 'cbct.dcm', type: 'xray' },
      { name: 'IMG_0001.HEIC', type: 'photo' },
      { name: 'referral.pdf', type: 'other' },
      { name: 'smile.jpg', type: 'photo' },
    ])).toEqual(['pdf', 'photo', 'xray'])
  })

  it('an image typed as X-ray warns about burned-in names, not about faces', () => {
    expect(sharedFileWarnings([{ name: 'opg.png', type: 'xray' }])).toEqual(['xray'])
  })

  it('an image of any type may show a face; the MIME type counts too', () => {
    expect(sharedFileWarnings([{ name: 'shot.png', type: 'other' }])).toEqual(['photo'])
    expect(sharedFileWarnings([{ name: 'blob', type: 'other', mime: 'image/jpeg' }])).toEqual(['photo'])
    expect(sharedFileWarnings([{ name: 'scan', type: 'other', mime: 'application/pdf' }])).toEqual(['pdf'])
  })

  it('scans and design files need no warning', () => {
    expect(sharedFileWarnings([{ name: 'upper.stl', type: 'scan' }, { name: 'crown.3mf', type: 'design' }])).toEqual([])
  })
})
