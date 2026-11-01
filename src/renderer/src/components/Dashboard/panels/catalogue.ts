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
  raha:     t('dashboard.moneyAndProfit'),
  yhik:     t('dashboard.unitEconomics'),
  tootmine: t('dashboard.productionAndDueDates'),
  inimesed: t('dashboard.clientsAndPeople'),
  // Not decoration. These are the questions people actually ask each other in a
  // lab, and a dashboard that can only answer the ones an accountant asks is a
  // dashboard nobody opens on a Friday.
  lobus:    t('dashboard.funFacts'),
  // Generated from GAUGE_METRICS rather than written out below — see
  // GAUGE_PANEL_METAS. The same number as a tile elsewhere, asked a different
  // question: not "what is it" but "is it where it should be".
  naidik:   t('dashboard.gauges'),
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
    id: 'raha.kasum', title: t('dashboard.profit'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.jobPricesMinusLabourInclTaxes'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kulud', title: t('dashboard.totalCost'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.fourCostLinesSeparatelyLabourTaxes'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kate', title: t('dashboard.grossAndNetMargin'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.invoicedMinusDirectCostsNetMargin'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.kaive', title: t('dashboard.revenue'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.jobPricesPlusRevisionChargesEach'),
    perm: 'payments.read',
  },
  {
    id: 'raha.arveldatud', title: t('dashboard.invoiced'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.putOnInvoicesExclVAT'), perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.laekunud', title: t('dashboard.received'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.moneyThatActuallyCameInDuring'), perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.tasumata', title: t('dashboard.unpaidByInvoice'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.issuedAndNotPaidWorkDone'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.arveldamata', title: t('dashboard.notInvoiced'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.finishedWorkWithNoInvoiceThe'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.toojoukulu', title: t('dashboard.labourCostTaxes'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.grossNetContractsGrossedUpEmployer'),
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'raha.valjamakstud', title: t('dashboard.earnedVsPaidOut'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.whatThePeriodEarnedAndWhat'),
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'raha.kaive_kuude_kaupa', title: t('dashboard.revenueByMonth2'), group: 'raha', defaultSize: [2, 2],
    hint: t('dashboard.recentMonthsAsBars'), perm: 'payments.read',
  },
  {
    id: 'raha.maksmise_viis', title: t('dashboard.paymentMethod'), group: 'raha', defaultSize: [2, 2],
    hint: t('dashboard.cashCardBankTransferWithShares'), perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'raha.muudatuste_kahju', title: t('dashboard.costOfRevisions'), group: 'raha', defaultSize: [2, 2],
    hint: t('dashboard.netLossFromRemakesByReason'), perm: 'payments.read', needs: ['finance'],
  },

  // ── Võlglased ──────────────────────────────────────────────────────────────
  // All-time, not period-scoped, and each panel says so. A March bill is still
  // owed in September; a debt list that emptied itself with the date filter
  // would be a chasing list you cannot trust.
  {
    id: 'raha.volglased_kokku', title: t('dashboard.debtorsTotal'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.valueOfUnpaidJobsOverAll'),
    perm: 'payments.read', needs: ['debtors'],
  },
  {
    id: 'raha.volglased', title: t('dashboard.whoOwes'), group: 'raha', defaultSize: [2, 2],
    hint: t('dashboard.clientOrPatientUnpaidAmountAnd'),
    perm: 'payments.read', needs: ['debtors'],
  },
  {
    id: 'raha.volg_vanus', title: t('dashboard.debtAge'), group: 'raha', defaultSize: [2, 2],
    hint: t('dashboard.overdueAmountsByAgeFromThe'),
    perm: 'payments.read', needs: ['debtors'],
  },

  // ── Ühikumajandus ──────────────────────────────────────────────────────────
  {
    id: 'yhik.hind_hamba_kohta', title: t('dashboard.pricePerTooth'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.revenueDividedByTeethBothIncluding'),
    perm: 'payments.read',
  },
  {
    id: 'yhik.tulu_too_kohta', title: t('dashboard.priceJob'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.revenueDividedByTheSameUnit'),
    perm: 'payments.read',
  },
  {
    id: 'yhik.kiirtoo_tasuvus', title: t('dashboard.rushJobPayoff'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.rushJobsShareOfRevenueCompared'),
    perm: 'payments.read',
  },
  {
    id: 'yhik.kate_tootyybi_jargi', title: t('dashboard.marginByWorkType'), group: 'yhik', defaultSize: [4, 2],
    hint: t('dashboard.incomeCostLabourMaterialsAndMargin'),
    perm: 'payments.read', needs: ['finance'],
  },
  {
    id: 'yhik.kahjumlikud', title: t('dashboard.lossMakingWorkTypes'), group: 'yhik', defaultSize: [2, 2],
    hint: t('dashboard.typesWithANegativeMarginWorst'),
    perm: 'payments.read', needs: ['finance'],
  },

  // ── Tootmine ja tähtajad ───────────────────────────────────────────────────
  {
    id: 'toot.tood_kokku', title: t('dashboard.jobsTotal'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.jobsAndRevisionsWithTheSplit'),
  },
  {
    id: 'toot.hambaid', title: t('dashboard.teethProduced'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.originalAndRevisionSeparately'),
  },
  {
    id: 'toot.tahtajast_yle', title: t('dashboard.overdue3'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.unfinishedJobsPastTheirDueDate'),
  },
  {
    id: 'toot.labiaeg', title: t('dashboard.turnaround'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.daysFromReceiptToActualCompletion'),
  },
  {
    id: 'toot.muudatuste_maar', title: t('dashboard.revisionRate'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.shareOfAllJobsThatHad'),
  },
  {
    id: 'toot.wip', title: t('dashboard.inProgressByStage'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.jobsInProgressRightNowBy'),
  },
  {
    id: 'toot.valmis_kuude_kaupa', title: t('dashboard.finishedJobsByMonth'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.throughputAsALine'),
  },
  {
    id: 'toot.muudatuste_pohjused', title: t('dashboard.revisionReasons'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.twoReasonsOnOneRevisionBoth'),
  },
  {
    id: 'toot.tooliigid', title: t('dashboard.whatWeMakeMost'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.workTypesByNumberOfJobs'),
  },
  {
    id: 'toot.tooliigid_hambad', title: t('dashboard.unitsByWorkType'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.howManyCrownsBridgesAndDentures'),
  },
  {
    id: 'toot.materjalid', title: t('dashboard.jobsByMaterial'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.countPerMaterial'),
  },
  {
    id: 'toot.masinad', title: t('dashboard.machineLoad'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.jobsPerPrinter'), feature: 'lab',
  },

  // ── Kliendid ja inimesed ───────────────────────────────────────────────────
  {
    id: 'inim.tootajad', title: t('dashboard.byEmployee'), group: 'inimesed', defaultSize: [4, 2],
    hint: t('dashboard.jobsTeethEarnedAndPaidOut'),
    perm: 'payroll.manage', needs: ['finance'],
  },
  {
    id: 'inim.tootaja_tootlikkus', title: t('dashboard.employeeWorkload'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('dashboard.jobsAndTeethPerPersonNo'),
    needs: ['finance'],
  },
  {
    id: 'inim.katvus', title: t('dashboard.dataCoverage'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('dashboard.howManyFinishedJobsLackAn'),
    needs: ['finance'],
  },
  {
    id: 'inim.patsiendid', title: t('dashboard.patients'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('dashboard.totalNewReturning'), perm: 'patients.read', feature: 'clinical',
  },
  {
    id: 'inim.visiidid', title: t('dashboard.visits'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('dashboard.totalNoShowsAverageLength'), perm: 'visits.read', feature: 'clinical',
  },
  {
    id: 'inim.arstid', title: t('dashboard.topReferringDentists'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('dashboard.byRevenue'), perm: 'payments.read', feature: 'clinical',
  },

  // ── Raha: arvete pool ──────────────────────────────────────────────────────
  {
    id: 'raha.vanus', title: t('dashboard.outstandingByAge'), group: 'raha', defaultSize: [2, 2],
    hint: t('dashboard.unpaidAmountByHowLongIt'),
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.laekumisaeg', title: t('dashboard.averageTimeToPayment'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.daysFromIssuingAnInvoiceTo'),
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.kaibemaks', title: t('dashboard.vATInThePeriod'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.vATOnIssuedInvoicesOwedTo'),
    perm: 'payments.read', needs: ['invoices'],
  },
  {
    id: 'raha.keskmine_arve', title: t('dashboard.averageInvoice'), group: 'raha', defaultSize: [1, 1],
    hint: t('dashboard.averageNetAmountOfInvoicesIssued'),
    perm: 'payments.read', needs: ['invoices'],
  },

  // ── Ühikumajandus: uued ────────────────────────────────────────────────────
  {
    id: 'yhik.kasum_too_kohta', title: t('dashboard.profitPerJob'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.profitDividedByJOBSNotBy'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.kate_hamba_kohta', title: t('dashboard.marginPerTooth'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.incomeMinusCostDividedByTeeth'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.kulu_hamba_kohta', title: t('dashboard.costPerTooth'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.totalCostDividedByTeeth'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.osakaalud', title: t('dashboard.costsAsAShareOfIncome'), group: 'yhik', defaultSize: [2, 2],
    hint: t('dashboard.labourMaterialsAndOverheadsAsA'),
    perm: 'payments.read', needs: ['unit'],
  },
  {
    id: 'yhik.tulu_toopaeva_kohta', title: t('dashboard.incomePerWorkingDay'), group: 'yhik', defaultSize: [1, 1],
    hint: t('dashboard.revenueDividedByWorkingDaysSo'),
    perm: 'payments.read', needs: ['unit'],
  },

  // ── Tootmine: uued ─────────────────────────────────────────────────────────
  {
    id: 'toot.tahtajaks', title: t('dashboard.doneOnTime'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.shareOfJobsFinishedByTheir'),
    needs: ['flow'],
  },
  {
    id: 'toot.labiaeg_jaotus', title: t('dashboard.turnaroundSpread'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.median90thPercentileFastestAndSlowest'),
    needs: ['flow'],
  },
  {
    id: 'toot.tarne', title: t('dashboard.deliveryStatus'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.inTheLabOnTheWay'),
    feature: 'lab', needs: ['flow'],
  },
  {
    id: 'toot.tarneaeg', title: t('dashboard.deliveryTime'), group: 'tootmine', defaultSize: [1, 1],
    hint: t('dashboard.daysFromCompletionToHandover'), feature: 'lab', needs: ['flow'],
  },
  {
    id: 'toot.nadalapaevad', title: t('dashboard.loadByWeekday'), group: 'tootmine', defaultSize: [2, 2],
    hint: t('dashboard.whichDayWorkArrivesAndWhich'), needs: ['flow'],
  },

  // ── Kliendid ───────────────────────────────────────────────────────────────
  {
    id: 'inim.kliendid_kaive', title: t('dashboard.topClients'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('dashboard.whichPracticeBringsWorkAndMoney'),
    perm: 'payments.read', needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.kliendid_seis', title: t('dashboard.clientsInThePeriod'), group: 'inimesed', defaultSize: [1, 1],
    hint: t('dashboard.activeAndNew'), needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.kliendid_magavad', title: t('dashboard.dormantClients'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('dashboard.noOrdersIn90DaysA'),
    needs: ['customers'], feature: 'lab',
  },
  {
    id: 'inim.maksedistsipliin', title: t('dashboard.clientPaymentDiscipline'), group: 'inimesed', defaultSize: [2, 2],
    hint: t('dashboard.averageDaysFromInvoiceToPayment'),
    perm: 'payments.read', needs: ['customers'], feature: 'lab',
  },

  // ── Lõbus teada ────────────────────────────────────────────────────────────
  {
    id: 'fun.hambad_kokku', title: t('dashboard.teethTotal'), group: 'lobus', defaultSize: [1, 1],
    hint: t('dashboard.allTimeRemakesIncludedAndHow'),
    needs: ['fun'],
  },
  {
    id: 'fun.rekordid', title: t('dashboard.records'), group: 'lobus', defaultSize: [2, 2],
    hint: t('dashboard.biggestJobBusiestDayFastestAnd'),
    needs: ['fun', 'flow'],
  },
  {
    id: 'fun.seeria', title: t('dashboard.longestCleanStreak'), group: 'lobus', defaultSize: [1, 1],
    hint: t('dashboard.howManyFinishedJobsInA'), needs: ['fun'],
  },
  {
    id: 'fun.lemmikud', title: t('dashboard.favourites'), group: 'lobus', defaultSize: [2, 2],
    hint: t('dashboard.mostCommonShadeNumberOfMaterials'),
    needs: ['fun'],
  },
  {
    id: 'fun.tempo', title: t('dashboard.pace'), group: 'lobus', defaultSize: [1, 1],
    hint: t('dashboard.jobsFinishedAtTheWeekendAnd'), needs: ['fun'],
  },
  {
    id: 'fun.algus', title: t('dashboard.howLongWeVeBeenAt'), group: 'lobus', defaultSize: [1, 1],
    hint: t('dashboard.fromTheFirstJobToToday'), needs: ['fun'],
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
  title: t('dashboard.gauge', { label: m.label }),
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
