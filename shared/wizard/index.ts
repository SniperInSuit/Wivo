/**
 * The wizard's rules, as one import.
 *
 * The renderer imports from '@shared/wizard' and nothing deeper — the file
 * split here is an implementation detail and moving a function between them
 * must not touch a single component. Files INSIDE shared/wizard import each
 * other relatively: vitest resolves no path aliases (there is no
 * vitest.config.ts), so an '@shared/…' import in here typechecks and then dies
 * at `npm test`.
 */
export * from './types'
export * from './steps'
export * from './workTypeRules'
export * from './archRules'
export * from './validation'
export * from './compose'
