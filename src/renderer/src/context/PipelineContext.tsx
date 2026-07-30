import { createContext, useContext, useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { PIPELINE_STAGES, type PipelineStage } from '../config/pipeline'

const STORAGE_KEY = 'wivo_pipeline_v1'

// Palette for auto-assigned custom stage colours
const EXTRA_COLORS = [
  { color: 'text-purple-700', bg: 'bg-purple-100', border: 'border-purple-400', hex: '#A855F7' },
  { color: 'text-orange-700', bg: 'bg-orange-100', border: 'border-orange-400', hex: '#F97316' },
  { color: 'text-sky-700',    bg: 'bg-sky-100',    border: 'border-sky-400',    hex: '#0EA5E9' },
  { color: 'text-red-700',    bg: 'bg-red-100',    border: 'border-red-400',    hex: '#EF4444' },
  { color: 'text-lime-700',   bg: 'bg-lime-100',   border: 'border-lime-400',   hex: '#84CC16' },
  { color: 'text-yellow-700', bg: 'bg-yellow-100', border: 'border-yellow-400', hex: '#EAB308' },
  { color: 'text-cyan-700',   bg: 'bg-cyan-100',   border: 'border-cyan-400',   hex: '#06B6D4' },
  { color: 'text-rose-700',   bg: 'bg-rose-100',   border: 'border-rose-400',   hex: '#F43F5E' },
]

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20) || 'stage'
  )
}

function loadStages(): PipelineStage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as PipelineStage[]
      if (Array.isArray(parsed) && parsed.length >= 2) return parsed
    }
  } catch { /* ignore */ }
  return [...PIPELINE_STAGES]
}

// ─── Module-level store ───────────────────────────────────────────────────────
// Stages used to be Provider-local useState. They are now a module store for the
// same reason the settings are: the clinic sync layer has to be able to hydrate
// them from the database and push local edits back, and it cannot reach into a
// component's state to do it. `usePipeline()` is unchanged for every consumer.
let snapshot: PipelineStage[] = loadStages()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot(): PipelineStage[] {
  return snapshot
}

type StagePusher = (stages: PipelineStage[]) => void
let stagePusher: StagePusher | null = null

/** Registered by ClinicSettingsSync; absent before login and offline. */
export function setStagePusher(fn: StagePusher | null): void {
  stagePusher = fn
}

export function getStages(): PipelineStage[] {
  return snapshot
}

/** DB → local. Does not push back, or two clients would ping-pong forever. */
export function applyRemoteStages(stages: PipelineStage[]): void {
  // A pipeline needs at least a start and a done stage; a truncated remote list
  // would leave the board with nowhere to put jobs.
  if (!Array.isArray(stages) || stages.length < 2) return
  writeLocal(stages)
}

function writeLocal(next: PipelineStage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  snapshot = next
  listeners.forEach(fn => fn())
}

function commit(next: PipelineStage[]) {
  writeLocal(next)
  stagePusher?.(next)
}

interface PipelineContextValue {
  stages: PipelineStage[]
  stageMap: Record<string, PipelineStage>
  doneStageKey: string
  addStage: (label: string) => void
  removeStage: (key: string) => void
  renameStage: (key: string, newLabel: string) => void
  recolorStage: (key: string, hex: string) => void
  moveStage: (key: string, direction: 'up' | 'down') => void
  resetToDefaults: () => void
}

const PipelineContext = createContext<PipelineContextValue | null>(null)

export function PipelineProvider({ children }: { children: ReactNode }) {
  const stages = useSyncExternalStore(subscribe, getSnapshot)

  const addStage = useCallback((label: string) => {
    const prev = snapshot
    const baseKey = slugify(label)
    let key = baseKey
    let n = 1
    while (prev.some(s => s.key === key)) key = `${baseKey}_${n++}`
    const col = EXTRA_COLORS[(prev.length - 1) % EXTRA_COLORS.length]
    const newStage: PipelineStage = { key, label, ...col }
    // Insert before last stage (the "done" stage)
    commit([...prev.slice(0, -1), newStage, prev[prev.length - 1]])
  }, [])

  const removeStage = useCallback((key: string) => {
    const prev = snapshot
    if (prev.length <= 2) return  // keep at least 2 stages
    commit(prev.filter(s => s.key !== key))
  }, [])

  const renameStage = useCallback((key: string, newLabel: string) => {
    commit(snapshot.map(s => s.key === key ? { ...s, label: newLabel } : s))
  }, [])

  // Only `hex` is stored. The Tailwind class fields on PipelineStage are legacy —
  // a user-picked colour can never be a Tailwind class, so every consumer now
  // renders from hex via inline styles (see StatusPill).
  const recolorStage = useCallback((key: string, hex: string) => {
    commit(snapshot.map(s => (s.key === key ? { ...s, hex } : s)))
  }, [])

  const moveStage = useCallback((key: string, direction: 'up' | 'down') => {
    const prev = snapshot
    const idx = prev.findIndex(s => s.key === key)
    if (idx < 0) return
    if (direction === 'up'   && idx === 0)              return
    if (direction === 'down' && idx === prev.length - 1) return
    const next = [...prev]
    const swap = direction === 'up' ? idx - 1 : idx + 1
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    commit(next)
  }, [])

  const resetToDefaults = useCallback(() => commit([...PIPELINE_STAGES]), [])

  const stageMap = useMemo(
    () => Object.fromEntries(stages.map(s => [s.key, s])),
    [stages]
  )

  const doneStageKey = stages[stages.length - 1]?.key ?? 'valmis'

  const value = useMemo<PipelineContextValue>(
    () => ({ stages, stageMap, doneStageKey, addStage, removeStage, renameStage, recolorStage, moveStage, resetToDefaults }),
    [stages, stageMap, doneStageKey, addStage, removeStage, renameStage, recolorStage, moveStage, resetToDefaults]
  )

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext)
  if (!ctx) throw new Error('usePipeline must be used within PipelineProvider')
  return ctx
}
