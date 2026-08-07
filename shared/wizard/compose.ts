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
import { baseTypeName } from './types'

export function composeKirjeldus(state: NewJobState): string | null {
  const lines: string[] = []

  const description = state.description.trim()
  if (description) lines.push(description)

  // Only the first material reaches `job.materjal`. The rest live on their own
  // work items and are visible there, but a printed job sheet reads the
  // description — so they are named here too, next to the work they belong to.
  const perType = state.jobTypes
    .map(key => ({ key, m: state.materialByType[key]?.trim() }))
    .filter((x): x is { key: string; m: string } => !!x.m)
  const distinct = new Set(perType.map(x => x.m))
  if (distinct.size > 1) {
    lines.push(`Materjalid: ${perType.map(x => `${baseTypeName(x.key)} — ${x.m}`).join(', ')}`)
  }

  const glaze = state.glaze?.trim()
  if (glaze) lines.push(`Glasuur: ${glaze}`)

  const texture = state.texture?.trim()
  if (texture) lines.push(`Tekstuur: ${texture}`)

  const notes = state.notes.trim()
  if (notes) lines.push(`Märkus: ${notes}`)

  return lines.length > 0 ? lines.join('\n') : null
}
