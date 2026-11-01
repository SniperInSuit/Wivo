/**
 * Previews made on the uploader's computer (spec, Phase 1 Files: "a PNG from
 * STL, thumbnails from photos"). From the CLEANED bytes, so a preview never
 * carries what the file itself lost.
 *
 * A preview is a convenience. Any failure here returns null and the upload
 * carries on without one — a missing thumbnail is not worth a failed scan.
 */
import { extensionOf } from './fileClean'

const SIZE = 320

const toPng = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'))

async function photoPreview(bytes: Uint8Array): Promise<Blob | null> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
  const scale = Math.min(1, SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return toPng(canvas)
}

/**
 * One frame of the model, front-on and slightly from above, on a transparent
 * background. three.js is loaded only when an STL is actually uploaded, the
 * same reason the 3D chart is lazy (see components/teeth/ToothPicker.tsx).
 */
async function stlPreview(bytes: Uint8Array): Promise<Blob | null> {
  const THREE = await import('three')
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
  const geometry = new STLLoader().parse(new Uint8Array(bytes).buffer)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const sphere = geometry.boundingSphere
  if (!sphere) return null

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  try {
    renderer.setSize(SIZE, SIZE, false)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(1, 2, 3)
    scene.add(key)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.55 }))
    mesh.position.sub(sphere.center)
    scene.add(mesh)
    const camera = new THREE.PerspectiveCamera(35, 1, sphere.radius / 100, sphere.radius * 100)
    const distance = sphere.radius / Math.sin((35 / 2) * Math.PI / 180)
    camera.position.set(0, distance * 0.35, distance)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
    return await toPng(canvas)
  } finally {
    geometry.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}

export async function makePreview(fileName: string, bytes: Uint8Array): Promise<Blob | null> {
  try {
    const ext = extensionOf(fileName)
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return await photoPreview(bytes)
    if (ext === 'stl') return await stlPreview(bytes)
    return null
  } catch (e) {
    console.warn('[wivo] preview failed, uploading without one:', e)
    return null
  }
}
