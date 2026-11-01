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
import { GAUGE_METRICS, gaugePanelId } from './metrics'
import { t } from '@/lib/i18n'

export type PanelGroup = 'raha' | 'yhik' | 'tootmine' | 'inimesed' | 'lobus' | 'naidik'

export const PANEL_GROUP_LABEL: Record<PanelGroup, string> = {
  raha:     t('Raha ja kasum', 'Money and profit'),
  yhik:     t('Ühikumajandus', 'Unit economics'),
  tootmine: t('Tootmine ja tähtajad', 'Production and due dates'),
  inimesed: t('Kliendid ja inimesed', 'Clients and people'),
  // Not decoration. These are the questions people actually ask each other in a
  // lab, and a dashboard that can only answer the ones an accountant asks is a
  // dashboard nobody opens on a Friday.
  lobus:    t('Lõbus teada', 'Fun facts'),
  // Generated from GAUGE_METRICS rather than written out below — see
  // GAUGE_PANEL_METAS. The same number as a tile elsewhere, asked a different
  // question: not "what is it" but "is it where it should be".
  naidik:   t('Näidikud', 'Gauges'),
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
    id: 'raha.kasum', title: t('Kasum', 'Profit'), group: 'raha', defaultSize: [1, 1],
    hint: t('Tööde hinnad miinus tööjõud koos maksudega, materjal, fikseeritud kulud ja üldkulud', 'Job prices minus labour incl. taxes, materials, fixed costs and overheads'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kulud', title: t('Kulu kokku', 'Total cost'), group: 'raha', defaultSize: [1, 1],
    hint: t('Neli kulurida eraldi: tööjõud + maksud, materjal, fikseeritud, üldkulud', 'Four cost lines separately: labour + taxes, materials, fixed, overheads'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kate', title: t('Brutokate ja netokate', 'Gross and net margin'), group: 'raha', defaultSize: [1, 1],
    hint: t('Arveldatud miinus otsesed kulud; netokate lisaks miinus üldkulud', 'Invoiced minus direct costs; net margin also minus overheads'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kaive', title: t('Käive', 'Revenue'), group: 'raha', defaultSize: [1, 1],
    hint: t('Tööde hinnad koos muudatuste tasudega, kumbki oma kuupäeval', 'Job prices plus revision charges, each on its own date'),
    perm: 'payments.read',
  },
  {
    id: 'raha.arveldatud', title: t('Arveldatud', 'Invoiced'), group: 'raha', defaultSize: [1, 1],
    hint: t('Arvetele pandud, käibemaksuta', 'Put on invoices, excl. VAT'), perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.laekunud', title: t('Laekunud', 'Received'), group: 'raha', defaultSize: [1, 1],
    hint: t('Raha, mis perioodil päriselt saabus', 'Money that actually came in during the period'), perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.tasumata', title: t('Tasumata arvete järgi', 'Unpaid by invoice'), group: 'raha', defaultSize: [1, 1],
    hint: t('Väljastatud ja maksmata. Arveta tehtud töö siin ei kajastu', 'Issued and not paid. Work done without an invoice does not show here'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.arveldamata', title: t('Arveldamata', 'Not invoiced'), group: 'raha', defaultSize: [1, 1],
    hint: t('Valmis töö, millele ei ole arvet — kulu on kantud, tulu mitte', 'Finished work with no invoice — the cost is booked, the income is not'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.toojoukulu', title: t('Tööjõukulu + maksud', 'Labour cost + taxes'), group: 'raha', defaultSize: [1, 1],
    hint: t('Bruto (netolepingud üles arvutatud) + tööandja maksud + arve alusel', 'Gross (net contracts grossed up) + employer taxes + contractor invoices'),
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'raha.valjamakstud', title: t('Arvestatud vs välja makstud', 'Earned vs paid out'), group: 'raha', defaultSize: [1, 1],
    hint: t('Mida periood teenis ja mis on juba välja makstud', 'What the period earned and what has already been paid out'),
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'raha.kaive_kuude_kaupa', title: t('Käive kuude kaupa', 'Revenue by month'), group: 'raha', defaultSize: [2, 2],
    hint: t('Viimased kuud tulpadena', 'Recent months as bars'), perm: 'payments.read',
  },
  {
    id: 'raha.maksmise_viis', title: t('Maksmise viis', 'Payment method'), group: 'raha', defaultSize: [2, 2],
    hint: t('Sularaha, kaart, ülekanne — osakaaluga', 'Cash, card, bank transfer — with shares'), perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.muudatuste_kahju', title: t('Muudatuste kahju', 'Cost of revisions'), group: 'raha', defaultSize: [2, 2],
    hint: t('Ümbertegemise netokahju põhjuse kaupa', 'Net loss from remakes, by reason'), perm: 'payments.read', needs: ['finance'],
  },

  // ── Võlglased ──────────────────────────────────────────────────────────────
  // All-time, not period-scoped, and each panel says so. A March bill is still
  // owed in September; a debt list that emptied itself with the date filter
  // would be a chasing list you cannot trust.
  {
    id: 'raha.volglased_kokku', title: t('Võlglased kokku', 'Debtors total'), group: 'raha', defaultSize: [1, 1],
    hint: t('Tasumata tööde väärtus kogu aja peale, ja kui palju sellest on üle tähtaja', 'Value of unpaid jobs over all time, and how much of it is overdue'),
    perm: 'payments.read', needs: ['debtors'],
  },
  {
    id: 'raha.volglased', title: t('Kes on võlgu', 'Who owes'), group: 'raha', defaultSize: [2, 2],
    hint: t('Klient või patsient, tasumata summa ja mitu päeva üle tähtaja', 'Client or patient, unpaid amount and days overdue'),
    perm: 'payments.read', needs: ['debtors'],
  },
  {
    id: 'raha.volg_vanus', title: t('Võla vanus', 'Debt age'), group: 'raha', defaultSize: [2, 2],
    hint: t('Üle tähtaja summad vanuse kaupa — arve maksetähtajast, mitte tänasest', 'Overdue amounts by age — from the invoice due date, not from today'),
    perm: 'payments.read', needs: ['debtors'],
  },

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  {
    id: 'yhik.hind_hamba_kohta', title: t('Hind hamba kohta', 'Price per tooth'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Käive jagatud hammastega — mõlemad koos muudatustega', 'Revenue divided by teeth — both including revisions'),
    perm: 'payments.read',
  },
  {
    id: 'yhik.tulu_too_kohta', title: t('Ø hind / töö', 'Ø price / job'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Käive jagatud sama ühikuarvuga, mida lugeja kokku loeb', 'Revenue divided by the same unit count the job counter uses'),
    perm: 'payments.read',
  },
  {
    id: 'yhik.kiirtoo_tasuvus', title: t('Kiirtöö tasuvus', 'Rush job payoff'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Kiirtööde osa käibest võrreldes nende osaga tööde arvust', 'Rush jobs’ share of revenue compared with their share of the job count'),
    perm: 'payments.read',
  },
  {
    id: 'yhik.kate_tootyybi_jargi', title: t('Kate töö tüübi järgi', 'Margin by work type'), group: 'yhik', defaultSize: [4, 2],
    hint: t('Tulu, kulu, tööjõud, materjal ja kate iga töötüübi kohta', 'Income, cost, labour, materials and margin for each work type'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'yhik.kahjumlikud', title: t('Kahjumlikud töö tüübid', 'Loss-making work types'), group: 'yhik', defaultSize: [2, 2],
    hint: t('Negatiivse kattega tüübid, halvim ees — number, mida keegi ise ei otsi', 'Types with a negative margin, worst first — a number nobody goes looking for'),
    perm: 'payments.read', needs: ['finance'],
  },

  // ── Tootmine ja tähtajad ───────────────────────────────────────────────────
  {
    id: 'toot.tood_kokku', title: t('Töid kokku', 'Jobs total'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Tööd ja muudatused, jaotus nähtaval', 'Jobs and revisions, with the split shown'),
  },
  {
    id: 'toot.hambaid', title: t('Hambaid toodetud', 'Teeth produced'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Originaal ja muudatus eraldi', 'Original and revision separately'),
  },
  {
    id: 'toot.tahtajast_yle', title: t('Tähtajast üle', 'Overdue'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Lõpetamata tööd, mille tähtaeg on möödas — hetkeseis', 'Unfinished jobs past their due date — as of now'),
  },
  {
    id: 'toot.labiaeg', title: t('Ø läbiaeg', 'Ø turnaround'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Päevi vastuvõtust tegeliku valmimiseni', 'Days from receipt to actual completion'),
  },
  {
    id: 'toot.muudatuste_maar', title: t('Revisjonimäär', 'Revision rate'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Muudatusega tööde osa kõigist töödest', 'Share of all jobs that had a revision'),
  },
  {
    id: 'toot.wip', title: t('Töös etappide kaupa', 'In progress by stage'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Praegu töös olevad tööd etapiti — hetkeseis, mitte periood', 'Jobs in progress right now, by stage — as of now, not the period'),
  },
  {
    id: 'toot.valmis_kuude_kaupa', title: t('Valmis tööd kuude kaupa', 'Finished jobs by month'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Läbilaskevõime joonena', 'Throughput as a line'),
  },
  {
    id: 'toot.muudatuste_pohjused', title: t('Muudatuste põhjused', 'Revision reasons'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Kaks põhjust ühel muudatusel loevad mõlemad — ribade summa ületab muudatuste arvu', 'Two reasons on one revision both count — the bars add up to more than the number of revisions'),
  },
  {
    id: 'toot.tooliigid', title: t('Mida kõige rohkem teeme', 'What we make most'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Töö liigid tehtud tööde arvu järgi, koos hammaste arvuga — mitte käibe järgi', 'Work types by number of jobs done, with the tooth count — not by revenue'),
  },
  {
    id: 'toot.tooliigid_hambad', title: t('Ühikuid töö liigi järgi', 'Units by work type'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Mitu krooni, silda, proteezi on päriselt tehtud — loetud tööosade, mitte tööde kaupa', 'How many crowns, bridges and dentures were actually made — counted by work item, not by job'),
  },
  {
    id: 'toot.materjalid', title: t('Tööd materjali järgi', 'Jobs by material'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Arv materjali kohta', 'Count per material'),
  },
  {
    id: 'toot.masinad', title: t('Masinate koormus', 'Machine load'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Tööd printeri kaupa', 'Jobs per printer'), feature: 'lab',
  },

  // ── Kliendid ja inimesed ───────────────────────────────────────────────────
  {
    id: 'inim.tootajad', title: t('Töötajate kaupa', 'By employee'), group: 'inimesed', defaultSize: [4, 2],
    hint: t('Tööd, hambad, arvestatud ja välja makstud inimese kohta', 'Jobs, teeth, earned and paid out per person'),
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'inim.tootaja_tootlikkus', title: t('Töötajate koormus', 'Employee workload'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('Tööd ja hambad inimese kohta — ilma rahata', 'Jobs and teeth per person — no money'),
    needs: ['finance'],
  },
  {
    id: 'inim.katvus', title: t('Andmete katvus', 'Data coverage'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('Mitmel valmis tööl puudub teostaja või omahind — iga kattenumbri usaldusväärsus', 'How many finished jobs lack an assignee or a cost price — how far each margin figure can be trusted'),
    needs: ['finance'],
  },
  {
    id: 'inim.patsiendid', title: t('Patsiendid', 'Patients'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('Kokku, uued, korduvad', 'Total, new, returning'), perm: 'patients.read', feature: 'clinical',
  },
  {
    id: 'inim.visiidid', title: t('Visiidid', 'Visits'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('Kokku, ei tulnud, keskmine kestus', 'Total, no-shows, average length'), perm: 'visits.read', feature: 'clinical',
  },
  {
    id: 'inim.arstid', title: t('Top suunavad arstid', 'Top referring dentists'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('Käibe järgi', 'By revenue'), perm: 'payments.read', feature: 'clinical',
  },

  // ── Raha: arvete pool ──────────────────────────────────────────────────────
  {
    id: 'raha.vanus', title: t('Võlgnevuse vanus', 'Outstanding by age'), group: 'raha', defaultSize: [2, 2],
    hint: t('Tasumata summa selle järgi, kui kaua ta on üle tähtaja olnud', 'Unpaid amount by how long it has been overdue'),
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.laekumisaeg', title: t('Keskmine laekumisaeg', 'Average time to payment'), group: 'raha', defaultSize: [1, 1],
    hint: t('Mitu päeva arve väljastamisest rahani. Ainult perioodil lõplikult tasutud arved', 'Days from issuing an invoice to the money. Only invoices paid in full in the period'),
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.kaibemaks', title: t('Käibemaks perioodis', 'VAT in the period'), group: 'raha', defaultSize: [1, 1],
    hint: t('Väljastatud arvete käibemaks — riigile, mitte tulu', 'VAT on issued invoices — owed to the state, not income'),
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.keskmine_arve', title: t('Keskmine arve', 'Average invoice'), group: 'raha', defaultSize: [1, 1],
    hint: t('Perioodil väljastatud arvete keskmine netosumma', 'Average net amount of invoices issued in the period'),
    perm: 'payments.read', needs: ['invoices'],
  },

  // ── Ühikumajandus: uued ────────────────────────────────────────────────────
  {
    id: 'yhik.kasum_too_kohta', title: t('Kasum töö kohta', 'Profit per job'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Kasum jagatud TÖÖDEGA — mitte tööosade ega muudatustega', 'Profit divided by JOBS — not by work items or revisions'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.kate_hamba_kohta', title: t('Kate hamba kohta', 'Margin per tooth'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Tulu miinus kulu, jagatud hammastega', 'Income minus cost, divided by teeth'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.kulu_hamba_kohta', title: t('Kulu hamba kohta', 'Cost per tooth'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Kogu kulu jagatud hammastega', 'Total cost divided by teeth'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.osakaalud', title: t('Kulude osakaal tulust', 'Costs as a share of income'), group: 'yhik', defaultSize: [2, 2],
    hint: t('Tööjõud, materjal ja üldkulud protsendina tööde väärtusest', 'Labour, materials and overheads as a percentage of job value'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.tulu_toopaeva_kohta', title: t('Tulu tööpäeva kohta', 'Income per working day'), group: 'yhik', defaultSize: [1, 1],
    hint: t('Käive jagatud möödunud tööpäevadega (E–R)', 'Revenue divided by working days so far (Mon–Fri)'),
    perm: 'payments.read', needs: ['unit'],
  },

  // ── Tootmine: uued ─────────────────────────────────────────────────────────
  {
    id: 'toot.tahtajaks', title: t('Tähtajaks valmis', 'Done on time'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Osa töödest, mis valmisid tähtajaks. Tähtajata tööd ei loe kummalegi poole', 'Share of jobs finished by their due date. Jobs with no due date count for neither side'),
    needs: ['flow'],
  },
  {
    id: 'toot.labiaeg_jaotus', title: t('Läbiaja jaotus', 'Turnaround spread'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Mediaan, 90. protsentiil, kiireim ja aeglaseim — keskmine üksi varjab saba', 'Median, 90th percentile, fastest and slowest — an average alone hides the tail'),
    needs: ['flow'],
  },
  {
    id: 'toot.tarne', title: t('Tarne seis', 'Delivery status'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Laboris, teel, üle antud — valmis töö ei ole veel kohale jõudnud töö', 'In the lab, on the way, handed over — finished work is not yet delivered work'),
    feature: 'lab', needs: ['flow'],
  },
  {
    id: 'toot.tarneaeg', title: t('Tarneaeg', 'Delivery time'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('Päevi valmimisest üleandmiseni', 'Days from completion to handover'), feature: 'lab', needs: ['flow'],
  },
  {
    id: 'toot.nadalapaevad', title: t('Koormus nädalapäeva järgi', 'Load by weekday'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('Mis päeval töö saabub ja mis päeval valmib', 'Which day work arrives and which day it is finished'), needs: ['flow'],
  },

  // ── Kliendid ───────────────────────────────────────────────────────────────
  {
    id: 'inim.kliendid_kaive', title: t('Top kliendid', 'Top clients'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('Milline praksis toob tööd ja raha. Kliendita tööd on „Määramata" all', 'Which practice brings work and money. Jobs without a client are under “Unassigned”'),
    perm: 'payments.read', needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.kliendid_seis', title: t('Kliendid perioodis', 'Clients in the period'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('Aktiivsed ja uued', 'Active and new'), needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.kliendid_magavad', title: t('Magavad kliendid', 'Dormant clients'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('Ei ole 90 päeva tellinud — nimekiri, millega helistada', 'No orders in 90 days — a list to ring round'),
    needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.maksedistsipliin', title: t('Klientide maksedistsipliin', 'Client payment discipline'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('Keskmine päevade arv arvest makseni, kliendi kaupa', 'Average days from invoice to payment, per client'),
    perm: 'payments.read', needs: ['customers'], feature: 'lab',
  },

  // ── Lõbus teada ────────────────────────────────────────────────────────────
  {
    id: 'fun.hambad_kokku', title: t('Hambaid kokku', 'Teeth total'), group: 'lobus', defaultSize: [1, 1],
    hint: t('Kogu aeg, koos ümbertegemistega — ja mitu suutäit see teeb', 'All time, remakes included — and how many mouthfuls that makes'),
    needs: ['fun'],
  },
  {
    id: 'fun.rekordid', title: t('Rekordid', 'Records'), group: 'lobus', defaultSize: [2, 2],
    hint: t('Suurim töö, tihedaim päev, kiireim ja aeglaseim läbiaeg', 'Biggest job, busiest day, fastest and slowest turnaround'),
    needs: ['fun', 'flow'],
  },
  {
    id: 'fun.seeria', title: t('Pikim veatu seeria', 'Longest clean streak'), group: 'lobus', defaultSize: [1, 1],
    hint: t('Mitu valmis tööd järjest ilma ühegi muudatuseta', 'How many finished jobs in a row without a single revision'), needs: ['fun'],
  },
  {
    id: 'fun.lemmikud', title: t('Lemmikud', 'Favourites'), group: 'lobus', defaultSize: [2, 2],
    hint: t('Sagedaseim värv, materjalide arv, hambakaardi katvus, lojaalseim patsient', 'Most common shade, number of materials, tooth chart coverage, most loyal patient'),
    needs: ['fun'],
  },
  {
    id: 'fun.tempo', title: t('Tempo', 'Pace'), group: 'lobus', defaultSize: [1, 1],
    hint: t('Nädalavahetusel valminud tööd ja kiirtööde osakaal', 'Jobs finished at the weekend and the share of rush jobs'), needs: ['fun'],
  },
  {
    id: 'fun.algus', title: t('Kaua me juba teeme', 'How long we’ve been at it'), group: 'lobus', defaultSize: [1, 1],
    hint: t('Esimesest tööst tänaseni', 'From the first job to today'), needs: ['fun'],
  },
] as const satisfies readonly PanelMeta[]

/**
 * Ids of the hand-written panels only.
 *
 * Kept narrow on purpose: `PANEL_RENDER` is typed `Record<PanelId, …>`, so a
 * panel added above without a renderer is a compile error. Gauges are drawn by
 * one renderer for all of them and are resolved separately — widening this
 * type to include them would throw that check away for the sixty-one panels
 * that still need it.
 */
export type PanelId = (typeof PANEL_CATALOGUE)[number]['id']

/**
 * One panel per gauge metric, generated.
 *
 * `[1, 2]` because a dial needs height more than width: the arc, the number
 * under it and the target line do not fit in a single row, and a gauge squashed
 * to one row renders as a number with a decoration around it.
 */
export const GAUGE_PANEL_METAS: PanelMeta[] = GAUGE_METRICS.map(m => ({
  id: gaugePanelId(m.key),
  title: t(`Näidik: ${m.label}`, `Gauge: ${m.label}`),
  hint: m.hint,
  group: 'naidik',
  defaultSize: [1, 2],
  perm: m.perm,
  needs: m.needs,
}))

/** Everything the picker can offer and the grid can draw. */
export const ALL_PANELS: PanelMeta[] = [
  ...(PANEL_CATALOGUE as readonly PanelMeta[]),
  ...GAUGE_PANEL_METAS,
]

export const PANEL_BY_ID: Record<string, PanelMeta> = Object.fromEntries(
  ALL_PANELS.map(p => [p.id, p]),
)

export const KNOWN_PANEL_IDS: ReadonlySet<string> = new Set(ALL_PANELS.map(p => p.id))

/** Catalogue order, grouped, for the picker. */
export const PANEL_GROUPS: PanelGroup[] = ['raha', 'yhik', 'tootmine', 'inimesed', 'lobus', 'naidik']
