// Copies the shared/ files the Edge Functions use into supabase/functions/_shared/generated/,
// because a deploy may not bundle imports from outside supabase/ (supabase/functions/README.md).
// supabase/functions/_shared/generatedCopy.test.ts fails while a copy is out of date.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const COPIES = [['shared/auth/loginAddress.ts', 'supabase/functions/_shared/generated/loginAddress.ts']]

export const header = (source) => [
  `// GENERATED — DO NOT EDIT. A copy of ${source} for the Edge Functions`,
  '// (supabase/functions/README.md: a deploy may not bundle imports from outside supabase/).',
  '// Regenerate:  node scripts/copy-shared-to-functions.mjs   (generatedCopy.test.ts checks it).',
  '',
].join('\n') + '\n'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [from, to] of COPIES) {
    writeFileSync(join(root, to), header(from) + readFileSync(join(root, from), 'utf8'))
    console.log(`${from} → ${to}`)
  }
}
