/**
 * The tooth chart — whichever one the user chose.
 *
 * ── Why a wrapper and not a drop-in ─────────────────────────────────────────
 * There are four places that render a chart. A drop-in with matching props
 * would mean each of them reading the preference and each of them drawing the
 * 2D/3D toggle. The wrapper is the ONE place the preference is read and the
 * one place the toggle lives, so all four switch together and none of them
 * learns that a second renderer exists.
 *
 * ── Why 3D is behind `lazy` ─────────────────────────────────────────────────
 * three.js is roughly 650 KB of JavaScript. Electron reads it off a local disk
 * so the download is free, but PARSING it is not, and it would be paid on every
 * cold start by everybody — including the majority who never open the 3D view.
 * Behind `lazy` the cost is paid once, by the person who asked for it.
 *
 * ── Falling back is silent, and does not overwrite the preference ───────────
 * Locked-down desktops, virtual machines and RDP sessions can refuse a WebGL
 * context outright, and a build can ship without the model. Both end the same
 * way: draw the 2D chart and say nothing, because 2D is the default anyway and
 * nobody is missing something they asked for.
 *
 * What we must NOT do is save `flat` on their behalf. The user asked for 3D;
 * this MACHINE cannot do it. Writing the preference back would mean their
 * laptop, or this same PC after a driver update, silently never offers it again
 * — a preference quietly rewritten by a machine is close to impossible to
 * diagnose from the outside.
 */
import { lazy, Suspense, useCallback, useState } from 'react'
import { MultiOdontogramPicker } from '../JobDetail/MultiOdontogramPicker'
import { useOdontogramView, setOdontogramView } from '../../stores/useUiPrefs'
import { webglAvailable } from './odontogram3dCore'
import type { ToothPickerProps } from './toothPickerProps'

const Odontogram3D = lazy(() =>
  import('./Odontogram3D').then(m => ({ default: m.Odontogram3D })),
)

/**
 * Probed once per session, not per render.
 *
 * `webglAvailable` creates a real canvas and asks it for a context. Doing that
 * on every render of every chart is a small leak of its own, and the answer
 * cannot change while the app is running.
 */
let probed: boolean | null = null
const machineCanDraw3d = (): boolean => (probed ??= webglAvailable())

export interface ToothPickerWrapperProps extends ToothPickerProps {
  /**
   * Set false where a second renderer would not fit — a narrow wizard column,
   * say. Reversible, and it keeps that decision at the call site rather than
   * inside the chart.
   */
  allow3d?: boolean
}

export function ToothPicker({ allow3d = true, ...props }: ToothPickerWrapperProps) {
  const stored = useOdontogramView()
  const [unavailable, setUnavailable] = useState(false)

  const offer3d = allow3d && !unavailable && machineCanDraw3d()
  const show3d = offer3d && stored === '3d'

  // Deliberately does not call `setOdontogramView('flat')` — see the header.
  const giveUp = useCallback(() => setUnavailable(true), [])

  return (
    <div className="space-y-2">
      {offer3d && (
        <div className="flex justify-end gap-1">
          <ViewButton active={!show3d} onClick={() => setOdontogramView('flat')}>2D</ViewButton>
          <ViewButton active={show3d} onClick={() => setOdontogramView('3d')}>3D</ViewButton>
        </div>
      )}

      {show3d ? (
        <Suspense
          fallback={
            <div className="grid h-[340px] place-items-center rounded-xl bg-bg-sidebar text-sm text-ink-muted">
              Laen 3D vaadet…
            </div>
          }
        >
          <Odontogram3D {...props} onUnavailable={giveUp} />
        </Suspense>
      ) : (
        <MultiOdontogramPicker {...props} />
      )}
    </div>
  )
}

function ViewButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'btn-ghost border px-2.5 text-xs',
        active ? 'border-accent bg-accent/10 text-accent' : 'border-ink-faint/25',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
