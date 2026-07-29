// Work-type colours for the calendar.
//
// The two channels on a job card answer different questions, and they must not
// both encode the same thing:
//   left edge  → WHICH STAGE the job is at   (stage hex, editable in Seaded)
//   soft fill  → WHAT KIND of work it is     (this file)
// Before 1.3.1 both were the stage colour, so a month of finished work was an
// undifferentiated wall of green and you could not spot a Kroon among Sillad.
//
// Matching is substring-based on the free-text `too` field, because that field is
// an autocomplete suggestion and not a fixed list — users type variants like
// "Allon4 ülemine" or "Abutmendile kroon".

interface TypeRule {
  match: string[]      // lowercase substrings
  label: string        // legend label
  hex: string
}

// Order matters: the first rule that matches wins, so put the more specific
// terms above the ones that would also match them.
const RULES: TypeRule[] = [
  { match: ['implantkroon', 'abutmendile'], label: 'Implantkroon', hex: '#6366F1' },
  { match: ['kroon', 'crown'],              label: 'Kroon',        hex: '#3B82F6' },
  { match: ['sild', 'bridge'],              label: 'Sild',         hex: '#8B5CF6' },
  { match: ['viniir', 'veneer'],            label: 'Viniir',       hex: '#10B981' },
  { match: ['laminaat'],                    label: 'Laminaat',     hex: '#84CC16' },
  { match: ['inlay'],                       label: 'Inlay',        hex: '#F59E0B' },
  { match: ['onlay'],                       label: 'Onlay',        hex: '#F97316' },
  { match: ['täidis', 'taidis'],            label: 'Täidis',       hex: '#EAB308' },
  { match: ['proteez', 'denture'],          label: 'Proteez',      hex: '#F43F5E' },
  { match: ['allon', 'all-on'],             label: 'All-on-X',     hex: '#EC4899' },
  { match: ['nightguard', 'öökaitse', 'ookaitse', 'splint', 'splaad'], label: 'Kaitse / splint', hex: '#06B6D4' },
  { match: ['retainer'],                    label: 'Retainer',     hex: '#14B8A6' },
  { match: ['ibt'],                         label: 'IBT',          hex: '#A855F7' },
  { match: ['kirur', 'surgic'],             label: 'Kirurgiline',  hex: '#0EA5E9' },
]

const UNKNOWN: TypeRule = { match: [], label: 'Muu / määramata', hex: '#94A3B8' }

function ruleFor(too: string | null | undefined): TypeRule {
  const t = (too ?? '').toLowerCase()
  if (!t.trim()) return UNKNOWN
  return RULES.find(r => r.match.some(m => t.includes(m))) ?? UNKNOWN
}

export const workTypeHex = (too: string | null | undefined): string => ruleFor(too).hex
export const workTypeLabel = (too: string | null | undefined): string => ruleFor(too).label

// Distinct work types present in a set of jobs, for a legend that only lists what
// is actually on screen rather than all fourteen rules.
export function workTypesPresent(toos: (string | null | undefined)[]): { label: string; hex: string }[] {
  const seen = new Map<string, string>()
  for (const t of toos) {
    const r = ruleFor(t)
    if (!seen.has(r.label)) seen.set(r.label, r.hex)
  }
  return [...seen.entries()].map(([label, hex]) => ({ label, hex }))
}
