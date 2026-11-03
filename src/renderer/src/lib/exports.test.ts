import { describe, it, expect } from 'vitest'
import { jobColumns } from './exports'

describe('the jobs CSV', () => {
  const headers = (money?: boolean) => jobColumns(k => k, () => '', () => '', money).map(c => c.header)

  it('has the price and payment columns for someone with payments.read', () => {
    expect(headers()).toEqual(expect.arrayContaining(['Hind', 'Disaini hind', 'Lisateenused', 'Kokku', 'Makstud']))
  })

  it('leaves them out otherwise (sql/102), and keeps everything else', () => {
    const without = headers(false)
    for (const h of ['Hind', 'Disaini hind', 'Lisateenused', 'Kokku', 'Makstud']) expect(without).not.toContain(h)
    expect(without.length).toBe(headers().length - 5)
    expect(without).toContain('Patsient')
  })
})
