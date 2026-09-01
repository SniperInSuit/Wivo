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
  mudeliHind: 0,
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

describe('mudel', () => {
  // The flag next to Kiirtöö, not a work type. `mudeliHind` sat in Seaded and on
  // the button's own label for as long as the flag existed and NOTHING read it:
  // the only way to bill a model was to add a "Mudel" work type, which is a
  // second place to say the same thing and prices it as if it were teeth.
  it('adds the model fee when the job carries one', () => {
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11' }], mudel: true },
      book({ mudeliHind: 25 })
    )
    expect(q.production).toBe(425)
    expect(q.lines.some(l => l.source === 'mudel' && l.amount === 25)).toBe(true)
  })

  it('adds nothing when the job has no model', () => {
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '11' }] }, book({ mudeliHind: 25 }))
    expect(q.production).toBe(400)
    expect(q.lines.some(l => l.source === 'mudel')).toBe(false)
  })

  it('adds nothing when no model price is configured', () => {
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11' }], mudel: true },
      book({ mudeliHind: 0 })
    )
    expect(q.production).toBe(400)
  })

  it('is NOT multiplied by the rush, exactly like the design fee', () => {
    // Printing one takes what it takes however urgent the case is.
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11' }], mudel: true, kiirtoo: true },
      book({ mudeliHind: 25 })
    )
    expect(q.production).toBe(825)   // 400 × 2 + 25, not (400 + 25) × 2
  })

  it('prices a model-only job from the fee alone', () => {
    const q = quoteJob({ items: [], mudel: true }, book({ mudeliHind: 25 }))
    expect(q.production).toBe(25)
  })
})

describe('hinnaastmed — mahupõhine ühikuhind', () => {
  // "Kui tuleb mitu krooni, siis on hambahind teine." Flat, not progressive:
  // six crowns at the 6+ rate means ALL six at that rate. A progressive split
  // would make the form's number impossible to check against what the dentist
  // was told on the phone.
  const TIERED: WorkType[] = [{
    nimi: 'Kroon', hex: '#000', hind: 400, hinnaTyyp: 'hammas',
    astmed: [
      { alates: 3, hind: 370 },
      { alates: 6, hind: 340 },
    ],
  }]

  it('uses the base price below the first tier', () => {
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '11,12' }] }, book({ workTypes: TIERED }))
    expect(q.production).toBe(800)   // 2 × 400
  })

  it('switches the WHOLE job onto the tier, not just the teeth above it', () => {
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13' }] },
      book({ workTypes: TIERED })
    )
    expect(q.production).toBe(1110)  // 3 × 370, not 2×400 + 1×370
  })

  it('takes the highest tier at or below the count', () => {
    const six = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13,14,15,16' }] },
      book({ workTypes: TIERED })
    )
    expect(six.production).toBe(2040)  // 6 × 340

    const five = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13,14,15' }] },
      book({ workTypes: TIERED })
    )
    expect(five.production).toBe(1850) // 5 × 370
  })

  it('does not care what order the tiers were written in', () => {
    const scrambled: WorkType[] = [{
      ...TIERED[0],
      astmed: [{ alates: 6, hind: 340 }, { alates: 3, hind: 370 }],
    }]
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13,14,15,16' }] },
      book({ workTypes: scrambled })
    )
    expect(q.production).toBe(2040)
  })

  it('prices each work item on ITS OWN count', () => {
    // Two separate items of the same type are two pieces of work. Pooling their
    // teeth would hand a volume discount to a case that never had the volume.
    const q = quoteJob({
      items: [
        { too: 'Kroon', hambad: '11,12' },       // 2 → base
        { too: 'Kroon', hambad: '21,22,23,24' }, // 4 → tier
      ],
    }, book({ workTypes: TIERED }))
    expect(q.production).toBe(800 + 1480)
  })

  it('falls back to the type discount when a tier has none', () => {
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13' }], useDiscount: true },
      book({ workTypes: [{ ...TIERED[0], soodushind: 300 }] })
    )
    expect(q.production).toBe(900)   // 3 × 300, the discount is not lost at volume
  })

  it('prefers a tier’s own discount over the type’s', () => {
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13' }], useDiscount: true },
      book({ workTypes: [{
        ...TIERED[0], soodushind: 300,
        astmed: [{ alates: 3, hind: 370, soodushind: 280 }],
      }] })
    )
    expect(q.production).toBe(840)   // 3 × 280
  })

  it('ignores a broken tier instead of pricing from it', () => {
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13' }] },
      book({ workTypes: [{ ...TIERED[0], astmed: [{ alates: 3, hind: 0 }] }] })
    )
    expect(q.production).toBe(1200)  // back to 3 × 400
  })

  it('leaves a type with no tiers exactly as it was', () => {
    const untiered: WorkType[] = [{ ...TIERED[0], astmed: undefined }]
    const q = quoteJob(
      { items: [{ too: 'Kroon', hambad: '11,12,13,14,15,16' }] },
      book({ workTypes: untiered })
    )
    expect(q.production).toBe(2400)  // 6 × the base 400, no volume anything
  })

  it('tiers a per-JOB price too, by the tooth count', () => {
    const q = quoteJob({ items: [{ too: 'Proteez', hambad: '11,12,13' }] }, book({
      workTypes: [{
        nimi: 'Proteez', hex: '#000', hind: 900, hinnaTyyp: 'too',
        astmed: [{ alates: 3, hind: 1200 }],
      }],
    }))
    expect(q.production).toBe(1200)  // one flat price, chosen by size
  })
})
