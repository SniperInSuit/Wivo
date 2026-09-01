import { useCallback, useSyncExternalStore } from 'react'
import { MATERIAL_OPTIONS, MACHINE_OPTIONS } from '../types/job'
import {
  DEFAULT_WORK_TYPES, UNKNOWN_WORK_TYPE, resolveWorkType,
  workTypeHexIn, workTypeLabelIn, workTypesPresentIn, type WorkType, type PriceMode
} from '../config/workTypes'
import { DEFAULT_VISIT_TYPES, visitTypeHexIn, type VisitType } from '../config/visitTypes'
import { emptyPublicService, slugify, type PublicService } from '@shared/portal/publicService'
import {
  CLINIC_COLUMNS, COLUMN_OF, toRow as toClinicRow,
  type ClinicColumn, type ClinicPatch, type ClinicSettingsRow
} from '../lib/clinicSettings'

// The price rules moved to shared/ so the web order form can quote a job
// without importing React — see shared/README.md. Re-exported from here so the
// existing import sites keep working; new code should import @shared directly.
export {
  countSmallTeeth, countLargeTeeth, toothCount
} from '@shared/pricing/teeth'
export {
  workTypePriceFor, calcProduction,
  type MaterialPricing, type FixedCost, type ExtraService, type Overhead,
  type PriceBook, type WorkTypePriceResult
} from '@shared/pricing/priceBook'
import { workTypeImageFile } from '../lib/workTypeImages'
import { workTypePriceFor } from '@shared/pricing/priceBook'
import type { MailPolicy } from '@shared/billing/sendGuard'
import { DEFAULT_MAIL_TEMPLATE, type MailTemplate } from '@shared/billing/mailTemplate'
import type { MaterialPricing, FixedCost, ExtraService, Overhead, PriceBook } from '@shared/pricing/priceBook'

// Bump key when structure changes so old storage is discarded cleanly
const STORAGE_KEY = 'wivo_settings_v2'

export type ThemeKey = 'hele' | 'navy-cloud' | 'cloudy-navy'

export interface ThemeOption {
  key: ThemeKey
  label: string
  hint: string
  // Swatches for the settings preview — mirrors --app-bg / --c-bg-card in
  // styles/index.css. Kept in sync by hand; they are decoration, not the source.
  preview: { bg: string; card: string }
}

export const THEMES: ThemeOption[] = [
  {
    key: 'hele',
    label: 'Hele',
    hint: 'Vaikimisi, valge',
    preview: { bg: '#F7F9FA', card: '#FFFFFF' }
  },
  {
    key: 'navy-cloud',
    label: 'Navy Cloud',
    hint: '#16284B → #0F1D3A, heledad kastid',
    preview: {
      bg: 'linear-gradient(135deg,#16284B 0%,#142443 45%,#0F1D3A 100%)',
      card: '#F8FBFD'
    }
  },
  {
    key: 'cloudy-navy',
    label: 'Cloudy Navy',
    hint: 'Hele taust, tumedad kastid',
    preview: {
      bg: 'linear-gradient(135deg,#f4f8fc 0%,#e6edf6 45%,#cfdae9 78%,#b9c8dc 100%)',
      card: '#16233F'
    }
  }
]

// ─── Text size ────────────────────────────────────────────────────────────────
// Applied as Electron frame zoom, not a font-size — see applyTextScale().
export interface TextSizeOption {
  key: string
  label: string
  hint: string
  value: number
}

export const TEXT_SIZES: TextSizeOption[] = [
  { key: 'vaike',    label: 'Väike',      hint: '90%',  value: 0.9 },
  { key: 'tavaline', label: 'Tavaline',   hint: '100%', value: 1 },
  { key: 'suur',     label: 'Suur',       hint: '110%', value: 1.1 },
  { key: 'suurem',   label: 'Suurem',     hint: '125%', value: 1.25 },
  { key: 'suurim',   label: 'Väga suur',  hint: '140%', value: 1.4 },
]

export const TEXT_SCALE_MIN = 0.8
export const TEXT_SCALE_MAX = 1.6

/**
 * Outgoing mail settings, as they sync to `clinic_settings.email`.
 *
 * `extends MailPolicy` on purpose: the permission half IS the shape the sender
 * obeys (`shared/billing/sendGuard`), so the switch on the screen and the check
 * in the sender can never be two different ideas of "allowed". The rest is
 * transport detail — and never the password, see sql/051.
 */
export interface MailSettings extends MailPolicy, MailTemplate {
  /** The person's note that the SMTP secrets are set. Not proof; nothing here
   *  can see them. */
  connected: boolean
  host: string
  port: number
  saatjaNimi: string
}

