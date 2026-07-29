import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { PIPELINE_STAGES, type PipelineStage } from '../config/pipeline'

const STORAGE_KEY = 'workly_pipeline_v1'

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

function saveStages(stages: PipelineStage[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stages))
}

interface PipelineContextValue {
  stages: PipelineStage[]
  stageMap: Record<string, PipelineStage>
  doneStageKey: string
  addStage: (label: string) => void
  removeStage: (key: string) => void
  renameStage: (key: string, newLabel: string) => void
  moveStage: (key: string, direction: 'up' | 'down') => void
  resetToDefaults: () => void
}

const PipelineContext = createContext<PipelineContextValue | null>(null)

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [stages, setStages] = useState<PipelineStage[]>(loadStages)

  const update = useCallback((next: PipelineStage[]) => {
    setStages(next)
    saveStages(next)
  }, [])

  const addStage = useCallback((label: string) => {
    setStages(prev => {
      const baseKey = slugify(label)
      let key = baseKey
      let n = 1
      while (prev.some(s => s.key === key)) key = `${baseKey}_${n++}`
      const colorIdx = (prev.length - 1) % EXTRA_COLORS.length
      const col = EXTRA_COLORS[colorIdx]
      const newStage: PipelineStage = { key, label, ...col }
      // Insert before last stage (the "done" stage)
      const next = [...prev.slice(0, -1), newStage, prev[prev.length - 1]]
      saveStages(next)
      return next
    })
  }, [])

  const removeStage = useCallback((key: string) => {
    setStages(prev => {
      if (prev.length <= 2) return prev  // keep at least 2 stages
      const next = prev.filter(s => s.key !== key)
      saveStages(next)
      return next
    })
  }, [])

  const renameStage = useCallback((key: string, newLabel: string) => {
    setStages(prev => {
      const next = prev.map(s => s.key === key ? { ...s, label: newLabel } : s)
      saveStages(next)
      return next
    })
  }, [])

  const moveStage = useCallback((key: string, direction: 'up' | 'down') => {
    setStages(prev => {
      const idx = prev.findIndex(s => s.key === key)
      if (idx < 0) return prev
      if (direction === 'up'   && idx === 0)              return prev
      if (direction === 'down' && idx === prev.length - 1) return prev
      const next = [...prev]
      const swap = direction === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      saveStages(next)
      return next
    })
  }, [])

  const resetToDefaults = useCallback(() => update([...PIPELINE_STAGES]), [update])

  const stageMap = useMemo(
    () => Object.fromEntries(stages.map(s => [s.key, s])),
    [stages]
  )

  const doneStageKey = stages[stages.length - 1]?.key ?? 'valmis'

  const value = useMemo<PipelineContextValue>(
    () => ({ stages, stageMap, doneStageKey, addStage, removeStage, renameStage, moveStage, resetToDefaults }),
    [stages, stageMap, doneStageKey, addStage, removeStage, renameStage, moveStage, resetToDefaults]
  )

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext)
  if (!ctx) throw new Error('usePipeline must be used within PipelineProvider')
  return ctx
}
