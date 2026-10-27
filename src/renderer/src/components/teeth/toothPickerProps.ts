/**
 * The contract every tooth chart satisfies.
 *
 * Lifted out of `MultiOdontogramPicker`, where it was a non-exported `interface
 * Props`. It is about to serve two implementations — the 2D arch and a 3D jaw —
 * and a shared contract must not live inside one of the things that implements
 * it.
 *
 * Note the two optional callbacks: their PRESENCE is the feature flag. A work
 * type that cannot sit on an implant simply gets no `onToggleImplant`, and the
 * mode disappears rather than being shown and refused.
 */
import type { WorkItem } from '../../types/job'

export interface ToothPickerProps {
  items: WorkItem[]
  /** Which item receives clicks. `null` makes every click a no-op. */
  activeItemId: string | null
  /** Work-type NAME → hex. Keyed by name because that is what `WorkItem.too` holds. */
  colorMap: Record<string, string>
  /** FDI as a NUMBER. The caller decides whether that means add or remove. */
  onToggleTooth: (tooth: number) => void
  /** Omit entirely when this work cannot sit on an implant. */
  onToggleImplant?: (tooth: number) => void
  /** Omit entirely when nobody is named as the designer. */
  onToggleDesign?: (tooth: number) => void
  disabled?: boolean
}