export interface WivoSettings {
  materialPrices: Record<string, MaterialPricing>
  // What the material COSTS the lab, as opposed to what it sells for. Empty
  // means unknown — the finance view counts what it could not cost rather than
  // assuming zero and reporting a margin that is too good.
  materialCosts: Record<string, MaterialPricing>
  designFee: number       // € per job when design is included
  defaultMachine: string
  kasutajaNimi: string    // Sinu nimi — stamped as the author on patient notes
  teema: ThemeKey         // Teema — see THEMES / styles/index.css
  ribaLaiendatud: boolean // Külgriba laiendatud (sildid ikoonide kõrval) või kompaktne
  tekstiSuurus: number    // Teksti/kuva suurus, 1 = 100%
  paneeliSuund: 'side' | 'bottom' | 'fullscreen'  // Kuidas töö/visiidi paneel avaneb
  // ─── Kohandatavad valikud ──────────────────────────────────────────────────
  // These were hardcoded constants, which meant a lab with a third printer or a
  // material outside the SprintRay range had to type it free-hand every time.
  masinad: string[]       // Masinad — printer buttons on the job form
  materjalid: string[]    // Materjalid — material buttons + the price table rows
  // Töö tüübid — suggestions on the job form's Töö field AND the colour key for
  // every calendar fill, dashboard swatch and legend row.
  /**
   * Outgoing mail: where from, and what the system is ALLOWED to send.
   *
   * No password. The credential is for the clinic's MAIN mailbox and this
   * object syncs to a row every clinic member can read — it lives in
   * `supabase secrets`, reachable only by the edge function while it runs.
   * `connected` is a person's note that they set those secrets.
   */
  epost: MailSettings
  tooTuubid: WorkType[]
  // Visiidi põhjused ja nende värvid. Sama kuju mis tooTuubid, sama redaktor.
  visiidiTyybid: VisitType[]
  /**
   * Patsiendile nähtav teenusekataloog avaliku veebilehe jaoks.
   *
   * Teadlikult EI ole see `tooTuubid` laiendus: seal on järjekord sobitamise
   * järjekord ja seal on `kulud`. Vt sql/047 ja shared/portal/publicService.ts.
   */
  avalikudTeenused: PublicService[]
  // Internal bookkeeping, not a user setting: marks that the 1.7.13 colour
  // repair has already run, so it cannot re-run and overwrite a deliberate pick.
  tooVarvidParandatud: boolean
  // ─── Kalender ──────────────────────────────────────────────────────────────
  // Every one of these replaced a constant hardcoded in a component, which meant
  // the app assumed one particular lab's working day and pricing.
  ajajoonAlgus: number    // Horisontaalse ajajoone algustund (Ülevaade, Kombineeritud)
  ajajoonLopp: number     // …ja lõputund
  nadalAlgus: number      // Nädalavaate ruudustiku algustund
  nadalLopp: number       // …ja lõputund
  ajaSamm: number         // Lohistamise samm minutites
  visiidiKestus: number   // Uue visiidi vaikimisi kestus minutites
  // ─── Hinnastamine ──────────────────────────────────────────────────────────
  // Per-job prices live on the work type itself (`tooTuubid[].hind`), not in a
  // map beside it — see the WorkType comment in config/workTypes.ts.
  hambaHind: number       // Vaikimisi €/hammas, kui materjalil hinda pole
  muudatusHambaHind: number // €/hammas muudatuse puhul
  kiirtooKordaja: number  // Kiirtöö hinnakordaja
  mudeliHind: number      // Mudeli hind € (automaatselt lisatakse kui mudel=true)
  // ─── Arved ─────────────────────────────────────────────────────────────────
  // Default only. Each invoice stores the rate it was issued with, so changing
  // this never restates a document that has already gone out.
  kmMaar: number          // Käibemaksumäär %
  makseTahtaegPaevades: number  // Maksetähtaeg päevades
  // Tööandja maksude määr brutopalgalt, %. Vaikimisi 0 — vale maksumäär, mille
  // rakendus ise välja mõtles, on halvem kui ilmselgelt puuduv.
  tooandjaMaksudProtsent: number
  // ─── Kliiniline režiim ─────────────────────────────────────────────────────
  // Patsiendikaart (ravikaart, allergiad, hambakaardi seisund) ja visiitide
  // broneerimine. Vaikimisi VÄLJAS: WivoLab on laboritoode ja terviseandmed on
  // GDPR Art. 9 vastutus, mida laboril pole vaja kanda. Sisselülitamine toob
  // kõik tagasi — andmeid ei kustutata kunagi, ainult peidetakse.
  kliinilineRezhiim: boolean
  // The other half. Together these two name the product:
  //   lab only            → WivoLab      (a laboratory)
  //   clinical only       → WivoDental   (a practice)
  //   both                → WivoX        (a practice with its own lab)
  // Defaults to true and every pre-1.33 row is read as true, so an existing
  // install keeps every view it had. Never both false — the settings picker
  // only offers the three combinations above.
  laboriRezhiim: boolean
  // ─── Fikseeritud kulud iga töö kohta ───────────────────────────────────────
  // Applied automatically to every job's cost calculation. Covers things like
  // gloves, face shields, disinfection supplies — small per-patient costs that
  // are real but not worth tracking individually.
  fixedCostsPerJob: FixedCost[]
  // ─── Lisateenused ──────────────────────────────────────────────────────────
  // Extra services that can be added to individual jobs (e.g. Ülesehitus,
  // Ajutine kroon, Wax-up). Defined here as a price list, selected per job.
  lisateenused: ExtraService[]
  // ─── Üldkulud ──────────────────────────────────────────────────────────────
  // Kuised püsikulud, mis kehtivad sõltumata sellest, kas töid tehti: rent,
  // liisingud, tarkvara. Nendeta on Rahandus brutomarginaal, mitte kasum.
  yldkulud: Overhead[]
}

const EMPTY_MATERIAL: MaterialPricing = { small: 0, large: 0 }
const DEFAULT_MATERIAL: MaterialPricing = { small: 15, large: 15 }

