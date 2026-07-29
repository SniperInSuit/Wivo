import { useCallback, useSyncExternalStore } from 'react'
import { MATERIAL_OPTIONS } from '../types/job'

// Bump key when structure changes so old storage is discarded cleanly
const STORAGE_KEY = 'workly_settings_v2'

export interface MaterialPricing {
  small: number   // €/tooth for positions 1–5 (incisors, canines, premolars)
  large: number   // €/tooth for positions 6–8 (molars)
}

export interface WorklySettings {
  materialPrices: Record<string, MaterialPricing>
  designFee: number       // € per job when design is included
  defaultMachine: string
  kasutajaNimi: string    // Sinu nimi — stamped as the author on patient notes
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
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot(): WorklySettings {
  return snapshot
}

function persist(next: WorklySettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
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

  const setKasutajaNimi = useCallback((nimi: string) => {
    setSettings(prev => {
      const next = { ...prev, kasutajaNimi: nimi }
      return next
    })
  }, [])

  return { settings, save, setMaterialPrice, setDesignFee, setDefaultMachine, setKasutajaNimi }
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
