/**
 * Role starting points.
 *
 * A preset is a LIST, not a mode. Applying one replaces the visible panels and
 * records where they came from; the next edit is free and clears the label to
 * "Kohandatud". Nothing downstream ever re-derives a layout from a preset, so a
 * preset changing in a later version cannot rearrange somebody's dashboard.
 *
 * `Tootmine` and `Rahandus` exist so that nobody loses the view they know when
 * the old tabs go away.
 */
import type { PanelId } from './catalogue'
import { t } from '@/lib/i18n'

export interface Preset {
  key: string
  label: string
  hint: string
  panels: readonly PanelId[]
}

export const PRESETS: readonly Preset[] = [
  {
    key: 'juht',
    label: t('Juht', 'Manager'),
    hint: t('Kas me teenime, ja kas töö liigub', 'Are we making money, and is the work moving'),
    panels: [
      'raha.kasum', 'raha.kaive', 'raha.laekunud', 'raha.arveldamata',
      'yhik.kasum_too_kohta', 'toot.tood_kokku', 'toot.tahtajaks', 'toot.muudatuste_maar',
      'raha.kaive_kuude_kaupa', 'inim.kliendid_kaive',
    ],
  },
  {
    key: 'finantsjuht',
    label: t('Finantsjuht', 'Finance manager'),
    hint: t('Kus raha on ja kust see lekib', 'Where the money is and where it leaks'),
    panels: [
      'raha.kasum', 'raha.kulud', 'raha.kate', 'raha.arveldatud',
      'raha.laekunud', 'raha.tasumata', 'raha.arveldamata', 'raha.laekumisaeg',
      'raha.kaibemaks', 'yhik.kasum_too_kohta', 'yhik.kate_hamba_kohta',
      'raha.vanus', 'yhik.osakaalud',
      'raha.maksmise_viis', 'inim.maksedistsipliin',
      'yhik.kate_tootyybi_jargi', 'yhik.kahjumlikud', 'inim.katvus',
    ],
  },
  {
    key: 'tootmisjuht',
    label: t('Tootmisjuht', 'Production manager'),
    hint: t('Kas pink jõuab järele', 'Is the bench keeping up'),
    panels: [
      'toot.tood_kokku', 'toot.hambaid', 'toot.tahtajaks', 'toot.tarne',
      'toot.muudatuste_maar', 'toot.masinad',
      'toot.wip', 'toot.labiaeg_jaotus', 'toot.nadalapaevad',
      'toot.valmis_kuude_kaupa', 'toot.muudatuste_pohjused', 'toot.materjalid',
      'inim.tootaja_tootlikkus',
    ],
  },
  {
    key: 'tehnik',
    label: t('Tehnik', 'Technician'),
    hint: t('Minu töö — ilma rahata', 'My work — no money'),
    // No money panel by construction, not merely by permission: a technician
    // who was granted payments.read by accident should still get a sane view.
    panels: [
      'toot.tood_kokku', 'toot.hambaid', 'toot.tahtajast_yle', 'toot.muudatuste_maar',
      'toot.wip', 'toot.muudatuste_pohjused', 'toot.masinad',
    ],
  },
  {
    key: 'lobus',
    label: t('Lõbus', 'Fun'),
    hint: t('Numbrid, mille pärast keegi ei plaani midagi ümber', 'Numbers nobody changes any plans over'),
    panels: [
      'fun.hambad_kokku', 'fun.seeria', 'fun.tempo', 'fun.algus',
      'fun.rekordid', 'fun.lemmikud',
      'toot.hambaid', 'toot.materjalid',
    ],
  },
  {
    key: 'tootmine',
    label: t('Tootmine', 'Production'),
    hint: t('Vana Tootmine-vahekaart', 'The old Production tab'),
    panels: [
      'toot.tood_kokku', 'toot.hambaid', 'toot.tahtajast_yle', 'toot.muudatuste_maar',
      'raha.kaive', 'raha.laekunud', 'yhik.tulu_too_kohta', 'yhik.kiirtoo_tasuvus',
      'raha.kaive_kuude_kaupa', 'toot.materjalid', 'toot.wip', 'toot.valmis_kuude_kaupa',
      'toot.muudatuste_pohjused', 'inim.patsiendid', 'inim.visiidid', 'inim.arstid',
    ],
  },
  {
    key: 'rahandus',
    label: t('Rahandus', 'Finance'),
    hint: t('Vana Rahandus-vahekaart', 'The old Finance tab'),
    panels: [
      'raha.kasum', 'raha.kulud', 'raha.arveldatud', 'raha.laekunud',
      'raha.tasumata', 'raha.arveldamata', 'raha.toojoukulu', 'raha.valjamakstud',
      'yhik.kate_tootyybi_jargi', 'raha.muudatuste_kahju', 'raha.maksmise_viis',
      'inim.tootajad',
    ],
  },
]

export const PRESET_BY_KEY: Record<string, Preset> = Object.fromEntries(
  PRESETS.map(p => [p.key, p]),
)

/**
 * What somebody sees before they have chosen anything.
 *
 * An owner opens on the manager's view; anyone else on the technician's, which
 * contains no money at all. That is a deliberately conservative default: a
 * worker with `payments.read` can add the money panels in two clicks, and one
 * without it would only have seen them filtered away anyway.
 */
export function defaultPresetFor(role: string | null): Preset {
  return role === 'owner' ? PRESET_BY_KEY.juht : PRESET_BY_KEY.tehnik
}
