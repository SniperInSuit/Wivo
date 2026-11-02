/**
 * "What's new": the release notes for the version someone is running.
 *
 * The notes are files in the repo, release-notes/<version>/<lang>.md, written
 * for the people using Wivo (CHANGELOG.md is the developers' log). English is
 * the source and the fallback, as for the interface; every version has en.md
 * and et.md (tested). See release-notes/README.md for the format.
 *
 * Which notes to show, and whether someone has seen them, are pure functions
 * here. Where "seen" is stored is components/WhatsNew.tsx.
 */
import type { Lang } from '@shared/i18n'
import { parseInline, type Inline } from './richText'

export type Block =
  | { kind: 'heading'; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }

export interface ReleaseNotes {
  version: string
  title: string
  blocks: Block[]
}

const FILES = import.meta.glob('../../../../release-notes/*/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

/** By number, so 2.10.0 is newer than 2.9.0. Negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** { '2.0.0': { en: '…', et: '…' } } from the files' paths. */
export function indexNotes(files: Record<string, string>): Map<string, Partial<Record<string, string>>> {
  const index = new Map<string, Partial<Record<string, string>>>()
  for (const [path, text] of Object.entries(files)) {
    const m = /release-notes\/([^/]+)\/([a-z]{2})\.md$/.exec(path)
    if (!m) continue
    index.set(m[1], { ...index.get(m[1]), [m[2]]: text })
  }
  return index
}

export const NOTES = indexNotes(FILES)
/** Oldest first. */
export const NOTE_VERSIONS = [...NOTES.keys()].sort(compareVersions)

/**
 * The newest notes not newer than the running app. A patch release without
 * notes of its own keeps its predecessor's, which were then already seen.
 */
export function notesVersionFor(running: string, available: readonly string[] = NOTE_VERSIONS): string | null {
  let best: string | null = null
  for (const v of available) {
    if (compareVersions(v, running) <= 0 && (best === null || compareVersions(v, best) > 0)) best = v
  }
  return best
}

/** Whether someone who last saw `seen` (or nothing) still has `notesVersion` to see. */
export function notesUnseen(notesVersion: string, seen: string | null | undefined): boolean {
  return !seen || compareVersions(seen, notesVersion) < 0
}

/** "2.0.0" → "2.0". A patch number that says something stays. */
export function shortVersion(v: string): string {
  return v.replace(/^(\d+\.\d+)\.0$/, '$1')
}

/**
 * The Markdown subset the notes are written in: `#` title, `##` headings,
 * paragraphs, `- ` lists (a wrapped item continues on an indented line),
 * **bold** and [links](https://…). Anything else is plain text.
 */
export function parseNotes(md: string): { title: string; blocks: Block[] } {
  let title = ''
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] = []
  const flush = (): void => {
    if (para.length) blocks.push({ kind: 'paragraph', text: parseInline(para.join(' ')) })
    if (list.length) blocks.push({ kind: 'list', items: list.map(parseInline) })
    para = []
    list = []
  }
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const item = /^[-*]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      if (heading[1] === '#' && !title) title = heading[2]
      else blocks.push({ kind: 'heading', text: parseInline(heading[2]) })
    } else if (item) {
      if (para.length) flush()
      list.push(item[1])
    } else if (list.length && /^\s/.test(raw)) list[list.length - 1] += ` ${line}`
    else {
      if (list.length) flush()
      para.push(line)
    }
  }
  flush()
  return { title, blocks }
}

/** The notes for a version in this language, or in English when there is no translation. */
export function releaseNotes(version: string, language: Lang): ReleaseNotes | null {
  const files = NOTES.get(version)
  const md = files?.[language] ?? files?.en
  return md ? { version, ...parseNotes(md) } : null
}
