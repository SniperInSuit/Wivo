/**
 * What a work type needs the user to answer — teeth, an arch, or nothing at all.
 *
 * The hard constraint: the work-type list is USER-EDITABLE (Seaded → Valikud).
 * A lab can rename "Kaitse / splint" to "Öine kaitse", recolour "Sild", or add
 * a type nobody here has heard of. So nothing in this file ever compares the
 * incoming string to a literal. It resolves through `resolveWorkType()` — the
 * same matcher that picks the calendar colour and the price — and then
 * classifies the RESOLVED type by its OWN identity tokens: its name plus the
 * `match` synonyms the user configured. A renamed type keeps classifying
 * correctly through its synonyms; a type with neither gets the permissive
 * default rather than a wrong hard rule.
 *
 * The real fix is a `kategooria` field on WorkType in Seaded. Until then, this
 * is the only signal the data carries.
 */
import type { WorkType } from '../pricing/workTypes'
import { resolveWorkType, UNKNOWN_WORK_TYPE } from '../pricing/workTypes'

/** How this work type picks its teeth.
 *   'tooth' — individual FDI numbers (Kroon, Sild, Viniir, Inlay…)
 *   'arch'  — a whole arch, no individual teeth (All-on-X, Proteez)
 *   'none'  — no teeth at all (Kaitse/splint, Retainer, Mudel, IBT) */
export type ToothMode = 'tooth' | 'arch' | 'none'

export interface WorkTypeRules {
  /**
   * The string this rule was asked about, VERBATIM — an entry of
   * NewJobState.jobTypes. THIS is the key into `selectedTeeth`, into
   * `colorMap`, and into WorkItem.too, and it is what every step UI must use.
   *
   * It is deliberately NOT the same field as `nimi`. resolveWorkType() is a
   * first-match substring matcher, so a lab type "Zirkoonkroon" listed after
   * "Kroon" resolves to Kroon: the classification is right, the identity is
   * not. Keying anything off the resolved name would make step 2 write to
   * selectedTeeth['Kroon'] while validation read selectedTeeth['Zirkoonkroon'],
   * and the wizard could never be completed.
   */
  too: string
  /** The RESOLVED type's name — what the rule was derived from. For display
   *  and diagnostics only; never a key. */
  nimi: string
  hex: string
  /** true when resolveWorkType fell through to UNKNOWN_WORK_TYPE. */
  unknown: boolean
  toothMode: ToothMode
  /** toothMode==='tooth' → at least one tooth must be picked. */
  requiresTeeth: boolean
  /** toothMode==='arch' → selectedArch must be set. */
  requiresArch: boolean
  /** Teeth must be consecutive and in one arch. */
  isBridge: boolean
  /** Auto-fills the whole arch when an arch is chosen (All-on-X). */
  autoFullArch: boolean
  /** Offer a "Ainult üks hammas" convenience toggle. Never a hard limit. */
  suggestSingleTooth: boolean
  supportsShade: boolean
  supportsGlaze: boolean
  supportsTexture: boolean
  /**
   * Offer a screw / abutment reference for this work.
   *
   * Tooth-mode only. An arch-level type already carries a whole jaw, so a code
   * per tooth there would be a dozen inputs answering one question; a full-arch
   * case that genuinely needs codes is named per implant on the job itself.
   */
  supportsAbutment: boolean
}

// ── Keyword families ─────────────────────────────────────────────────────────
// Matched as substrings against the resolved type's identity tokens. Order of
// the TESTS matters (arch before appliance), the order inside a family does not.
const ARCH_WORDS = ['all-on', 'allon', 'all on', 'proteez', 'denture', 'hübriid', 'hybrid']
const APPLIANCE_WORDS = [
  'splint', 'kaitse', 'nightguard', 'öökaitse', 'ookaitse', 'retainer',
  'mudel', 'model', 'ibt', 'kapp', 'tray', 'lahas',
]
const BRIDGE_WORDS = ['sild', 'bridge']
/** Work that sits on an implant, and therefore on a specific abutment. */
const IMPLANT_WORDS = ['implant', 'abutment', 'abutmendile']
const SINGLE_WORDS = ['kroon', 'crown']
/** A shade is meaningless on a clear appliance, a surgical guide or a model. */
const NO_SHADE_WORDS = [...APPLIANCE_WORDS, 'kirurg', 'surgic', 'mudel', 'model', 'ibt']

/**
 * The words that identify a type: the RESOLVED type's name, every synonym the
 * user configured, and the string actually asked about.
 *
 * The last one matters because resolveWorkType() is a substring matcher and can
 * land on a broader type: a lab's own "Zirkoonsild" resolves to "Kroon" (it
 * contains "kroon" and Kroon is listed first), and without its own name in the
 * bag it would never be recognised as a bridge. Extra tokens can only add
 * signal — an unrecognised word matches no family and changes nothing.
 */
const identityTokens = (t: WorkType, asked?: string): string[] => [
  t.nimi.toLowerCase(),
  ...(t.match ?? []).map(m => m.toLowerCase()),
  ...(asked ? [asked.toLowerCase()] : []),
]

const hits = (tokens: readonly string[], words: readonly string[]): boolean =>
  tokens.some(token => words.some(w => token.includes(w)))

/**
 * Classifies a work type. See the file header for why it never compares `too`
 * to a literal.
 */
