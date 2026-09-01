/**
 * What panels exist. Data only — no React, no recharts, no JSX.
 *
 * The split from `render.tsx` is deliberate and buys three things: the picker
 * drawer (which needs titles, not charts) does not pull forty visualisations
 * into its bundle; `presets.ts` and the preferences store can name panels
 * without importing React; and the consistency test below runs in plain vitest,
 * which matters because this repo has no jsdom.
 *
 * ── Ids are stored data ──────────────────────────────────────────────────────
 * A panel id ends up in `profiles.ui_prefs` on someone's account. Renaming one
 * silently drops that panel from their dashboard. To retire or rename an id,
 * add it to `RETIRED_PANEL_IDS` in lib/uiPrefs.ts — that is the only way a
 * client can tell "we removed this" apart from "a newer version added this".
 */
import type { PermissionKey } from '../../../hooks/usePermissions'
import type { PanelNeed } from '../useStatsContext'

export type PanelGroup = 'raha' | 'yhik' | 'tootmine' | 'inimesed' | 'lobus'

export const PANEL_GROUP_LABEL: Record<PanelGroup, string> = {
  raha:     'Raha ja kasum',
  yhik:     'Ühikumajandus',
  tootmine: 'Tootmine ja tähtajad',
  inimesed: 'Kliendid ja inimesed',
  // Not decoration. These are the questions people actually ask each other in a
  // lab, and a dashboard that can only answer the ones an accountant asks is a
  // dashboard nobody opens on a Friday.
  lobus:    'Lõbus teada',
}

/**
 * Default size in grid cells, [columns, rows], on the four-column grid.
 *
 * A DEFAULT, not a fixed property: the person can resize any panel and that
 * override lives in their own prefs. What this decides is only what a panel
 * looks like the first time it appears.
 */
export type PanelSize = readonly [1 | 2 | 3 | 4, 1 | 2 | 3 | 4 | 5 | 6]

export interface PanelMeta {
  id: string
  title: string
  /** One line: what the number MEANS. An unlabelled total cannot be checked. */
  hint?: string
  group: PanelGroup
  defaultSize: PanelSize
  /** Absent = visible to anyone who can open Statistika at all. */
  perm?: PermissionKey
  /** Only when the clinic runs that half of the product. */
  feature?: 'clinical' | 'lab'
  needs?: readonly PanelNeed[]
}

