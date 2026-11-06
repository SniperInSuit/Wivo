/**
 * shared/release/release.ts for plain Node, which (v20) can't run
 * TypeScript: esbuild, already here through Vite, strips the types. The file
 * has no imports, so it loads as one module. The tests import the .ts itself,
 * and check that this gives the same thing.
 */
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

export async function loadRelease() {
  const source = readFileSync(new URL('../../shared/release/release.ts', import.meta.url), 'utf8')
  const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'node20' })
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
