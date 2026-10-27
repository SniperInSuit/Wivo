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
 * Today it renders only the 2D chart. That is the point of landing it now:
 * every call site already goes through here, so adding the 3D view later is an
 * addition rather than a change to four files.
 */
import { MultiOdontogramPicker } from '../JobDetail/MultiOdontogramPicker'
import type { ToothPickerProps } from './toothPickerProps'

export interface ToothPickerWrapperProps extends ToothPickerProps {
  /**
   * Set false where a second renderer would not fit — a narrow wizard column,
   * say. Reversible, and it keeps that decision at the call site rather than
   * inside the chart.
   */
  allow3d?: boolean
}

export function ToothPicker({ allow3d: _allow3d = true, ...props }: ToothPickerWrapperProps) {
  // The 2D/3D segmented control lands here, outside whatever the caller wraps
  // the chart in — `WizardOdontogram` styles the picker's internal buttons
  // from the outside with `[&_button]` selectors, and a toggle rendered inside
  // that div would inherit 44px wizard sizing it was never meant to have.
  return <MultiOdontogramPicker {...props} />
}
