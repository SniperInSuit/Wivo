/** The generated copies under _shared/generated/ match their source in shared/. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COPIES, header } from '../../../scripts/copy-shared-to-functions.mjs'

const root = join(__dirname, '..', '..', '..')

describe('generated copies', () => {
  for (const [from, to] of COPIES as [string, string][]) {
    it(`${to} is ${from} — if not: node scripts/copy-shared-to-functions.mjs`, () => {
      expect(readFileSync(join(root, to), 'utf8')).toBe(header(from) + readFileSync(join(root, from), 'utf8'))
    })
  }
})
