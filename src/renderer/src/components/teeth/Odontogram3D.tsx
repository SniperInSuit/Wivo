/**
 * The tooth chart as a jaw you can turn.
 *
 * Draws exactly what the 2D chart draws — it reads the same
 * `deriveOdontogramState` and obeys the same `decideToothClick` — so the two
 * cannot tell different stories about the same job. Everything here is about
 * getting that state onto a GPU.
 *
 * ── Four things that would quietly break ─────────────────────────────────────
 *
 * 1. The model arrives as BYTES over IPC and is handed to `parse()`. The
 *    renderer's origin is `file://` in a packaged build and Chromium refuses
 *    `fetch()` there, so `GLTFLoader.load()` would work all through development
 *    and fail on every installed copy. See `readTeethModel` in main.
 *
 * 2. It renders ON DEMAND. A job panel can sit open all day; a permanent
 *    `requestAnimationFrame` loop would mean one core busy and a laptop fan
 *    running for a picture that is not changing. Orbit damping is off for the
 *    same reason — damping only settles if something keeps drawing it.
 *
 * 3. The parsed model is cached at module scope and CLONED per mount, sharing
 *    geometry and textures. Moving between twenty jobs otherwise re-parses four
 *    megabytes twenty times and uploads the same three textures to the GPU
 *    twenty times. Materials are cloned too, because colouring a tooth here
 *    must not colour it in some other panel.
 *
 * 4. WebGL can be absent — locked-down desktops, VMs, RDP. That is not an error
 *    to report, it is a reason to stay on the 2D chart silently, so the whole
 *    component reports `onUnavailable` and disappears.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────
 * No keyboard grid. The 2D chart is one click away, is the default, and is
 * already fully keyboard-operable — a third tooth grid (the wizard has one,
 * keyed by type name rather than item) would be a third place for the same
 * idea to drift. Dragging across teeth to mark several is Faas 1b.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { deriveOdontogramState } from './odontogramState'
import { decideToothClick, type MarkMode } from './toothInteraction'
import { parseToothName, viewOffset, decideGesture, VIEW_LABELS, type ViewName } from './odontogram3dCore'
import type { ToothPickerProps } from './toothPickerProps'

const FOV = 38

/** How far a colour is pulled toward white before it is laid over the texture. */
const TINT_MIX = 0.42

/** Emissive hints for the two marks. Hover adds intensity, never colour. */
const MARK_IMPLANT = 0x60a5fa
const MARK_DESIGN = 0xfbbf24

// ── Shared model ─────────────────────────────────────────────────────────────

let cached: Promise<THREE.Group | null> | null = null

/**
 * Parses the model once per session.
 *
 * Resolves to null for every failure — missing file, missing bridge, corrupt
 * bytes — because the caller's answer is the same in all of them: show the 2D
 * chart. A rejected promise would also poison the cache for the rest of the
 * session.
 */
function sharedModel(): Promise<THREE.Group | null> {
  cached ??= (async () => {
    const bytes = await window.wivo?.getTeethModel?.()
    if (!bytes) return null
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    return gltf.scene
  })().catch(() => null)
  return cached
}

// ── Painting ─────────────────────────────────────────────────────────────────

const WHITE = new THREE.Color(0xffffff)

/**
 * Sets a tooth's whole appearance from the state, every time.
 *
 * ── Why this computes rather than restores ───────────────────────────────────
 * Hover used to be a second pass that brightened a material on the way in and
 * tried to put it back on the way out. Putting it back needs to know what
 * "back" was, and the test it used — "did this tooth have no emissive colour?"
 * — was asked AFTER the highlight had already set one, so it never matched.
 * Every tooth the cursor touched stayed lit for good.
 *
 * Deriving the finished look from the state in one place removes the question.
 * There is nothing to restore because nothing is ever half-applied, and a tooth
 * looks the same whether it was hovered once or thirty times.
 */
function paintTooth(
  mesh: THREE.Mesh,
  fdi: number,
  state: ReturnType<typeof deriveOdontogramState>,
  activeItemId: string | null,
  hovered: boolean,
): void {
  const mat = mesh.material as THREE.MeshStandardMaterial
  const key = String(fdi)
  const owner = state.owners.get(key)

  if (owner) mat.color.set(owner.color).lerp(WHITE, TINT_MIX)
  else mat.color.copy(WHITE)

  // A tooth can carry both marks. Implant wins the glow because it is the
  // costlier fact; the hover label still names both.
  const mark = state.implants.has(key) ? MARK_IMPLANT
    : state.designed.has(key) ? MARK_DESIGN
      : null

  // Hover lifts the INTENSITY and only borrows the colour when there is no
  // mark to show — colour is how the marks are told apart.
  mat.emissive.setHex(mark ?? (hovered ? 0xffffff : 0x000000))
  mat.emissiveIntensity = mark === null
    ? (hovered ? 0.22 : 0)
    : (hovered ? 0.55 : 0.3)

  // Teeth belonging to another item on the same job are dimmed, not hidden:
  // they are still real work, just not what is being edited.
  mat.opacity = owner && activeItemId && owner.itemId !== activeItemId ? 0.55 : 1
  mat.transparent = mat.opacity < 1
}

