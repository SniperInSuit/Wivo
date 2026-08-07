/**
 * Tests for the quote engine.
 *
 * These exist because this file replaced two implementations that had silently
 * disagreed about money for several releases. Every case below is either a rule
 * someone relies on, or a bug that actually shipped.
 */
import { describe, expect, it } from 'vitest'
import type { PriceBook } from './priceBook'
import { quoteJob } from './quote'
import type { WorkType } from './workTypes'

const TYPES: WorkType[] = [
  { nimi: 'Implantkroon', hex: '#000', match: ['implantkroon', 'abutmendile'], hind: 500, hinnaTyyp: 'too' },
  { nimi: 'Kroon',        hex: '#000', hind: 400, soodushind: 300, hinnaTyyp: 'too' },
  { nimi: 'Sild',         hex: '#000', hind: 250, hinnaTyyp: 'hammas' },
  { nimi: 'Laminaat',     hex: '#000' },   // no price configured at all
]

const book = (over: Partial<PriceBook> = {}): PriceBook => ({
  workTypes: TYPES,
  materialPrices: {
    'OnX Tough 2': { small: 20, large: 30 },
    'Ceramic Crown': { small: 50, large: 70 },
  },
  hambaHind: 15,
  kiirtooKordaja: 2,
  designFee: 0,
  ...over,
})

describe('a work item is made of its OWN material', () => {
  // WorkItem.materjal existed long before anything priced it, so a case of
  // crowns in one material and bridges in another was quoted entirely at the
  // first material's rate.
  it('prices each item by the material it names', () => {
    const q = quoteJob({
      items: [
        { too: 'Laminaat', hambad: '11,12', materjal: 'Ceramic Crown' },
        { too: 'Laminaat', hambad: '16', materjal: 'OnX Tough 2' },
      ],
    }, book())
    // 11 and 12 are small (2 x 50), 16 is large (1 x 30).
    expect(q.production).toBe(130)
  })

  it('falls back to the job-level material for an item that names none', () => {
    const q = quoteJob({
      items: [
        { too: 'Laminaat', hambad: '11', materjal: 'Ceramic Crown' },
        { too: 'Laminaat', hambad: '12' },
      ],
      materjal: 'OnX Tough 2',
    }, book())
    expect(q.production).toBe(70)   // 50 + 20
  })

  it('does not let a material override a configured work-type price', () => {
    // The type price wins first, exactly as before — otherwise naming a
    // material on an All-on-X would quietly reprice the whole arch.
    const q = quoteJob({
      items: [{ too: 'Kroon', hambad: '11,12', materjal: 'Ceramic Crown' }],
    }, book())
    expect(q.production).toBe(400)
  })

  it('reports the item as unpriced when its own material has no price', () => {
    const q = quoteJob({
      items: [{ too: 'Laminaat', hambad: '11', materjal: 'Tundmatu vaik' }],
    }, book({ hambaHind: 0 }))
    expect(q.production).toBe(0)
    expect(q.unpriced).toHaveLength(1)
  })
})

describe('single item — the legacy shape must be quoted exactly as before', () => {
  it('uses the per-job work-type price and ignores the tooth count', () => {
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '11,12,13' }] }, book())
    expect(q.production).toBe(400)
    expect(q.unpriced).toEqual([])
  })

  it('multiplies a per-tooth work type by its teeth', () => {
    const q = quoteJob({ items: [{ too: 'Sild', hambad: '11,12,13' }] }, book())
    expect(q.production).toBe(750)
  })

  it('resolves free text through the matcher, not by exact name', () => {
    // "D14 abutmendile kroon" is Implantkroon via the `abutmendile` synonym,
    // and must not fall through to the cheaper plain Kroon.
    const q = quoteJob({ items: [{ too: 'D14 abutmendile kroon', hambad: '14' }] }, book())
    expect(q.production).toBe(500)
  })

  it('takes the discount price when asked', () => {
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '11' }], useDiscount: true }, book())
    expect(q.production).toBe(300)
  })

  it('falls back to the material price when the type has none', () => {
    // Laminaat has no price; 2 small + 1 large at 20/30.
    const q = quoteJob(
      { items: [{ too: 'Laminaat', hambad: '11,12,16' }], materjal: 'OnX Tough 2' },
      book()
    )
    expect(q.production).toBe(70)
  })

  it('falls back to €/tooth when neither type nor material is priced', () => {
    const q = quoteJob({ items: [{ too: 'Laminaat', hambad: '11,12' }] }, book())
    expect(q.production).toBe(30)
    expect(q.lines[0].source).toBe('hambad')
  })
})

