/**
 * Makes ONE ready-to-paste HTML block, with the clinic's own values already in
 * it. No editing afterwards, no placeholders left to miss.
 *
 * Most website builders let you paste an HTML block but not upload a `.js`
 * file, so the whole widget goes inline. That is also why this script exists at
 * all rather than an instruction to "copy the file and change two lines": the
 * two lines are `data-wivo-base` and `data-wivo-clinic`, and getting either
 * wrong produces a form that renders and then silently fails.
 *
 *   node web/embed/build-embed.mjs --clinic fullgevity > paste-me.html
 *
 * Options:
 *   --clinic  <slug>   Seaded → Kliinik → Veebilehe tunnus.        (required)
 *   --base    <url>    Function URL, without a trailing slash.
 *   --title   <text>   Heading above the form.
 *   --src     <url>    Reference wivo-booking.js from this URL instead of
 *                      inlining it — better when you CAN upload the file,
 *                      because then updating it does not mean pasting again.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const DEFAULT_BASE = 'https://wrtucsfmpbwekugzzzxw.functions.supabase.co/public-booking'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const clinic = arg('clinic')
const base = (arg('base', DEFAULT_BASE) ?? '').replace(/\/+$/, '')
const title = arg('title')
const src = arg('src')

if (!clinic) {
  console.error(`
Puudub --clinic.

  node web/embed/build-embed.mjs --clinic fullgevity > paste-me.html

Tunnuse leiad: Wivo → Seaded → Kliinik → Veebilehe tunnus.
Ilma selleta vastab funktsioon 404-ga ja vorm ei näita midagi.
`)
  process.exit(1)
}

// The slug is what ends up in every request. A typo here is a form that renders
// and then answers 404 to everything, which looks like a broken widget rather
// than a wrong setting — so it is checked before anything is written.
if (!/^[a-z0-9-]+$/.test(clinic)) {
  console.error(`\nTunnus "${clinic}" ei sobi: ainult väiketähed, numbrid ja sidekriipsud.\n`)
  process.exit(1)
}

const attrs = [
  src ? `  src="${src}"` : null,
  `  data-wivo-base="${base}"`,
  `  data-wivo-clinic="${clinic}"`,
  '  data-wivo-target="#wivo-broneering"',
  title ? `  data-wivo-title="${title.replace(/"/g, '&quot;')}"` : null,
].filter(Boolean).join('\n')

const widget = src ? '' : readFileSync(join(HERE, 'wivo-booking.js'), 'utf8')

process.stdout.write(`<!-- Wivo broneerimisvorm — genereeritud ${new Date().toISOString().slice(0, 10)}
     Kliinik: ${clinic}
     ${src ? 'Vidin laetakse eraldi failist.' : 'Vidin on siin sees — uuendamiseks kleebi uuesti.'}
     Kujundus: määra oma CSS-is .wv { --wv-accent: #sinu-värv; --wv-radius: 8px }
-->
<div id="wivo-broneering"></div>
<script
${attrs}>${widget ? '\n' + widget + '\n' : ''}</script>
`)
