import { useState, useCallback } from 'react'
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
  }
}

function loadSettings(): WorklySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const stored = JSON.parse(raw) as Partial<WorklySettings>
    const def = defaultSettings()
    // Merge: stored values win, but new materials not in storage get the default 15€
    return {
      materialPrices: { ...def.materialPrices, ...(stored.materialPrices ?? {}) },
      designFee: stored.designFee ?? 0,
      defaultMachine: stored.defaultMachine ?? '',
    }
  } catch {
    return defaultSettings()
  }
}

function persist(next: WorklySettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function useSettings() {
  const [settings, setSettings] = useState<WorklySettings>(loadSettings)

  const save = useCallback((next: WorklySettings) => {
    persist(next)
    setSettings(next)
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
        persist(next)
        return next
      })
    },
    []
  )

  const setDesignFee = useCallback((fee: number) => {
    setSettings(prev => {
      const next = { ...prev, designFee: fee }
      persist(next)
      return next
    })
  }, [])

  const setDefaultMachine = useCallback((machine: string) => {
    setSettings(prev => {
      const next = { ...prev, defaultMachine: machine }
      persist(next)
      return next
    })
  }, [])

  return { settings, save, setMaterialPrice, setDesignFee, setDefaultMachine }
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
