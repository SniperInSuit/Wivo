/**
 * The parts of the 3D chart that do not need a GPU.
 *
 * WebGL does not run under jsdom and bringing a headless browser in for one
 * component is not worth it, so everything that can be decided without drawing
 * is decided here instead — node naming, camera angles, gesture routing — and
 * the component is left with little more than the drawing.
 */

/** Which preset the camera is sitting on. */
export type ViewName = 'front' | 'top' | 'bottom' | 'left' | 'right'

/**
 * Reads the FDI number out of a glTF node name.
 *
 * `tooth_16` is what `scripts/teeth-to-glb.mjs` writes. The `.001` case is for
 * the day somebody opens the model in Blender and saves it back: Blender
 * silently renames a duplicate to `tooth_16.001`, and without stripping that
 * the symptom is "half the teeth do not react", which looks like a raycasting
 * bug and is not one.
 *
 * Returns null for anything that is not a tooth — `gingiva`, a stray empty, or
 * a number outside the FDI range. A quadrant of 5 or an index of 9 is a broken
 * model, not a tooth we have not heard of.
 */
export function parseToothName(name: string): number | null {
  const m = /^tooth_(\d{2})(?:\.\d+)?$/.exec(name.trim())
  if (!m) return null
  const fdi = Number(m[1])
  const quadrant = Math.floor(fdi / 10)
  const index = fdi % 10
  if (quadrant < 1 || quadrant > 4) return null
  if (index < 1 || index > 8) return null
  return fdi
}

/**
 * Where the camera sits for each preset, as a direction from the model centre.
 *
 * Unit-ish directions, scaled by the model's own size at runtime — a hardcoded
 * distance would be wrong the moment the model is rebuilt from a different
 * bite, which has already happened once.
 *
 * None of them is dead-on. A pure front view of a closed bite shows two rows of
 * enamel and no chewing surfaces at all; tilting a little keeps the labial
 * faces readable while letting the occlusal edges catch the light. Top and
 * bottom lean forward slightly for the same reason — straight down an arch, the
 * anterior teeth are edge-on and nearly invisible.
 */
export const CAMERA_VIEWS: Record<ViewName, readonly [number, number, number]> = {
  front: [0, 0.22, 1],
  top: [0, 1, 0.3],
  bottom: [0, -1, 0.3],
  left: [-1, 0.2, 0.25],
  right: [1, 0.2, 0.25],
}

/** Estonian labels for the preset buttons, in the order they are shown. */
export const VIEW_LABELS: readonly { view: ViewName; label: string }[] = [
  { view: 'front', label: 'Eest' },
  { view: 'top', label: 'Pealt' },
  { view: 'bottom', label: 'Alt' },
  { view: 'left', label: 'Vasakult' },
  { view: 'right', label: 'Paremalt' },
]

/**
 * The camera offset for a preset, scaled so a model of `span` fits the frame.
 *
 * `fovDeg` is the vertical field of view, and `span` is the model's LARGEST
 * dimension rather than its height — the model turns, so the fit has to hold
 * for every angle, not just the one it starts at.
 *
 * The 1.25 is headroom. It was 1.7, which is right for a square viewport and
 * much too far for the wide, short panel this actually sits in: fitting the
 * widest dimension against the VERTICAL field of view already overshoots, and
 * the extra margin on top left the jaw floating in the middle of the frame.
 */
export function viewOffset(
  view: ViewName,
  span: number,
  fovDeg: number,
): [number, number, number] {
  const dist = (span / 2) / Math.tan((fovDeg * Math.PI) / 360) * 1.25
  const [x, y, z] = CAMERA_VIEWS[view]
  const len = Math.hypot(x, y, z) || 1
  return [(x / len) * dist, (y / len) * dist, (z / len) * dist]
}

/**
 * What a drag starting at this point is: marking teeth, or turning the model.
 *
 * The ray decides, not a modifier key. Press on a tooth and you are marking;
 * press on empty space and you are orbiting. So the two gestures can never
 * fight, and dragging across teeth happens on a still image — exactly like the
 * 2D chart, where the arch does not move either.
 */
export function decideGesture(hitATooth: boolean, secondaryButton: boolean): 'mark' | 'orbit' {
  if (secondaryButton) return 'orbit'
  return hitATooth ? 'mark' : 'orbit'
}

/**
 * Whether this machine can draw the 3D chart at all.
 *
 * Locked-down desktops, virtual machines and RDP sessions can refuse to create
 * a WebGL context entirely. That is not an error to report — it is a reason to
 * stay on the 2D chart and say nothing, because the 2D chart is the default
 * anyway and nobody is missing anything they asked for.
 */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}
