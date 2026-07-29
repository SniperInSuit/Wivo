import { useCallback, useSyncExternalStore } from 'react'
import { MATERIAL_OPTIONS } from '../types/job'

// Bump key when structure changes so old storage is discarded cleanly
const STORAGE_KEY = 'workly_settings_v2'

export interface MaterialPricing {
  small: number   // €/tooth for positions 1–5 (incisors, canines, premolars)
  large: number   // €/tooth for positions 6–8 (molars)
}

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

export interface WorklySettings {
  materialPrices: Record<string, MaterialPricing>
  designFee: number       // € per job when design is included
  defaultMachine: string
  kasutajaNimi: string    // Sinu nimi — stamped as the author on patient notes
  teema: ThemeKey         // Teema — see THEMES / styles/index.css
  ribaLaiendatud: boolean // Külgriba laiendatud (sildid ikoonide kõrval) või kompaktne
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
  hambaHind: number       // Vaikimisi €/hammas, kui materjalil hinda pole
  muudatusHambaHind: number // €/hammas muudatuse puhul
  kiirtooKordaja: number  // Kiirtöö hinnakordaja
}

const EMPTY_MATERIAL: MaterialPricing = { small: 0, large: 0 }
const DEFAULT_MATERIAL: MaterialPricing = { small: 15, large: 15 }

function defaultSettings(): WorklySettings {
  return {
    materialPrices: Object.fromEntries(
      MATERIAL_OPTIONS.map(m => [m, { ...DEFAULT_MATERIAL }])
    ),
    designFee: 0,
    defaultMachine: '',
    kasutajaNimi: '',
    teema: 'hele',
    ribaLaiendatud: true,
    ajajoonAlgus: 7,
    ajajoonLopp: 19,
    nadalAlgus: 9,
    nadalLopp: 18,
    ajaSamm: 15,
    visiidiKestus: 30,
    hambaHind: 15,
    muudatusHambaHind: 8,
    kiirtooKordaja: 2,
  }
}

function loadSettings(): WorklySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const stored = JSON.parse(raw) as Partial<WorklySettings>
    const def = defaultSettings()
    // Merge: stored values win, but new materials not in storage get the default 15€.
    // This is also why STORAGE_KEY is NOT bumped for additive fields like
    // kasutajaNimi — a bump would wipe every material price the user has entered.
    return {
      materialPrices: { ...def.materialPrices, ...(stored.materialPrices ?? {}) },
      designFee: stored.designFee ?? 0,
      defaultMachine: stored.defaultMachine ?? '',
      kasutajaNimi: stored.kasutajaNimi ?? '',
      teema: stored.teema ?? 'hele',
      ribaLaiendatud: stored.ribaLaiendatud ?? true,
      ajajoonAlgus: stored.ajajoonAlgus ?? 7,
      ajajoonLopp: stored.ajajoonLopp ?? 19,
      nadalAlgus: stored.nadalAlgus ?? 9,
      nadalLopp: stored.nadalLopp ?? 18,
      ajaSamm: stored.ajaSamm ?? 15,
      visiidiKestus: stored.visiidiKestus ?? 30,
      hambaHind: stored.hambaHind ?? 15,
      muudatusHambaHind: stored.muudatusHambaHind ?? 8,
      kiirtooKordaja: stored.kiirtooKordaja ?? 2,
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
let snapshot: WorklySettings = loadSettings()
applyTheme(snapshot.teema)
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot(): WorklySettings {
  return snapshot
}

// The stylesheet keys off <html data-theme>, so applying is a one-liner. Done
// here rather than in a component effect so the theme is right before first paint.
function applyTheme(theme: ThemeKey) {
  document.documentElement.dataset.theme = theme
}

function persist(next: WorklySettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  applyTheme(next.teema)
  // New object identity every write — useSyncExternalStore compares by reference
  snapshot = next
  listeners.forEach(fn => fn())
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot)

  // Every setter goes through persist(), which is what notifies subscribers.
  const setSettings = useCallback((fn: (prev: WorklySettings) => WorklySettings) => {
    persist(fn(snapshot))
  }, [])

  const save = useCallback((next: WorklySettings) => {
    persist(next)
  }, [])

  const setMaterialPrice = useCallback(
    (material: string, field: keyof MaterialPricing, value: number) => {
      setSettings(prev => {
        const next: WorklySettings = {
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
      })
    },
    []
  )

  const setDesignFee = useCallback((fee: number) => {
    setSettings(prev => {
      const next = { ...prev, designFee: fee }
      return next
    })
  }, [])

  const setDefaultMachine = useCallback((machine: string) => {
    setSettings(prev => {
      const next = { ...prev, defaultMachine: machine }
      return next
    })
  }, [])

  const setTeema = useCallback((teema: ThemeKey) => {
    setSettings(prev => ({ ...prev, teema }))
  }, [setSettings])

  const toggleRiba = useCallback(() => {
    setSettings(prev => ({ ...prev, ribaLaiendatud: !prev.ribaLaiendatud }))
  }, [setSettings])

  // Generic numeric setter for the calendar/pricing fields — one function beats
  // ten near-identical ones, and every write still goes through persist().
  const setNumber = useCallback(<K extends keyof WorklySettings>(key: K, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value } as WorklySettings))
  }, [setSettings])

  const setKasutajaNimi = useCallback((nimi: string) => {
    setSettings(prev => {
      const next = { ...prev, kasutajaNimi: nimi }
      return next
    })
  }, [])

  return { settings, save, setMaterialPrice, setDesignFee, setDefaultMachine, setKasutajaNimi, setTeema, toggleRiba, setNumber }
}

// ─── Tooth-size helpers ───────────────────────────────────────────────────────
// FDI last digit gives position 1–8; 6–8 are molars (large)
export function countSmallTeeth(hambad: string): number {
  return hambad.split(',').filter(t => {
    const pos = parseInt(t.trim()) % 10
    return pos >= 1 && pos <= 5
  }).length
}

export function countLargeTeeth(hambad: string): number {
  return hambad.split(',').filter(t => {
    const pos = parseInt(t.trim()) % 10
    return pos >= 6
  }).length
}

export function calcProduction(
  hambad: string,
  material: string,
  prices: Record<string, MaterialPricing>
): number {
  const p = prices[material]
  if (!p) return 0
  return countSmallTeeth(hambad) * p.small + countLargeTeeth(hambad) * p.large
}
