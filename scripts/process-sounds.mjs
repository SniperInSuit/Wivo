#!/usr/bin/env node
/**
 * Trim and level the sounds in src/renderer/public/sounds/ with ffmpeg.
 *
 *   node scripts/process-sounds.mjs
 *
 * - Silence at the start and the end is cut (below −50 dB).
 * - Every file is loudness-normalised to the same level (−16 LUFS). The ~8 dB
 *   by which interface sounds sit under notifications is applied at playback
 *   (lib/soundCore.ts INTERFACE_GAIN), so it holds whether or not this ran.
 * - The originals are kept: copied to brand/sounds/ before anything is
 *   overwritten, and never processed twice (the copy there is the source).
 *
 * Without ffmpeg on the PATH it says so and changes nothing.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const served = join(root, 'src/renderer/public/sounds')
const originals = join(root, 'brand/sounds')

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  console.log('ffmpeg not found on PATH; nothing changed. Install it (brew install ffmpeg) and run again.')
  process.exit(0)
}

mkdirSync(originals, { recursive: true })
for (const file of readdirSync(served).filter(f => f.endsWith('.wav'))) {
  const original = join(originals, file)
  if (!existsSync(original)) copyFileSync(join(served, file), original)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', original,
    '-af', [
      'silenceremove=start_periods=1:start_threshold=-50dB',
      'areverse', 'silenceremove=start_periods=1:start_threshold=-50dB', 'areverse',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
    ].join(','),
    '-ar', '44100', join(served, file),
  ])
  console.log(`processed ${file}`)
}