export const PANEL_CATALOGUE = [
  // ── Raha ja kasum ──────────────────────────────────────────────────────────
  {
    id: 'raha.kasum', title: 'Kasum', group: 'raha', defaultSize: [1, 1],
    hint: 'Tööde hinnad miinus tööjõud koos maksudega, materjal, fikseeritud kulud ja üldkulud',
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kulud', title: 'Kulu kokku', group: 'raha', defaultSize: [1, 1],
    hint: 'Neli kulurida eraldi: tööjõud + maksud, materjal, fikseeritud, üldkulud',
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kate', title: 'Brutokate ja netokate', group: 'raha', defaultSize: [1, 1],
    hint: 'Arveldatud miinus otsesed kulud; netokate lisaks miinus üldkulud',
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kaive', title: 'Käive', group: 'raha', defaultSize: [1, 1],
    hint: 'Tööde hinnad koos muudatuste tasudega, kumbki oma kuupäeval',
    perm: 'payments.read',
  },
  {
    id: 'raha.arveldatud', title: 'Arveldatud', group: 'raha', defaultSize: [1, 1],
    hint: 'Arvetele pandud, käibemaksuta', perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.laekunud', title: 'Laekunud', group: 'raha', defaultSize: [1, 1],
    hint: 'Raha, mis perioodil päriselt saabus', perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.tasumata', title: 'Tasumata arvete järgi', group: 'raha', defaultSize: [1, 1],
    hint: 'Väljastatud ja maksmata. Arveta tehtud töö siin ei kajastu',
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.arveldamata', title: 'Arveldamata', group: 'raha', defaultSize: [1, 1],
    hint: 'Valmis töö, millele ei ole arvet — kulu on kantud, tulu mitte',
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.toojoukulu', title: 'Tööjõukulu + maksud', group: 'raha', defaultSize: [1, 1],
    hint: 'Bruto (netolepingud üles arvutatud) + tööandja maksud + arve alusel',
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'raha.valjamakstud', title: 'Arvestatud vs välja makstud', group: 'raha', defaultSize: [1, 1],
    hint: 'Mida periood teenis ja mis on juba välja makstud',
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'raha.kaive_kuude_kaupa', title: 'Käive kuude kaupa', group: 'raha', defaultSize: [2, 2],
    hint: 'Viimased kuud tulpadena', perm: 'payments.read',
  },
  {
    id: 'raha.maksmise_viis', title: 'Maksmise viis', group: 'raha', defaultSize: [2, 2],
    hint: 'Sularaha, kaart, ülekanne — osakaaluga', perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.muudatuste_kahju', title: 'Muudatuste kahju', group: 'raha', defaultSize: [2, 2],
    hint: 'Ümbertegemise netokahju põhjuse kaupa', perm: 'payments.read', needs: ['finance'],
  },

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  {
    id: 'yhik.hind_hamba_kohta', title: 'Hind hamba kohta', group: 'yhik', defaultSize: [1, 1],
    hint: 'Käive jagatud hammastega — mõlemad koos muudatustega',
    perm: 'payments.read',
  },
  {
    id: 'yhik.tulu_too_kohta', title: 'Ø hind / töö', group: 'yhik', defaultSize: [1, 1],
    hint: 'Käive jagatud sama ühikuarvuga, mida lugeja kokku loeb',
    perm: 'payments.read',
  },
  {
    id: 'yhik.kiirtoo_tasuvus', title: 'Kiirtöö tasuvus', group: 'yhik', defaultSize: [1, 1],
    hint: 'Kiirtööde osa käibest võrreldes nende osaga tööde arvust',
    perm: 'payments.read',
  },
  {
    id: 'yhik.kate_tootyybi_jargi', title: 'Kate töö tüübi järgi', group: 'yhik', defaultSize: [4, 2],
    hint: 'Tulu, kulu, tööjõud, materjal ja kate iga töötüübi kohta',
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'yhik.kahjumlikud', title: 'Kahjumlikud töö tüübid', group: 'yhik', defaultSize: [2, 2],
    hint: 'Negatiivse kattega tüübid, halvim ees — number, mida keegi ise ei otsi',
    perm: 'payments.read', needs: ['finance'],
  },

  // ── Tootmine ja tähtajad ───────────────────────────────────────────────────
  {
    id: 'toot.tood_kokku', title: 'Töid kokku', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Tööd ja muudatused, jaotus nähtaval',
  },
  {
    id: 'toot.hambaid', title: 'Hambaid toodetud', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Originaal ja muudatus eraldi',
  },
  {
    id: 'toot.tahtajast_yle', title: 'Tähtajast üle', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Lõpetamata tööd, mille tähtaeg on möödas — hetkeseis',
  },
  {
    id: 'toot.labiaeg', title: 'Ø läbiaeg', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Päevi vastuvõtust tegeliku valmimiseni',
  },
  {
    id: 'toot.muudatuste_maar', title: 'Revisjonimäär', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Muudatusega tööde osa kõigist töödest',
  },
  {
    id: 'toot.wip', title: 'Töös etappide kaupa', group: 'tootmine', defaultSize: [2, 2],
    hint: 'Praegu töös olevad tööd etapiti — hetkeseis, mitte periood',
  },
  {
    id: 'toot.valmis_kuude_kaupa', title: 'Valmis tööd kuude kaupa', group: 'tootmine', defaultSize: [2, 2],
    hint: 'Läbilaskevõime joonena',
  },
  {
    id: 'toot.muudatuste_pohjused', title: 'Muudatuste põhjused', group: 'tootmine', defaultSize: [2, 2],
    hint: 'Kaks põhjust ühel muudatusel loevad mõlemad — ribade summa ületab muudatuste arvu',
  },
  {
    id: 'toot.materjalid', title: 'Tööd materjali järgi', group: 'tootmine', defaultSize: [2, 2],
    hint: 'Arv materjali kohta',
  },
  {
    id: 'toot.masinad', title: 'Masinate koormus', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Tööd printeri kaupa', feature: 'lab',
  },

  // ── Kliendid ja inimesed ───────────────────────────────────────────────────
  {
    id: 'inim.tootajad', title: 'Töötajate kaupa', group: 'inimesed', defaultSize: [4, 2],
    hint: 'Tööd, hambad, arvestatud ja välja makstud inimese kohta',
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'inim.tootaja_tootlikkus', title: 'Töötajate koormus', group: 'inimesed', defaultSize: [2, 2],
    hint: 'Tööd ja hambad inimese kohta — ilma rahata',
    needs: ['finance'],
  },
  {
    id: 'inim.katvus', title: 'Andmete katvus', group: 'inimesed', defaultSize: [1, 1],
    hint: 'Mitmel valmis tööl puudub teostaja või omahind — iga kattenumbri usaldusväärsus',
    needs: ['finance'],
  },
  {
    id: 'inim.patsiendid', title: 'Patsiendid', group: 'inimesed', defaultSize: [1, 1],
    hint: 'Kokku, uued, korduvad', perm: 'patients.read', feature: 'clinical',
  },
  {
    id: 'inim.visiidid', title: 'Visiidid', group: 'inimesed', defaultSize: [1, 1],
    hint: 'Kokku, ei tulnud, keskmine kestus', perm: 'visits.read', feature: 'clinical',
  },
  {
    id: 'inim.arstid', title: 'Top suunavad arstid', group: 'inimesed', defaultSize: [2, 2],
    hint: 'Käibe järgi', perm: 'payments.read', feature: 'clinical',
  },

  // ── Raha: arvete pool ──────────────────────────────────────────────────────
  {
    id: 'raha.vanus', title: 'Võlgnevuse vanus', group: 'raha', defaultSize: [2, 2],
    hint: 'Tasumata summa selle järgi, kui kaua ta on üle tähtaja olnud',
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.laekumisaeg', title: 'Keskmine laekumisaeg', group: 'raha', defaultSize: [1, 1],
    hint: 'Mitu päeva arve väljastamisest rahani. Ainult perioodil lõplikult tasutud arved',
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.kaibemaks', title: 'Käibemaks perioodis', group: 'raha', defaultSize: [1, 1],
    hint: 'Väljastatud arvete käibemaks — riigile, mitte tulu',
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.keskmine_arve', title: 'Keskmine arve', group: 'raha', defaultSize: [1, 1],
    hint: 'Perioodil väljastatud arvete keskmine netosumma',
    perm: 'payments.read', needs: ['invoices'],
  },

  // ── Ühikumajandus: uued ────────────────────────────────────────────────────
  {
    id: 'yhik.kasum_too_kohta', title: 'Kasum töö kohta', group: 'yhik', defaultSize: [1, 1],
    hint: 'Kasum jagatud TÖÖDEGA — mitte tööosade ega muudatustega',
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.kate_hamba_kohta', title: 'Kate hamba kohta', group: 'yhik', defaultSize: [1, 1],
    hint: 'Tulu miinus kulu, jagatud hammastega',
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.kulu_hamba_kohta', title: 'Kulu hamba kohta', group: 'yhik', defaultSize: [1, 1],
    hint: 'Kogu kulu jagatud hammastega',
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.osakaalud', title: 'Kulude osakaal tulust', group: 'yhik', defaultSize: [2, 2],
    hint: 'Tööjõud, materjal ja üldkulud protsendina tööde väärtusest',
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.tulu_toopaeva_kohta', title: 'Tulu tööpäeva kohta', group: 'yhik', defaultSize: [1, 1],
    hint: 'Käive jagatud möödunud tööpäevadega (E–R)',
    perm: 'payments.read', needs: ['unit'],
  },

  // ── Tootmine: uued ─────────────────────────────────────────────────────────
  {
    id: 'toot.tahtajaks', title: 'Tähtajaks valmis', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Osa töödest, mis valmisid tähtajaks. Tähtajata tööd ei loe kummalegi poole',
    needs: ['flow'],
  },
  {
    id: 'toot.labiaeg_jaotus', title: 'Läbiaja jaotus', group: 'tootmine', defaultSize: [2, 2],
    hint: 'Mediaan, 90. protsentiil, kiireim ja aeglaseim — keskmine üksi varjab saba',
    needs: ['flow'],
  },
  {
    id: 'toot.tarne', title: 'Tarne seis', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Laboris, teel, üle antud — valmis töö ei ole veel kohale jõudnud töö',
    feature: 'lab', needs: ['flow'],
  },
  {
    id: 'toot.tarneaeg', title: 'Tarneaeg', group: 'tootmine', defaultSize: [1, 1],
    hint: 'Päevi valmimisest üleandmiseni', feature: 'lab', needs: ['flow'],
  },
  {
    id: 'toot.nadalapaevad', title: 'Koormus nädalapäeva järgi', group: 'tootmine', defaultSize: [2, 2],
    hint: 'Mis päeval töö saabub ja mis päeval valmib', needs: ['flow'],
  },

  // ── Kliendid ───────────────────────────────────────────────────────────────
  {
    id: 'inim.kliendid_kaive', title: 'Top kliendid', group: 'inimesed', defaultSize: [2, 2],
    hint: 'Milline praksis toob tööd ja raha. Kliendita tööd on „Määramata" all',
    perm: 'payments.read', needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.kliendid_seis', title: 'Kliendid perioodis', group: 'inimesed', defaultSize: [1, 1],
    hint: 'Aktiivsed ja uued', needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.kliendid_magavad', title: 'Magavad kliendid', group: 'inimesed', defaultSize: [2, 2],
    hint: 'Ei ole 90 päeva tellinud — nimekiri, millega helistada',
    needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.maksedistsipliin', title: 'Klientide maksedistsipliin', group: 'inimesed', defaultSize: [2, 2],
    hint: 'Keskmine päevade arv arvest makseni, kliendi kaupa',
    perm: 'payments.read', needs: ['customers'], feature: 'lab',
  },

  // ── Lõbus teada ────────────────────────────────────────────────────────────
  {
    id: 'fun.hambad_kokku', title: 'Hambaid kokku', group: 'lobus', defaultSize: [1, 1],
    hint: 'Kogu aeg, koos ümbertegemistega — ja mitu suutäit see teeb',
    needs: ['fun'],
  },
  {
    id: 'fun.rekordid', title: 'Rekordid', group: 'lobus', defaultSize: [2, 2],
    hint: 'Suurim töö, tihedaim päev, kiireim ja aeglaseim läbiaeg',
    needs: ['fun', 'flow'],
  },
  {
    id: 'fun.seeria', title: 'Pikim veatu seeria', group: 'lobus', defaultSize: [1, 1],
    hint: 'Mitu valmis tööd järjest ilma ühegi muudatuseta', needs: ['fun'],
  },
  {
    id: 'fun.lemmikud', title: 'Lemmikud', group: 'lobus', defaultSize: [2, 2],
    hint: 'Sagedaseim värv, materjalide arv, hambakaardi katvus, lojaalseim patsient',
    needs: ['fun'],
  },
  {
    id: 'fun.tempo', title: 'Tempo', group: 'lobus', defaultSize: [1, 1],
    hint: 'Nädalavahetusel valminud tööd ja kiirtööde osakaal', needs: ['fun'],
  },
  {
    id: 'fun.algus', title: 'Kaua me juba teeme', group: 'lobus', defaultSize: [1, 1],
    hint: 'Esimesest tööst tänaseni', needs: ['fun'],
  },
] as const satisfies readonly PanelMeta[]

export type PanelId = (typeof PANEL_CATALOGUE)[number]['id']

export const PANEL_BY_ID: Record<string, PanelMeta> = Object.fromEntries(
  PANEL_CATALOGUE.map(p => [p.id, p as PanelMeta]),
)

export const KNOWN_PANEL_IDS: ReadonlySet<string> = new Set(PANEL_CATALOGUE.map(p => p.id))

/** Catalogue order, grouped, for the picker. */
export const PANEL_GROUPS: PanelGroup[] = ['raha', 'yhik', 'tootmine', 'inimesed', 'lobus']
