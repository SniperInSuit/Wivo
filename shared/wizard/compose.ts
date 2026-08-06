/**
 * The fields with nowhere to live.
 *
 * Glaze, texture, the free-text note and any material beyond the first have no
 * column on `jobs`. Rather than a migration plus a JobDetailPanel change for
 * four strings, they are folded into `kirjeldus` — one deterministic function,
 * so the text always reads the same way and the user can see and edit it on the
 * Edit page.
 *
 * This is LOSSY on a round trip: reopening a job cannot reconstruct which line
 * was the glaze. Acceptable because the wizard is create-only. If these ever
 * become first-class data, that is a migration, not a change here.
 */
import type { NewJobState } from './types'

export function composeKirjeldus(state: NewJobState): string | null {
  const lines: string[] = []

  const description = state.description.trim()
  if (description) lines.push(description)

  // materials[0] is the priced one and reaches job.materjal; the rest would
  // otherwise vanish, because quoteJob looks prices up by an exact single name.
  const extraMaterials = state.materials.slice(1).map(m => m.trim()).filter(Boolean)
  if (extraMaterials.length > 0) lines.push(`Lisamaterjalid: ${extraMaterials.join(', ')}`)

  const glaze = state.glaze?.trim()
  if (glaze) lines.push(`Glasuur: ${glaze}`)

  const texture = state.texture?.trim()
  if (texture) lines.push(`Tekstuur: ${texture}`)

  const notes = state.notes.trim()
  if (notes) lines.push(`Märkus: ${notes}`)

  return lines.length > 0 ? lines.join('\n') : null
}