function defaultSettings(): WivoSettings {
  return {
    materialPrices: Object.fromEntries(
      MATERIAL_OPTIONS.map(m => [m, { ...DEFAULT_MATERIAL }])
    ),
    materialCosts: {},
    designFee: 0,
    defaultMachine: '',
    kasutajaNimi: '',
    teema: 'hele',
    ribaLaiendatud: true,
    paneeliSuund: 'fullscreen' as const,
    tekstiSuurus: 1,
    masinad: [...MACHINE_OPTIONS],
    materjalid: [...MATERIAL_OPTIONS],
    // Every permission off. A clinic that connects a mailbox and walks away
    // has connected a mailbox and nothing else.
    epost: {
      connected: false,
      host: '', port: 465,
      saatjaAadress: '', saatjaNimi: '',
      saatmineLubatud: false, lubaArved: false,
      paevaLimiit: 20, testAadress: null,
      // A real letter rather than an empty box: "write your own or get nothing"
      // ships exactly the blank-looking mail the template exists to fix.
      ...DEFAULT_MAIL_TEMPLATE,
    },
    tooTuubid: DEFAULT_WORK_TYPES.map(t => ({ ...t })),
    visiidiTyybid: DEFAULT_VISIT_TYPES.map(t => ({ ...t })),
    avalikudTeenused: [],
    tooVarvidParandatud: true,
    ajajoonAlgus: 7,
    ajajoonLopp: 19,
    nadalAlgus: 9,
    nadalLopp: 18,
    ajaSamm: 15,
    visiidiKestus: 30,
    hambaHind: 15,
    muudatusHambaHind: 8,
    kiirtooKordaja: 2,
    mudeliHind: 0,
    // 0 by default on purpose: a clinic that is not VAT-registered must not
    // start issuing invoices with tax on them because the app guessed a rate.
    // Set it in Seaded → Hinnad once, and confirm the rate that applies to you.
    kmMaar: 0,
    kliinilineRezhiim: false,
    laboriRezhiim: true,
    yldkulud: [],
    makseTahtaegPaevades: 14,
    tooandjaMaksudProtsent: 0,
    fixedCostsPerJob: [],
    lisateenused: [],
  }
}

// An empty list is a legitimate choice (a lab with no printers), so only a
// missing or malformed value falls back to the defaults.
function strList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

// A name inherits the colour of the built-in type it MEANS, not the one it is
// spelled exactly like. An exact-name lookup left "Allon4" (from the 1.7.12
// string list) grey, because the built-in is called "All-on-X" — the synonym
// table is what knows those are the same thing.
function seedHex(nimi: string): string {
  const exact = DEFAULT_WORK_TYPES.find(d => d.nimi.toLowerCase() === nimi.toLowerCase())
  return exact?.hex ?? resolveWorkType(nimi, DEFAULT_WORK_TYPES).hex
}

// Work types were a plain string[] in 1.7.12 and gained colours in 1.7.13.
// Both shapes are read here rather than bumping STORAGE_KEY, which would also
// discard every material price the user has entered.
function workTypeList(v: unknown, fallback: WorkType[], repairColours: boolean): WorkType[] {
  if (!Array.isArray(v)) return fallback
  return v.flatMap((x): WorkType[] => {
    if (typeof x === 'string' && x.trim()) {
      return [{ nimi: x.trim(), hex: seedHex(x.trim()) }]
    }
    if (x && typeof x === 'object' && typeof (x as WorkType).nimi === 'string') {
      const t = x as WorkType
      if (!t.nimi.trim()) return []
      const stored = typeof t.hex === 'string' && t.hex ? t.hex : null
      // One-time repair for lists already written by the broken exact-match
      // seeding: a named type left on the unknown-grey gets its real colour
      // back. Gated on the migration flag so it runs once and never overrides
      // grey that the user picked deliberately afterwards.
      const needsRepair = repairColours && stored === UNKNOWN_WORK_TYPE.hex

      // SPREAD, never rebuild field by field. This function used to construct a
      // fresh object from nimi/hex/match only, which silently DELETED every
      // field added to WorkType afterwards — hind, soodushind, hinnaTyyp, pilt,
      // kulud — on every single load. Prices survived the session and vanished
      // on restart. Anything added to WorkType from here on is carried through
      // automatically; only the fields that need normalising are named below.
      return [{
        ...t,
        nimi: t.nimi.trim(),
        hex: needsRepair || !stored ? seedHex(t.nimi) : stored,
        hind: numOrUndef(t.hind),
        soodushind: numOrUndef(t.soodushind),
        hinnaTyyp: t.hinnaTyyp === 'hammas' ? 'hammas' : t.hinnaTyyp === 'too' ? 'too' : undefined,
        pilt: typeof t.pilt === 'string' && t.pilt.trim() ? t.pilt.trim() : undefined,
        kulud: Array.isArray(t.kulud)
          ? t.kulud
              .filter(k => k && typeof k === 'object')
              .map(k => ({
                nimi: typeof k.nimi === 'string' ? k.nimi : '',
                summa: numOrUndef(k.summa) ?? 0,
                tyyp: k.tyyp === 'hammas' ? 'hammas' as const : 'too' as const,
              }))
          : undefined,
        // Normalised for the same reason `kulud` is: this jsonb can be edited
        // by hand in the Supabase table editor, and one NaN in a tier would
        // poison every price it touched. `tierFor()` ignores junk at read time
        // too — this just keeps it from being stored.
        astmed: Array.isArray(t.astmed)
          ? t.astmed
              .filter(a => a && typeof a === 'object')
              .map(a => ({
                alates: numOrUndef(a.alates) ?? 0,
                hind: numOrUndef(a.hind) ?? 0,
                soodushind: numOrUndef(a.soodushind),
              }))
              .filter(a => a.alates > 0 && a.hind > 0)
          : undefined,
        ...(Array.isArray(t.match) ? { match: t.match } : {}),
      }]
    }
    return []
  })
}