export function workTypeRules(too: string, types: readonly WorkType[]): WorkTypeRules {
  // resolveWorkType takes a mutable array in the pricing module; the wizard
  // only ever reads, so the cast is safe and keeps callers on readonly props.
  const resolved = resolveWorkType(too, types as WorkType[])
  const unknown = resolved.nimi === UNKNOWN_WORK_TYPE.nimi

  // An unrecognised type must not acquire rules nobody asked for: let the user
  // pick teeth if they want to, demand nothing, and stay out of the way.
  if (unknown) {
    return {
      too,
      nimi: resolved.nimi,
      hex: resolved.hex,
      unknown: true,
      toothMode: 'tooth',
      requiresTeeth: false,
      requiresArch: false,
      isBridge: false,
      autoFullArch: false,
      suggestSingleTooth: false,
      supportsShade: true,
      supportsGlaze: false,
      supportsTexture: false,
      // Same reasoning as the rest of the unknown branch: demand nothing and
      // offer nothing that was not asked for.
      supportsAbutment: false,
    }
  }

  const tokens = identityTokens(resolved, too)
  const isArch = hits(tokens, ARCH_WORDS)
  // Arch wins over appliance so "Proteez" asks for a jaw instead of asking
  // nothing — it is a full-arch piece of work, not a nightguard.
  const isAppliance = !isArch && hits(tokens, APPLIANCE_WORDS)
  const toothMode: ToothMode = isArch ? 'arch' : isAppliance ? 'none' : 'tooth'

  const isBridge = toothMode === 'tooth' && hits(tokens, BRIDGE_WORDS)
  const noShade = hits(tokens, NO_SHADE_WORDS)

  return {
    too,
    nimi: resolved.nimi,
    hex: resolved.hex,
    unknown: false,
    toothMode,
    requiresTeeth: toothMode === 'tooth',
    requiresArch: toothMode === 'arch',
    isBridge,
    autoFullArch: toothMode === 'arch',
    // A bridge is by definition more than one unit, so the single-tooth
    // convenience must never be offered for one.
    suggestSingleTooth: toothMode === 'tooth' && !isBridge && hits(tokens, SINGLE_WORDS),
    supportsShade: !noShade,
    supportsGlaze: toothMode === 'tooth' && !noShade,
    supportsTexture: toothMode === 'tooth' && !noShade,
    supportsAbutment: toothMode === 'tooth' && hits(tokens, IMPLANT_WORDS),
  }
}

export interface JobRules {
  /** One entry per NewJobState.jobTypes entry, same order. */
  perType: WorkTypeRules[]
  /** Lists of `too` — i.e. NewJobState.jobTypes entries verbatim, so they can be
   *  used directly as selectedTeeth / colorMap keys. Never resolved names; see
   *  WorkTypeRules.too for why the two must not be confused. */
  toothTypes: string[]
  archTypes: string[]
  applianceTypes: string[]
  bridgeTypes: string[]
  /** 'tooth' if any tooth-mode type; else 'arch' if any arch-mode type;
   *  else 'none'. Drives what Step 2 renders and whether it is skipped. */
  teethStepMode: ToothMode
  /** false only when teethStepMode === 'none'. */
  needsTeethStep: boolean
  /** OR across perType. Hide the whole shade block when false. */
  supportsShade: boolean
  supportsGlaze: boolean
  supportsTexture: boolean
  /** `too` keys that want a screw / abutment reference. */
  abutmentTypes: string[]
  /** Types that should auto-fill the arch when selectedArch changes. */
  autoFullArchTypes: string[]
  /** Any type wants the single-tooth convenience toggle. */
  suggestSingleTooth: boolean
}

/**
 * The whole job's answer, aggregated from its selected types.
 *
 * A job mixing a Kroon and a Kaitse still shows the odontogram — the crown
 * needs it. Hiding a step because one of two types does not need it would lose
 * data silently, so every OR here is deliberately permissive.
 */
export function jobRules(jobTypes: readonly string[], types: readonly WorkType[]): JobRules {
  const perType = jobTypes.map(t => workTypeRules(t, types))
  const byMode = (mode: ToothMode): string[] =>
    perType.filter(r => r.toothMode === mode).map(r => r.too)

  const toothTypes = byMode('tooth')
  const archTypes = byMode('arch')
  const teethStepMode: ToothMode =
    toothTypes.length > 0 ? 'tooth' : archTypes.length > 0 ? 'arch' : 'none'

  return {
    perType,
    toothTypes,
    archTypes,
    applianceTypes: byMode('none'),
    bridgeTypes: perType.filter(r => r.isBridge).map(r => r.too),
    teethStepMode,
    // No types selected at all also means nothing to ask — step 1 blocks
    // Continue long before that matters.
    needsTeethStep: teethStepMode !== 'none',
    supportsShade: perType.some(r => r.supportsShade),
    supportsGlaze: perType.some(r => r.supportsGlaze),
    supportsTexture: perType.some(r => r.supportsTexture),
    abutmentTypes: perType.filter(r => r.supportsAbutment).map(r => r.too),
    autoFullArchTypes: perType.filter(r => r.autoFullArch).map(r => r.too),
    suggestSingleTooth: perType.some(r => r.suggestSingleTooth),
  }
}

// `autoArchTeeth()` used to live here, and the wizard's patch() called it to
// write selectedTeeth entries for every arch-mode type. Nothing ever read them:
// wizardWorkItems() derives an arch type's teeth from `selectedArch` itself, and
// toJobInput aggregates from the work items. Removed rather than left as a
// second, silently-diverging copy of "which teeth does this arch cover" —
// `archTeeth()` in archRules.ts is the one answer.
