/**
 * Moved to `shared/pricing/workTypes.ts` — see `shared/README.md`.
 *
 * The web order form has to resolve a free-text work type to a configured one
 * to quote it, and it cannot import out of the renderer. This file stays as a
 * re-export so the existing import sites did not all have to change in the same
 * commit that moved the logic; new code should import from `@shared/pricing/…`.
 */
export * from '@shared/pricing/workTypes'
