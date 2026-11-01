/**
 * The decisions behind the scanner-folder watcher, with no Electron in them
 * so they can be tested (watchFolderCore.test.ts).
 *
 * The one that matters is `isInside`. The renderer asks the main process to
 * READ a file by path; that path comes from the renderer, and the renderer
 * shows web content. Only paths inside the folder the user chose are read,
 * after resolving `..` and symlink-free normalisation — never "any path the
 * page asked for".
 */
import { relative, resolve, isAbsolute, extname } from 'path'

/** What a scanner or a phone exports (spec open question default: STL, PLY, OBJ). */
export const WATCHED_EXTENSIONS = new Set(['.stl', '.ply', '.obj', '.3mf', '.dcm', '.jpg', '.jpeg', '.png', '.pdf', '.zip'])

/** How deep into the folder to look: scanners make one folder per case, some two. */
export const MAX_DEPTH = 3

export function isInside(root: string, candidate: string): boolean {
  if (!root || !candidate) return false
  const rel = relative(resolve(root), resolve(candidate))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isWatchedFile(name: string): boolean {
  return !name.startsWith('.') && WATCHED_EXTENSIONS.has(extname(name).toLowerCase())
}

/** A file is "the same file" while its path, size and modification time are. */
export const fileKey = (path: string, size: number, mtimeMs: number): string =>
  `${path}|${size}|${Math.round(mtimeMs)}`

export interface UnsortedFile {
  path: string
  name: string
  size: number
  modifiedAt: number
  key: string
}

/** Newest first, minus what was attached or dismissed already. */
export function unsorted(files: UnsortedFile[], handled: Record<string, unknown>): UnsortedFile[] {
  return files.filter(f => !(f.key in handled)).sort((a, b) => b.modifiedAt - a.modifiedAt)
}
