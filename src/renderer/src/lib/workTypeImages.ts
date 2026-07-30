/**
 * Pictures for work types, loaded from src/renderer/src/assets/worktypes/.
 *
 * Bundled at build time via import.meta.glob rather than fetched at runtime:
 * the app has to work offline and from a packaged .asar, where a plain path to
 * a source folder does not exist. The trade-off is that a newly added image
 * needs a rebuild (a save in dev), which the folder's README says.
 *
 * Matching is by file name = slugified work-type name, so dropping in
 * `kroon.png` is all it takes for the Kroon card to have a picture. A type can
 * also name its file explicitly (WorkType.pilt) for anything the slug rule
 * cannot express.
 */

const modules = import.meta.glob(
  '../assets/worktypes/*.{png,jpg,jpeg,webp,svg,PNG,JPG,JPEG,WEBP,SVG}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

/** "Kaitse / splint" → "kaitse-splint", "Täidis" → "taidis" */
export function slugifyWorkType(nimi: string): string {
  return nimi
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics: ä → a, õ → o
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const byFileName = new Map<string, string>()
for (const [path, url] of Object.entries(modules)) {
  const file = path.split('/').pop() ?? ''
  const base = file.replace(/\.[^.]+$/, '').toLowerCase()
  byFileName.set(file.toLowerCase(), url)
  byFileName.set(base, url)
}

/** The image for a work type, or null when no file matches. */
export function workTypeImage(nimi: string, explicitFile?: string | null): string | null {
  if (explicitFile?.trim()) {
    const key = explicitFile.trim().toLowerCase()
    return byFileName.get(key) ?? byFileName.get(key.replace(/\.[^.]+$/, '')) ?? null
  }
  return byFileName.get(slugifyWorkType(nimi)) ?? null
}

/** File names actually present, for the settings hint. */
export const availableWorkTypeImages = (): string[] =>
  [...new Set(Object.keys(modules).map(p => p.split('/').pop() ?? ''))].sort()