/** A finite, non-negative number, or undefined. Keeps a corrupted value from
 *  becoming NaN and poisoning every total downstream. */
function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

// 1.7.13 briefly stored per-job prices in their own `tooHinnad` map before they
// moved onto the work type. Folds any such prices back onto the matching type,
// and keeps an unmatched key as a new type rather than dropping a price someone
// typed. Runs off the presence of the old field, so it stops mattering as soon
// as the settings are written once.
function mergeLegacyPrices(types: WorkType[], legacy: unknown): WorkType[] {
  if (!legacy || typeof legacy !== 'object') return types
  const entries = Object.entries(legacy as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
  if (entries.length === 0) return types

  const out = types.map(t => ({ ...t }))
  for (const [name, price] of entries) {
    const hit = out.find(t => t.nimi.toLowerCase() === name.trim().toLowerCase())
    if (hit) {
      if (hit.hind == null) hit.hind = price
    } else {
      out.push({ nimi: name.trim(), hex: seedHex(name.trim()), hind: price })
    }
  }
  return out
}

export function clampTextScale(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 1
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, v))
}

function loadSettings(): WivoSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const stored = JSON.parse(raw) as Partial<WivoSettings>
    const def = defaultSettings()
    // Merge: stored values win, but new materials not in storage get the default 15€.
    // This is also why STORAGE_KEY is NOT bumped for additive fields like
    // kasutajaNimi — a bump would wipe every material price the user has entered.
    return {
      materialPrices: { ...def.materialPrices, ...(stored.materialPrices ?? {}) },
      materialCosts: stored.materialCosts ?? {},
      kliinilineRezhiim: stored.kliinilineRezhiim ?? false,
      laboriRezhiim: stored.laboriRezhiim ?? true,
      designFee: stored.designFee ?? 0,
      defaultMachine: stored.defaultMachine ?? '',
      kasutajaNimi: stored.kasutajaNimi ?? '',
      teema: stored.teema ?? 'hele',
      ribaLaiendatud: stored.ribaLaiendatud ?? true,
      paneeliSuund: (['side', 'bottom', 'fullscreen'] as const).includes(stored.paneeliSuund as any) ? stored.paneeliSuund as 'side' | 'bottom' | 'fullscreen' : 'fullscreen',
      // Clamped: a corrupted value here would otherwise render the UI unusable
      // at a size from which the settings page could not be reached again.
      tekstiSuurus: clampTextScale(stored.tekstiSuurus),
      masinad: strList(stored.masinad, def.masinad),
      materjalid: strList(stored.materjalid, def.materjalid),
      tooTuubid: mergeLegacyPrices(
        workTypeList(stored.tooTuubid, def.tooTuubid, !stored.tooVarvidParandatud),
        (stored as { tooHinnad?: unknown }).tooHinnad
      ),
      // An empty stored list is a deliberate "I deleted them all", so only a
      // MISSING key falls back to the defaults.
      visiidiTyybid: Array.isArray(stored.visiidiTyybid)
        ? (stored.visiidiTyybid as VisitType[]).filter(t => t?.nimi && t?.hex).map(t => ({ ...t }))
        : def.visiidiTyybid,
      // Nagu visiiditüüpidel: tühi salvestatud nimekiri on teadlik valik, ainult
      // PUUDUV võti langeb tagasi vaikeväärtusele.
      avalikudTeenused: Array.isArray(stored.avalikudTeenused)
        ? (stored.avalikudTeenused as PublicService[]).filter(t => t?.id).map(t => ({ ...t }))
        : def.avalikudTeenused,
      // Merged onto the defaults rather than taken whole: a stored object
      // written before a permission existed must not leave that permission
      // undefined — and `undefined` reads as falsy, which for a NEW switch
      // would be right by luck rather than by design.
      epost: { ...def.epost, ...(stored.epost as Partial<MailSettings> | undefined ?? {}) },
      tooVarvidParandatud: true,
      ajajoonAlgus: stored.ajajoonAlgus ?? 7,
      ajajoonLopp: stored.ajajoonLopp ?? 19,
      nadalAlgus: stored.nadalAlgus ?? 9,
      nadalLopp: stored.nadalLopp ?? 18,
      ajaSamm: stored.ajaSamm ?? 15,
      visiidiKestus: stored.visiidiKestus ?? 30,
      hambaHind: stored.hambaHind ?? 15,
      muudatusHambaHind: stored.muudatusHambaHind ?? 8,
      kiirtooKordaja: stored.kiirtooKordaja ?? 2,
      mudeliHind: stored.mudeliHind ?? 0,
      kmMaar: stored.kmMaar ?? 0,
      makseTahtaegPaevades: stored.makseTahtaegPaevades ?? 14,
      tooandjaMaksudProtsent: stored.tooandjaMaksudProtsent ?? 0,
      fixedCostsPerJob: Array.isArray(stored.fixedCostsPerJob) ? stored.fixedCostsPerJob.map(c => ({ ...c })) : [],
      lisateenused: Array.isArray(stored.lisateenused) ? stored.lisateenused.map(s => ({ ...s })) : [],
      yldkulud: Array.isArray(stored.yldkulud) ? stored.yldkulud.map(o => ({ ...o })) : [],
    }
  } catch {
    return defaultSettings()
  }
}

