import { describe, it, expect } from 'vitest'
import { parseInline } from './richText'

describe('parseInline', () => {
  it('plain text stays one piece', () => {
    expect(parseInline('Nothing special.')).toEqual([{ text: 'Nothing special.' }])
  })

  it('bold and links between plain text', () => {
    expect(parseInline('Open **Settings**, then [the site](https://app.wivodent.com).')).toEqual([
      { text: 'Open ' },
      { text: 'Settings', bold: true },
      { text: ', then ' },
      { text: 'the site', href: 'https://app.wivodent.com' },
      { text: '.' },
    ])
  })

  it('a link that is not http(s) keeps its text and loses the target', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ text: 'click' }, { text: ')' }])
    expect(parseInline('[mail](mailto:a@b.c)')).toEqual([{ text: 'mail' }])
  })

  it('an unclosed marker is just text', () => {
    expect(parseInline('2 ** 3 and [x')).toEqual([{ text: '2 ** 3 and [x' }])
  })
})