// ── Component ────────────────────────────────────────────────────────────────

export interface Odontogram3DProps extends ToothPickerProps {
  /** Called when this machine or this build cannot draw the chart at all. */
  onUnavailable: () => void
}

export function Odontogram3D({ onUnavailable, ...props }: Odontogram3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [markMode, setMarkMode] = useState<MarkMode | null>(null)
  // Split deliberately. The POSITION changes on every mouse move; the TOOTH
  // only when the cursor crosses onto a different one. Held as one object,
  // every pixel of movement produced a new value and repainted all 32 teeth.
  const [hoverFdi, setHoverFdi] = useState<number | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const [loading, setLoading] = useState(true)

  // Handlers live inside a `useEffect` that runs ONCE, so they would otherwise
  // close over the first render's props forever — clicking a tooth would toggle
  // it on whatever item was active when the panel opened.
  const live = useRef({ ...props, markMode })
  live.current = { ...props, markMode }

  const teethRef = useRef(new Map<number, THREE.Mesh>())
  const renderRef = useRef<() => void>(() => {})
  const fitRef = useRef<(v: ViewName) => void>(() => {})

  // ── Scene, built once ──────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false

    let renderer: THREE.WebGLRenderer
    try {
      // `alpha` rather than a background colour: the card behind shows through,
      // so the chart follows the theme without reading a single CSS variable.
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      onUnavailable()
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'

    // Enamel is a dielectric. With nothing to reflect, physically-based
    // shading renders it dead flat — the "made of glass" look.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    const key = new THREE.DirectionalLight(0xffffff, 1.7)
    key.position.set(3, 7, 9)
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.6)
    rim.position.set(-5, 1, -7)
    scene.add(key, rim)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false      // a centred model only ever gets lost by panning
    controls.enableDamping = false  // see note 2 in the header
    controls.zoomSpeed = 0.8
    // Rotation is the only thing gated, and it is gated BEFORE OrbitControls
    // sees the press — see `onDownCapture`. Zoom stays on permanently: the
    // wheel never competes with marking a tooth.

    const render = (): void => { if (!disposed) renderer.render(scene, camera) }
    renderRef.current = render
    controls.addEventListener('change', render)

    const owned: THREE.Material[] = []
    let span = 6

    void sharedModel().then(model => {
      if (disposed) return
      if (!model) { onUnavailable(); return }

      const root = model.clone(true)
      root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        // Cloning the material keeps this panel's colours out of every other
        // panel; the maps inside it stay shared, so nothing is re-uploaded.
        const mat = (o.material as THREE.Material).clone()
        o.material = mat
        owned.push(mat)
        const fdi = parseToothName(o.name)
        if (fdi !== null) teethRef.current.set(fdi, o)
      })
      scene.add(root)

      const box = new THREE.Box3().setFromObject(root)
      controls.target.copy(box.getCenter(new THREE.Vector3()))
      const size = box.getSize(new THREE.Vector3())
      span = Math.max(size.x, size.y, size.z)
      // Scaled off the model rather than hardcoded, so a rebuild from a
      // different bite cannot leave the wheel able to fly through the palate
      // or push the jaw out of sight.
      controls.minDistance = span * 0.55
      controls.maxDistance = span * 4

      fitRef.current = (view: ViewName): void => {
        const [x, y, z] = viewOffset(view, span, FOV)
        camera.position.set(controls.target.x + x, controls.target.y + y, controls.target.z + z)
        controls.update()
        render()
      }
      fitRef.current('front')
      setLoading(false)
    })

    // ── Sizing ───────────────────────────────────────────────────────────────
    const resize = (): void => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    // ── Pointer ──────────────────────────────────────────────────────────────
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    const pick = (e: PointerEvent): THREE.Mesh | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects([...teethRef.current.values()], false)[0]
      return (hit?.object as THREE.Mesh | undefined) ?? null
    }

    let orbiting = false
    const clearHover = (): void => { setHoverFdi(null); setHoverPos(null) }

    const onMove = (e: PointerEvent): void => {
      if (orbiting) return  // mid-turn: the number would only chase the cursor
      const mesh = pick(e)
      const fdi = mesh ? parseToothName(mesh.name) : null
      if (fdi === null) { clearHover(); return }
      const r = host.getBoundingClientRect()
      setHoverFdi(fdi)
      setHoverPos({ x: e.clientX - r.left, y: e.clientY - r.top })
    }

    /**
     * Routes the press, in the CAPTURE phase on the host element.
     *
     * The phase is the whole trick. OrbitControls listens on the canvas, and it
     * registered first, so a listener added to the canvas afterwards — capture
     * flag or not — still runs second: at the target, listeners fire in
     * registration order. OrbitControls would see the old value of
     * `enableRotate` every time, and a gate flipped afterwards would already be
     * too late. Capturing on the PARENT is ordered by the DOM itself.
     */
    const onDownCapture = (e: PointerEvent): void => {
      const mesh = pick(e)
      const gesture = decideGesture(mesh !== null, e.button !== 0)
      // The ray decides, so marking and turning can never fight: a drag that
      // began on a tooth never spins the model out from under it.
      controls.enableRotate = gesture === 'orbit'
      orbiting = gesture === 'orbit'
      if (gesture === 'orbit' || !mesh) { clearHover(); return }
      const fdi = parseToothName(mesh.name)
      if (fdi === null) return
      const ctx = live.current
      const state = deriveOdontogramState(ctx.items, ctx.colorMap)
      switch (decideToothClick(fdi, { ...ctx, owners: state.owners })) {
        case 'toggle': ctx.onToggleTooth(fdi); break
        case 'implant': ctx.onToggleImplant?.(fdi); break
        case 'design': ctx.onToggleDesign?.(fdi); break
      }
    }

    const onUp = (): void => { orbiting = false }
    const onLeave = (): void => clearHover()

    const el = renderer.domElement
    el.addEventListener('pointermove', onMove)
    host.addEventListener('pointerdown', onDownCapture, true)
    el.addEventListener('pointerleave', onLeave)
    window.addEventListener('pointerup', onUp)

    return () => {
      disposed = true
      ro.disconnect()
      el.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onDownCapture, true)
      el.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerup', onUp)
      controls.removeEventListener('change', render)
      controls.dispose()
      // Only what this mount created. Geometry and textures belong to the
      // cached model and are still in use by whatever mounts next.
      for (const m of owned) m.dispose()
      teethRef.current.clear()
      env.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      el.remove()
    }
  }, [onUnavailable])

  // ── One paint pass, for the job AND the hover ──────────────────────────────
  const { items, colorMap, activeItemId } = props
  useEffect(() => {
    const teeth = teethRef.current
    // `loading` is in the dependency list for one reason: the model arrives
    // asynchronously. On the first pass there are no meshes yet and this bails
    // out — and without something to re-run it once they exist, teeth already
    // chosen on the 2D chart came up unmarked and had to be picked again.
    if (loading || teeth.size === 0) return
    const state = deriveOdontogramState(items, colorMap)
    for (const [fdi, mesh] of teeth) {
      paintTooth(mesh, fdi, state, activeItemId, fdi === hoverFdi)
    }
    renderRef.current()
  }, [items, colorMap, activeItemId, loading, hoverFdi])

  const setView = useCallback((v: ViewName) => fitRef.current(v), [])

  const state = deriveOdontogramState(items, colorMap)
  const hoverKey = hoverFdi === null ? null : String(hoverFdi)
  // The label names BOTH marks even though the glow can only show one.
  const hoverLabel = hoverKey && [
    hoverKey,
    state.implants.has(hoverKey) ? 'implantaat' : null,
    state.designed.has(hoverKey) ? 'disainija' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-2">
      {/* `bg-ink/5` rather than `bg-bg-sidebar`: that token is documented as
          the recessed surface for inputs and stays LIGHT in every theme, which
          put a near-white slab in the middle of a dark card. A tint of the ink
          colour recesses correctly whichever way round the theme runs, and the
          canvas itself is transparent so this is what shows through. */}
      <div ref={hostRef} className="relative h-[340px] w-full overflow-hidden rounded-xl bg-ink/5">
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-sm text-ink-muted">
            Laen mudelit…
          </div>
        )}
        {hoverPos && hoverLabel && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[150%] rounded-md border border-ink-faint/30 bg-bg-card px-2 py-0.5 text-xs font-bold text-ink shadow-card"
            style={{ left: hoverPos.x, top: hoverPos.y }}
          >
            {hoverLabel}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {VIEW_LABELS.map(({ view, label }) => (
          <button
            key={view}
            type="button"
            onClick={() => setView(view)}
            // See the note on ToothPicker's ViewButton: the wizard paints every
            // button inside the picker white, and that rule outranks ours.
            data-chrome="chart"
            className="btn-ghost border border-ink-faint/25 bg-bg-card text-xs"
          >
            {label}
          </button>
        ))}

        {/* Only the modes the caller enabled — see toothPickerProps. */}
        <div className="ml-auto flex gap-1.5">
          {props.onToggleImplant && (
            <ModeButton
              active={markMode === 'implant'}
              onClick={() => setMarkMode(m => (m === 'implant' ? null : 'implant'))}
            >
              Implantaat
            </ModeButton>
          )}
          {props.onToggleDesign && (
            <ModeButton
              active={markMode === 'design'}
              onClick={() => setMarkMode(m => (m === 'design' ? null : 'design'))}
            >
              Disainija
            </ModeButton>
          )}
        </div>
      </div>

      {markMode && (
        <p className="text-xs text-ink-muted">
          {markMode === 'implant'
            ? 'Klõpsa hambal, mis on implantaadil. Märkida saab ainult selle tööosa hambaid.'
            : 'Klõpsa hambal, mille tegi disainija. Märkida saab ainult selle tööosa hambaid.'}
        </p>
      )}
    </div>
  )
}

function ModeButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-chrome="chart"
      className={[
        'btn-ghost border text-xs',
        active ? 'border-accent bg-accent/10 text-accent' : 'border-ink-faint/25 bg-bg-card',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