// ─── Module-level store ───────────────────────────────────────────────────────
// Settings are read in several places at once (SettingsPanel, JobDetailPanel,
// NotesPanel, the price calculator). With per-component useState each consumer
// snapshotted localStorage at mount and never saw later writes — so a name typed
// into Seaded while a patient page was open stamped notes as "Tundmatu" until
// the component happened to remount. One shared snapshot, one subscriber list.
let snapshot: WivoSettings = loadSettings()
applyTheme(snapshot.teema)
applyTextScale(snapshot.tekstiSuurus)
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot(): WivoSettings {
  return snapshot
}

/** Non-hook read, for the sync layer which runs outside React's render. */
export function getSettingsSnapshot(): WivoSettings {
  return snapshot
}

// The stylesheet keys off <html data-theme>, so applying is a one-liner. Done
// here rather than in a component effect so the theme is right before first paint.
function applyTheme(theme: ThemeKey) {
  document.documentElement.dataset.theme = theme
}

// Drives `#root { zoom: var(--ui-scale) }` in styles/index.css.
//
// Deliberately NOT a root font-size: the UI sets ~200 text sizes in hard pixels
// (text-[10px] and friends), which a font-size scale leaves untouched — half the
// app would grow and the dense half, the half people actually complain about,
// would not.
//
// Also deliberately not Electron's webFrame zoom, which was the first attempt:
// it needs a preload bridge, and a bridge that is missing (stale preload, app
// opened in a browser tab during dev) fails silently, so the setting looks dead.
// A CSS variable is applied by the same document that renders the UI — it cannot
// be half-installed. #root compensates its own width/height for the zoom so the
// shell still measures exactly one viewport.
function applyTextScale(scale: number) {
  document.documentElement.style.setProperty('--ui-scale', String(clampTextScale(scale)))
}

// ─── Clinic sync ──────────────────────────────────────────────────────────────
// The clinic-owned half of these settings lives in Postgres (migration 019).
// localStorage stays as a cache so the app renders real values on the very first
// paint and keeps working offline; the DB is the authority once it answers.
//
// The push side is registered by ClinicSettingsSync rather than imported, so
// this store keeps working — writing to localStorage only — before login, in
// the setup wizard, and if the settings table has not been migrated yet.
type ClinicPusher = (patch: ClinicPatch) => void
let clinicPusher: ClinicPusher | null = null

export function setClinicPusher(fn: ClinicPusher | null): void {
  clinicPusher = fn
}

/** DB → local. Applies remote clinic config without echoing it back as a write. */
export function applyClinicRow(row: Partial<ClinicSettingsRow>): void {
  const prev = snapshot
  const next: WivoSettings = {
    ...prev,
    ...(row.work_types ? { tooTuubid: workTypeList(row.work_types, prev.tooTuubid, false) } : {}),
    // Absent on every row written before 1.34 — keep whatever is local rather
    // than blanking the list on the first sync after an upgrade.
    ...(Array.isArray(row.visit_types) && row.visit_types.length > 0
      ? { visiidiTyybid: (row.visit_types as VisitType[]).filter(t => t?.nimi && t?.hex) }
      : {}),
    // Unlike the two above, an EMPTY array is honoured: a clinic that deleted
    // every public service must not have them reappear from local cache on the
    // next sync. Only a missing column is ignored.
    ...(Array.isArray(row.public_services)
      ? { avalikudTeenused: (row.public_services as PublicService[]).filter(t => t?.id) }
      : {}),
    ...(row.materials ? { materjalid: strList(row.materials, prev.materjalid) } : {}),
    ...(row.material_prices ? { materialPrices: row.material_prices } : {}),
    ...(row.material_costs ? { materialCosts: row.material_costs } : {}),
    ...(row.machines ? { masinad: strList(row.machines, prev.masinad) } : {}),
    ...(row.pricing ?? {}),
    ...(row.payroll ?? {}),
    // `laboratory` is absent on every row written before 1.33 — those are all
    // labs, so undefined must read as TRUE, not as false.
    ...(row.features
      ? {
          kliinilineRezhiim: !!row.features.clinical,
          laboriRezhiim: row.features.laboratory ?? true,
        }
      : {}),
    // Merged onto what is already loaded, never taken whole: a row written
    // before a permission existed would otherwise set it to undefined, and an
    // undefined switch is only safe by accident.
    ...(row.email ? { epost: { ...prev.epost, ...row.email } } : {}),
    ...(row.calendar ?? {}),
  }
  persistLocal(next)
}

/** The clinic-owned columns as they currently stand locally. */
export function clinicSliceOf(s: WivoSettings = snapshot): Omit<ClinicSettingsRow, 'clinic_id' | 'pipeline_stages'> {
  const { pipeline_stages: _ignored, ...rest } = toClinicRow(s, [])
  return rest
}

function persistLocal(next: WivoSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  applyTheme(next.teema)
  applyTextScale(next.tekstiSuurus)
  // New object identity every write — useSyncExternalStore compares by reference
  snapshot = next
  listeners.forEach(fn => fn())
}

