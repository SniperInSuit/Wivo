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

const worktypeModules = import.meta.glob(
  '../assets/worktypes/*.{png,jpg,jpeg,webp,svg,PNG,JPG,JPEG,WEBP,SVG}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

const jobModules = import.meta.glob(
  '../assets/jobs/*.{png,jpg,jpeg,webp,svg,PNG,JPG,JPEG,WEBP,SVG}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

const modules = { ...worktypeModules, ...jobModules }

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
/** base name → the real file name, for pinning a picture onto a work type. */
const fileByBase = new Map<string, string>()
for (const [path, url] of Object.entries(modules)) {
  const file = path.split('/').pop() ?? ''
  const base = file.replace(/\.[^.]+$/, '').toLowerCase()
  byFileName.set(file.toLowerCase(), url)
  byFileName.set(base, url)
  fileByBase.set(base, file)
}

// Map Estonian work type names → image file base names so slugified lookups work
const ALIASES: Record<string, string> = {
  'kroon':           'crown',
  'implantkroon':    'implant_crown',
  'implantaat-kroon': 'implant_crown',
  'implantaatkroon': 'implant_crown',
  'implantaadi-kroon': 'implant_crown',
  'abutmendile-kroon': 'abutment_crown',
  'sild':            'bridge',
  'viniir':          'veneer',
  'laminaat':        'laminate',
  'inlay':           'inlay',
  'onlay':           'onlay',
  'taidis':          'filling',
  'proteez':         'denture',
  'all-on-x':        'allon4',
  'allon-x':         'allon4',
  'all-on-4':        'allon4',
  'all-on-5':        'allon5',
  'all-on-6':        'allon6',
  'kaitse-splint':   'splint',
  'retainer':        'retainer',
  'ookaitse':        'nightguard',
  'mudel':           'model',
  'ulemine':         'upper',
  'alumine':         'lower',
}

/** The image for a work type, or null when no file matches. */
export function workTypeImage(nimi: string, explicitFile?: string | null): string | null {
  if (explicitFile?.trim()) {
    const key = explicitFile.trim().toLowerCase()
    return byFileName.get(key) ?? byFileName.get(key.replace(/\.[^.]+$/, '')) ?? null
  }
  const slug = slugifyWorkType(nimi)
  return byFileName.get(slug) ?? byFileName.get(ALIASES[slug] ?? '') ?? null
}

/**
 * The FILE NAME a bare work-type name resolves to, or null.
 *
 * Exists so a rename can pin the picture it already had. Matching is by name,
 * so renaming "Implantkroon" to anything else silently dropped its image —
 * the picture was never a property of the name, it just defaulted from it.
 */
export function workTypeImageFile(nimi: string): string | null {
  const slug = slugifyWorkType(nimi)
  return fileByBase.get(slug) ?? fileByBase.get(ALIASES[slug] ?? '') ?? null
}

/** File names actually present, for the settings hint. */
export const availableWorkTypeImages = (): string[] =>
  [...new Set(Object.keys(modules).map(p => p.split('/').pop() ?? ''))].sort()