describe('unpriceable work reports itself instead of quoting zero', () => {
  it('refuses when the €/tooth rate is 0 — this used to stamp a free job', () => {
    // The job form computed teeth * 0 = 0 and wrote it to the record. The
    // repricer refused. The repricer was right.
    const q = quoteJob(
      { items: [{ too: 'Laminaat', hambad: '11,12' }] },
      book({ hambaHind: 0 })
    )
    expect(q.production).toBe(0)
    expect(q.unpriced).toHaveLength(1)
    expect(q.unpriced[0]).toContain('hinda ei õnnestu arvutada')
  })

  it('refuses when there are no teeth and the type has no per-job price', () => {
    const q = quoteJob({ items: [{ too: 'Laminaat', hambad: '' }] }, book())
    expect(q.unpriced[0]).toContain('hambaid ei ole valitud')
  })

  it('still prices a per-job type with no teeth picked yet', () => {
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '' }] }, book())
    expect(q.production).toBe(400)
    expect(q.unpriced).toEqual([])
  })

  it('a per-tooth type with no teeth is unknown, not free', () => {
    const q = quoteJob({ items: [{ too: 'Sild', hambad: '' }] }, book({ hambaHind: 0 }))
    expect(q.unpriced).toHaveLength(1)
  })
})

describe('multiple work items — each is priced on its own', () => {
  it('sums the items instead of quoting the first type across all teeth', () => {
    // The shipped bug: this job was quoted as one Kroon (400 €) because both
    // copies read the denormalised `too`/`hambad`. It is 400 + 3×250 = 1150.
    const q = quoteJob({
      items: [
        { too: 'Kroon', hambad: '11' },
        { too: 'Sild',  hambad: '24,25,26' },
      ],
    }, book())
    expect(q.production).toBe(1150)
    expect(q.lines).toHaveLength(2)
  })

  it('charges a per-job type once per item, because each item is a piece', () => {
    const q = quoteJob({
      items: [
        { too: 'Kroon', hambad: '11' },
        { too: 'Kroon', hambad: '21' },
      ],
    }, book())
    expect(q.production).toBe(800)
  })

  it('keeps what it could price and names only the part it could not', () => {
    const q = quoteJob({
      items: [
        { too: 'Kroon',    hambad: '11' },
        { too: 'Laminaat', hambad: '24' },
      ],
    }, book({ hambaHind: 0 }))
    expect(q.production).toBe(400)
    expect(q.unpriced).toHaveLength(1)
    expect(q.unpriced[0]).toContain('Laminaat')
  })
})

describe('rush, design and extras sit on top of production', () => {
  it('multiplies production by the rush factor', () => {
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '11' }], kiirtoo: true }, book())
    expect(q.production).toBe(800)
    expect(q.lines.some(l => l.source === 'kiirtöö')).toBe(true)
  })

  it('does NOT multiply the design fee or the extras by the rush factor', () => {
    const q = quoteJob({
      items: [{ too: 'Kroon', hambad: '11' }],
      kiirtoo: true,
      disainHind: 50,
      extras: [{ nimi: 'Wax-up', hind: 30 }],
    }, book())
    expect(q.production).toBe(800)   // 400 × 2
    expect(q.disain).toBe(50)        // not 100
    expect(q.lisateenused).toBe(30)  // not 60
    expect(q.total).toBe(880)
  })

  it('rush on an unpriceable job does not invent an uplift', () => {
    const q = quoteJob(
      { items: [{ too: 'Laminaat', hambad: '11' }], kiirtoo: true },
      book({ hambaHind: 0 })
    )
    expect(q.production).toBe(0)
    expect(q.lines.some(l => l.source === 'kiirtöö')).toBe(false)
  })

  it('totals extras into what the customer owes', () => {
    // The bug this closes: extras were shown on the job panel and reached no
    // total anywhere — jobTotalValue summed only hind + disain_hind.
    const q = quoteJob({
      items: [{ too: 'Kroon', hambad: '11' }],
      extras: [{ nimi: 'Ülesehitus', hind: 40 }, { nimi: 'Ajutine kroon', hind: 60 }],
    }, book())
    expect(q.lisateenused).toBe(100)
    expect(q.total).toBe(500)
  })
})

describe('rounding', () => {
  it('keeps cents honest across a per-tooth multiply', () => {
    const types: WorkType[] = [{ nimi: 'Sild', hex: '#000', hind: 33.33, hinnaTyyp: 'hammas' }]
    const q = quoteJob({ items: [{ too: 'Sild', hambad: '11,12,13' }] }, book({ workTypes: types }))
    expect(q.production).toBe(99.99)
  })
})