function persist(next: WivoSettings, columns?: ClinicColumn[]) {
  persistLocal(next)
  if (!clinicPusher || !columns?.length) return
  // Only the sections that changed. Sending the whole row would make the person
  // editing calendar hours overwrite a price a colleague changed a second ago
  // with their own stale copy of it.
  const full = toClinicRow(next, [])
  const patch: ClinicPatch = {}
  for (const c of columns) {
    if (c === 'pipeline_stages') continue   // owned by the pipeline store
    Object.assign(patch, { [c]: full[c] })
  }
  clinicPusher(patch)
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot)

  // Every setter goes through persist(), which is what notifies subscribers and
  // what forwards the clinic-owned columns to the database.
  const setSettings = useCallback((fn: (prev: WivoSettings) => WivoSettings, columns?: ClinicColumn[]) => {
    persist(fn(snapshot), columns)
  }, [])

  const save = useCallback((next: WivoSettings) => {
    persist(next, [...CLINIC_COLUMNS])
  }, [])

  const setMaterialPrice = useCallback(
    (material: string, field: keyof MaterialPricing, value: number) => {
      setSettings(prev => {
        const next: WivoSettings = {
          ...prev,
          materialPrices: {
            ...prev.materialPrices,
            [material]: {
              ...(prev.materialPrices[material] ?? EMPTY_MATERIAL),
              [field]: value,
            },
          },
        }
        return next
      }, ['material_prices'])
    },
    [setSettings]
  )

  const setMaterialCost = useCallback(
    (material: string, field: keyof MaterialPricing, value: number) => {
      setSettings(prev => ({
        ...prev,
        materialCosts: {
          ...prev.materialCosts,
          [material]: { ...(prev.materialCosts[material] ?? EMPTY_MATERIAL), [field]: value },
        },
      }), ['material_costs'])
    },
    [setSettings]
  )

  const setDesignFee = useCallback((fee: number) => {
    setSettings(prev => ({ ...prev, designFee: fee }), ['pricing'])
  }, [setSettings])

  const setDefaultMachine = useCallback((machine: string) => {
    setSettings(prev => ({ ...prev, defaultMachine: machine }), ['pricing'])
  }, [setSettings])

  const setTeema = useCallback((teema: ThemeKey) => {
    setSettings(prev => ({ ...prev, teema }))
  }, [setSettings])

  const toggleRiba = useCallback(() => {
    setSettings(prev => ({ ...prev, ribaLaiendatud: !prev.ribaLaiendatud }))
  }, [setSettings])

  const setFixedCosts = useCallback((costs: FixedCost[]) => {
    setSettings(prev => ({ ...prev, fixedCostsPerJob: costs }), ['pricing'])
  }, [setSettings])

  const setYldkulud = useCallback((items: Overhead[]) => {
    setSettings(prev => ({ ...prev, yldkulud: items }), ['pricing'])
  }, [setSettings])

  const setLisateenused = useCallback((items: ExtraService[]) => {
    setSettings(prev => ({ ...prev, lisateenused: items }), ['pricing'])
  }, [setSettings])

  const setPaneeliSuund = useCallback((suund: 'side' | 'bottom' | 'fullscreen') => {
    setSettings(prev => ({ ...prev, paneeliSuund: suund }))
  }, [setSettings])

  const setTekstiSuurus = useCallback((scale: number) => {
    setSettings(prev => ({ ...prev, tekstiSuurus: clampTextScale(scale) }))
  }, [setSettings])

  // ── Editable option lists ──────────────────────────────────────────────────
  // Trimmed and de-duplicated case-insensitively: "Pro2" and "pro2 " as two
  // separate buttons would look like a bug, not a choice.
  type ListKey = 'masinad' | 'materjalid'

  const addOption = useCallback((key: ListKey, value: string) => {
    const v = value.trim()
    if (!v) return
    setSettings(prev => {
      const exists = prev[key].some(x => x.toLowerCase() === v.toLowerCase())
      return exists ? prev : { ...prev, [key]: [...prev[key], v] }
    }, [COLUMN_OF[key]])
  }, [setSettings])

  const removeOption = useCallback((key: ListKey, value: string) => {
    setSettings(prev => ({ ...prev, [key]: prev[key].filter(x => x !== value) }), [COLUMN_OF[key]])
  }, [setSettings])

  const renameOption = useCallback((key: ListKey, from: string, to: string) => {
    const v = to.trim()
    if (!v || v === from) return
    setSettings(prev => ({ ...prev, [key]: prev[key].map(x => (x === from ? v : x)) }), [COLUMN_OF[key]])
  }, [setSettings])

  const resetOptions = useCallback((key: ListKey) => {
    const def = defaultSettings()
    setSettings(prev => ({ ...prev, [key]: def[key] }), [COLUMN_OF[key]])
  }, [setSettings])

  // Generic numeric setter for the calendar/pricing fields — one function beats
  // ten near-identical ones, and every write still goes through persist().
  const setNumber = useCallback(<K extends keyof WivoSettings>(key: K, value: number) => {
    const col = COLUMN_OF[key as string]
    setSettings(prev => ({ ...prev, [key]: value } as WivoSettings), col ? [col] : undefined)
  }, [setSettings])

  // Same shape as setNumber, for the feature flags. Goes through COLUMN_OF so
  // the flag lands in the right jsonb column and syncs to the clinic.
  const setFlag = useCallback(<K extends keyof WivoSettings>(key: K, value: boolean) => {
    const col = COLUMN_OF[key as string]
    setSettings(prev => ({ ...prev, [key]: value } as WivoSettings), col ? [col] : undefined)
  }, [setSettings])

  /**
   * Patch the mail settings. Merged, never replaced: the caller sends the one
   * field it changed, and a permission it did not mention keeps its value
   * rather than becoming undefined — which for a switch would read as "off" by
   * luck rather than by decision.
   */
  const setEpost = useCallback((patch: Partial<MailSettings>) => {
    setSettings(prev => ({ ...prev, epost: { ...prev.epost, ...patch } }), ['email'])
  }, [setSettings])

  // ── Work types (name + colour) ─────────────────────────────────────────────
  // Separate from the string lists above because a type carries a colour, and
  // that colour is what every calendar fill and legend swatch is keyed on.
  const addWorkType = useCallback((nimi: string, hex: string) => {
    const n = nimi.trim()
    if (!n) return
    setSettings(prev => {
      const exists = prev.tooTuubid.some(t => t.nimi.toLowerCase() === n.toLowerCase())
      return exists ? prev : { ...prev, tooTuubid: [...prev.tooTuubid, { nimi: n, hex }] }
    }, ['work_types'])
  }, [setSettings])

  const removeWorkType = useCallback((nimi: string) => {
    setSettings(prev => ({ ...prev, tooTuubid: prev.tooTuubid.filter(t => t.nimi !== nimi) }), ['work_types'])
  }, [setSettings])

  const updateWorkType = useCallback((nimi: string, patch: Partial<WorkType>) => {
    setSettings(prev => ({
      ...prev,
      tooTuubid: prev.tooTuubid.map(t => {
        if (t.nimi !== nimi) return t
        const next = { ...t, ...patch }
        const renamedTo = next.nimi.trim() || t.nimi
        // Pin the picture BEFORE the name stops resolving to it. Images match
        // on the slugified name, so renaming "Implantkroon" to anything else
        // silently dropped its picture — the picture was never a property of
        // the name, it only defaulted from it. Only when the type has no
        // explicit file already, and only on an actual rename.
        const pinned = !next.pilt && renamedTo !== t.nimi
          ? workTypeImageFile(t.nimi)
          : null
        return {
          ...next,
          nimi: renamedTo,
          ...(pinned ? { pilt: pinned } : {}),
        }
      })
    }), ['work_types'])
  }, [setSettings])

  // Order is the match order — "Implantkroon" must stay above "Kroon" or every
  // implant crown resolves to the plain crown colour.
  const moveWorkType = useCallback((nimi: string, dir: 'up' | 'down') => {
    setSettings(prev => {
      const i = prev.tooTuubid.findIndex(t => t.nimi === nimi)
      const j = dir === 'up' ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= prev.tooTuubid.length) return prev
      const next = [...prev.tooTuubid]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...prev, tooTuubid: next }
    }, ['work_types'])
  }, [setSettings])

  const resetWorkTypes = useCallback(() => {
    setSettings(prev => ({ ...prev, tooTuubid: DEFAULT_WORK_TYPES.map(t => ({ ...t })) }), ['work_types'])
  }, [setSettings])

  // Price is just another field on the type — 0 or blank clears it back to
  // per-tooth pricing rather than storing a zero-euro job.
  const setTooHind = useCallback((nimi: string, price: number | null) => {
    setSettings(prev => ({
      ...prev,
      tooTuubid: prev.tooTuubid.map(t =>
        t.nimi === nimi
          ? (price == null || price <= 0
              ? { ...t, hind: undefined }
              : { ...t, hind: price })
          : t)
    }), ['work_types'])
  }, [setSettings])

  const setKasutajaNimi = useCallback((nimi: string) => {
    setSettings(prev => {
      const next = { ...prev, kasutajaNimi: nimi }
      return next
    })
  }, [])

  // Visit types reuse the work-type row editor, so they need the same four
  // operations. Kept separate rather than generalised: the work-type versions
  // carry price and image concerns a visit type has no use for.
  const addVisitType = useCallback((nimi: string, hex: string) => {
    const n = nimi.trim()
    if (!n) return
    setSettings(prev => (
      prev.visiidiTyybid.some(t => t.nimi.toLowerCase() === n.toLowerCase())
        ? prev
        : { ...prev, visiidiTyybid: [...prev.visiidiTyybid, { nimi: n, hex }] }
    ), ['visit_types'])
  }, [])

  const removeVisitType = useCallback((nimi: string) => {
    setSettings(prev => (
      { ...prev, visiidiTyybid: prev.visiidiTyybid.filter(t => t.nimi !== nimi) }
    ), ['visit_types'])
  }, [])

  // Renaming does NOT rewrite the visits already carrying the old name — an
  // issued appointment record is not restated by an edit to a picklist. Those
  // visits fall back to grey, which is honest: the type they name is gone.
  const updateVisitType = useCallback((nimi: string, patch: Partial<VisitType>) => {
    setSettings(prev => (
      { ...prev, visiidiTyybid: prev.visiidiTyybid.map(t => t.nimi === nimi ? { ...t, ...patch } : t) }
    ), ['visit_types'])
  }, [])

  const moveVisitType = useCallback((nimi: string, dir: 'up' | 'down') => {
    setSettings(prev => {
      const i = prev.visiidiTyybid.findIndex(t => t.nimi === nimi)
      const j = dir === 'up' ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= prev.visiidiTyybid.length) return prev
      const next = [...prev.visiidiTyybid]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...prev, visiidiTyybid: next }
    }, ['visit_types'])
  }, [])

  // ─── Avalikud teenused ─────────────────────────────────────────────────────
  // Sama kuju mis visiiditüüpide mutaatoritel. Eraldi hoitud, sest see nimekiri
  // läheb veebilehele: iga muudatus siin on AVALDAMINE, mitte sisemine seade.

  const addPublicService = useCallback((nimi: string) => {
    const n = nimi.trim()
    if (!n) return
    setSettings(prev => {
      // Slug tuletatakse ainult LOOMISEL. Ümbernimetamine ei tohi id-d muuta,
      // muidu jäävad juba tehtud broneeringud orvuks.
      const base = slugify(n) || 'teenus'
      let id = base
      for (let i = 2; prev.avalikudTeenused.some(t => t.id === id); i++) id = `${base}-${i}`
      const next = {
        ...emptyPublicService(id, prev.avalikudTeenused.length + 1),
        nimi: n,
      }
      return { ...prev, avalikudTeenused: [...prev.avalikudTeenused, next] }
    }, ['public_services'])
  }, [])

  const removePublicService = useCallback((id: string) => {
    setSettings(prev => (
      { ...prev, avalikudTeenused: prev.avalikudTeenused.filter(t => t.id !== id) }
    ), ['public_services'])
  }, [])

  const updatePublicService = useCallback((id: string, patch: Partial<PublicService>) => {
    setSettings(prev => ({
      ...prev,
      // SPREAD the stored object — never rebuild field by field. See HANDOFF.md:
      // that trap silently deleted every WorkType field added after 1.7.13.
      avalikudTeenused: prev.avalikudTeenused.map(t => (t.id === id ? { ...t, ...patch } : t)),
    }), ['public_services'])
  }, [])

  const movePublicService = useCallback((id: string, dir: 'up' | 'down') => {
    setSettings(prev => {
      const i = prev.avalikudTeenused.findIndex(t => t.id === id)
      const j = dir === 'up' ? i - 1 : i + 1
      if (i < 0 || j < 0 || j >= prev.avalikudTeenused.length) return prev
      const next = [...prev.avalikudTeenused]
      ;[next[i], next[j]] = [next[j], next[i]]
      // Järjekord on salvestatud väli, mitte massiivi asend — veeb sorteerib
      // selle järgi ja massiivi asend ei jõua sinna.
      return { ...prev, avalikudTeenused: next.map((t, n) => ({ ...t, jarjekord: n + 1 })) }
    }, ['public_services'])
  }, [])

  const resetVisitTypes = useCallback(() => {
    setSettings(prev => (
      { ...prev, visiidiTyybid: DEFAULT_VISIT_TYPES.map(t => ({ ...t })) }
    ), ['visit_types'])
  }, [])

  return {
    settings, save, setMaterialPrice, setMaterialCost, setDesignFee, setDefaultMachine, setKasutajaNimi,
    setTeema, toggleRiba, setNumber, setFlag, setTekstiSuurus, setFixedCosts, setLisateenused, setYldkulud, setPaneeliSuund,
    addOption, removeOption, renameOption, resetOptions,
    setEpost,
    addWorkType, removeWorkType, updateWorkType, moveWorkType, resetWorkTypes,
    addVisitType, removeVisitType, updateVisitType, moveVisitType, resetVisitTypes,
    addPublicService, removePublicService, updatePublicService, movePublicService,
    setTooHind,
  }
}

