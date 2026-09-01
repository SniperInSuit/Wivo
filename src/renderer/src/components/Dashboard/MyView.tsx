/**
 * "Minu vaade" — the panels this person chose, in the order they put them.
 *
 * Everything about which panels exist lives in `panels/catalogue.ts`; everything
 * about what they draw lives in `panels/render.tsx`; everything about what is
 * stored lives in `lib/uiPrefs.ts`. This file is only the wiring between them
 * and the period control it shares with the rest of the page.
 */
import { useMemo, useState } from 'react'
import { Sliders, Check, LayoutGrid } from 'lucide-react'
import type { Job } from '../../types/job'
import { useSettings } from '../../stores/useSettings'
import { usePermissions } from '../../hooks/usePermissions'
import {
  useDashboardPrefs, setDashboardPanels, reorderDashboard, addPanel, removePanel,
  resetDashboard, setPanelSize,
} from '../../stores/useUiPrefs'
import { KNOWN_PANEL_IDS, PANEL_BY_ID } from './panels/catalogue'
import { defaultPresetFor, PRESET_BY_KEY } from './panels/presets'
import { PanelGrid, visiblePanels, neededSlices, type VisibilityInput } from './PanelGrid'
import { PanelPicker } from './PanelPicker'
import { useStatsContext } from './useStatsContext'
import type { Period, DateRange } from './useDashboardStats'

interface MyViewProps {
  jobs: Job[]
  period: Period
  window: DateRange
  role: string | null
}

export function MyView({ jobs, period, window, role }: MyViewProps) {
  const { settings } = useSettings()
  const { can } = usePermissions()
  const stored = useDashboardPrefs()
  const [picking, setPicking] = useState(false)
  // Dragging and resizing live behind this, so the charts keep their tooltips
  // and the tables keep their scroll when nobody is rearranging anything.
  const [editing, setEditing] = useState(false)

  const visibility: VisibilityInput = useMemo(() => ({
    can,
    clinical: settings.kliinilineRezhiim,
    laboratory: settings.laboriRezhiim,
  }), [can, settings.kliinilineRezhiim, settings.laboriRezhiim])

  // No stored dashboard means "never customised", NOT "empty". The role default
  // applies and is deliberately not written back: two machines seeding
  // different defaults for one account is a race with no winner.
  const preset = defaultPresetFor(role)
  const ids: string[] = stored ? stored.panels : [...preset.panels]
  const presetKey = stored ? stored.preset : preset.key
  const sizes = stored?.sizes ?? {}

  const panels = useMemo(() => visiblePanels(ids, visibility), [ids, visibility])
  // Only the panels actually on screen decide what gets computed —
  // calculateFinance runs the pay engine three times per worker.
  const needs = useMemo(() => neededSlices(panels), [panels])
  const ctx = useStatsContext(jobs, period, window, needs)

  /** The ids this build can draw, which is what the picker reorders. */
  const knownSelected = useMemo(() => ids.filter(id => KNOWN_PANEL_IDS.has(id)), [ids])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-faint">
          {panels.length} paneeli · {presetKey ? PRESET_BY_KEY[presetKey]?.label ?? 'Kohandatud' : 'Kohandatud'}
          {editing && ' · lohista ümber või muuda suurust'}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setEditing(e => !e)}
            className={`btn-ghost text-xs border ${
              editing ? 'border-accent text-accent' : 'border-ink-faint/25'
            }`}
          >
            {editing ? <><Check size={13} /> Valmis</> : <><LayoutGrid size={13} /> Paiguta</>}
          </button>
          <button onClick={() => setPicking(true)} className="btn-ghost text-xs border border-ink-faint/25">
            <Sliders size={13} /> Kohanda
          </button>
        </div>
      </div>

      <PanelGrid
        panels={panels}
        ctx={ctx}
        sizes={sizes}
        editing={editing}
        onMove={next => {
          // The grid hands back the VISIBLE order. Panels filtered out by a
          // permission are not in it and must not be dropped from storage, so
          // the store folds this into the stored list rather than replacing it.
          if (!stored) setDashboardPanels(next, presetKey)
          else reorderDashboard(next, KNOWN_PANEL_IDS)
        }}
        onResize={(id, w, h) => {
          if (!stored) setDashboardPanels(ids, presetKey)
          setPanelSize(id, w, h)
        }}
        onRemove={id => {
          if (!stored) setDashboardPanels(ids.filter(p => p !== id), null)
          else removePanel(id)
        }}
      />

      {picking && (
        <PanelPicker
          selected={knownSelected}
          presetKey={presetKey}
          visibility={visibility}
          onClose={() => setPicking(false)}
          // Reordering hands back only the KNOWN ids; the store folds them into
          // the stored list so an id from a newer version keeps its place.
          onReorder={next => reorderDashboard(next, KNOWN_PANEL_IDS)}
          onAdd={id => {
            // First edit of an untouched dashboard has to materialise the
            // default before it can be added to, or the addition would be the
            // only panel left.
            if (!stored) setDashboardPanels([...ids, id], null)
            else addPanel(id)
          }}
          onRemove={id => {
            if (!stored) setDashboardPanels(ids.filter(p => p !== id), null)
            else removePanel(id)
          }}
          onPreset={key => {
            const p = PRESET_BY_KEY[key]
            if (p) setDashboardPanels([...p.panels], key)
          }}
          onReset={() => resetDashboard()}
        />
      )}

      {panels.length > 0 && (
        <p className="text-[10px] text-ink-faint leading-relaxed">
          Kõik paneelid kasutavad ülal valitud perioodi. Paneel, mille kohta sul õigust ei ole,
          ei ole nimekirjas ega renderdu — {PANEL_BY_ID['raha.kasum'].title.toLowerCase()} ja teised
          rahanumbrid nõuavad eraldi õigust.
        </p>
      )}
    </div>
  )
}