// ─── Work-type colour helpers, bound to the live settings ─────────────────────
// Components must read colours through this hook rather than importing the
// config directly: the hook subscribes to the settings store, so a recoloured
// type repaints the calendar and its legend in the same render. That is exactly
// what went wrong before 1.7.13 — the legend was drawn from hardcoded rules and
// disagreed with what the user had configured.
export function useVisitTypes() {
  const settings = useSyncExternalStore(subscribe, getSnapshot)
  const types = settings.visiidiTyybid
  return {
    types,
    hex: (tyyp: string | null | undefined) => visitTypeHexIn(tyyp, types),
  }
}

export function useWorkTypes() {
  const settings = useSyncExternalStore(subscribe, getSnapshot)
  const types = settings.tooTuubid

  return {
    types,
    resolve: (too: string | null | undefined) => resolveWorkType(too, types),
    hex: (too: string | null | undefined) => workTypeHexIn(too, types),
    label: (too: string | null | undefined) => workTypeLabelIn(too, types),
    present: (toos: (string | null | undefined)[]) => workTypesPresentIn(toos, types),
  }
}

/**
 * The quote inputs, pulled out of settings into the plain shape `quoteJob`
 * takes. Every caller must build the book through THIS function: two callers
 * assembling it by hand is how the job form and the repricer drifted apart in
 * the first place.
 */
export function priceBookOf(s: WivoSettings = snapshot): PriceBook {
  return {
    workTypes: s.tooTuubid,
    materialPrices: s.materialPrices,
    hambaHind: s.hambaHind,
    kiirtooKordaja: s.kiirtooKordaja,
    designFee: s.designFee,
    mudeliHind: s.mudeliHind,
  }
}

/** Back-compat single number, used where the breakdown is not needed. */
export function workTypePrice(
  too: string | null | undefined,
  types: WorkType[],
  teeth = 0
): number | null {
  return workTypePriceFor(too, types, teeth)?.amount ?? null
}
