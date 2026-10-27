/**
 * Turns the purchased mouth OBJs and TGAs into the one asset the 3D chart loads.
 *
 * Run once, by hand, when the source model changes. The OUTPUT is committed;
 * this exists so the output can be rebuilt rather than trusted blindly.
 *
 *   node scripts/teeth-to-glb.mjs <path-to-purchased-archive-root>
 *
 * ── Why this does the FDI naming itself ──────────────────────────────────────
 * The source OBJ has no object names at all — no `o`, no `g`, no `usemtl`. The
 * exporter flattened everything into one vertex soup. What it DOES have is 32
 * geometrically disconnected shells, so the teeth are separated by the mesh
 * itself and we recover identity from POSITION, which is a rule we can state
 * and check rather than a list of names we would have to trust.
 *
 * Arch comes from Y, side from X, and the tooth's place in its quadrant from Z
 * (the arch curves back, so the most anterior tooth is the central incisor).
 *
 * ⚠ THE ONE THING GEOMETRY CANNOT TELL US: which side is the PATIENT's right.
 * The model is very nearly mirror-symmetric, so nothing in the file
 * distinguishes quadrant 1 from quadrant 2. We assume the model faces +Z and
 * that a viewer at +Z therefore sees +X on their own right — which is the
 * patient's LEFT. Getting this backwards would mirror every tooth number in
 * the app, so it is a flag, not a buried constant, and it is verified by eye.
 *
 * ── Why there is a PNG encoder in here ───────────────────────────────────────
 * The source maps are 4096² uncompressed TGA, 250 MB in total, and nothing in
 * this project can read or resize them. Rather than add an image dependency to
 * a build that ships no node_modules, the three formats involved are all simple
 * enough to do directly: TGA type 2 is a raw pixel dump, the downscale is an
 * exact 4×4 box because 4096 divides by 1024, and PNG is zlib plus a filter
 * byte per scanline. Roughly 120 lines, no dependency, reproducible forever.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

/** true = +X is the patient's LEFT (quadrants 2 and 3). See the header. */
const PLUS_X_IS_PATIENT_LEFT = true

/**
 * Which bite to build from.
 *
 * Closed is the compact one: the arches nest, so the model is a third shorter
 * and fills a panel instead of floating in it. It does hide the lower occlusal
 * surfaces — but the camera buttons answer that, because "Pealt" and "Alt" look
 * straight down each arch, and a tooth stays clickable from any angle anyway.
 *
 * The archive's own filenames are inconsistent — `Teeth__Closed` has two
 * underscores and `Gums_Open_OBJ` carries a redundant suffix. Both are spelled
 * out here rather than derived, so nobody "tidies" them into a broken path.
 */
const VARIANT = 'closed'
const VARIANTS = {
  closed: { teeth: 'Teeth__Closed.obj', gums: 'Gums_Closed.obj' },
  open: { teeth: 'Teeth_Open.obj', gums: 'Gums_Open_OBJ.obj' },
}

/**
 * Per-map output resolution.
 *
 * The normal map carries the surface detail that stops the teeth reading as
 * polished glass, so it keeps the most pixels. ORM is near-flat gradients and
 * survives halving without anybody noticing.
 */
const SIZES = { DIFFUSE: 1024, NORMAL: 1024, ORM: 512 }

/**
 * How far past the teeth the gums are allowed to reach, in cm.
 *
 * This is a mouth INTERIOR model, so the gums come with a throat: they run to
 * z = -5.7 where the last molar stops at -1.88, and down to y = -3.26 for the
 * floor of the mouth. On an anatomy render that is the point. On a tooth chart
 * it is 4 cm of pink nothing behind the thing you are trying to click.
 *
 * The ridge itself has to stay — these teeth have their roots modelled, and
 * without gums to bury them the chart reads as a skull x-ray rather than a
 * mouth. So: keep what hugs the arch, drop the rest.
 *
 * ── Why the margins are NOT the same in every direction ──────────────────────
 * They were, at 4 mm, and it tore the front off the upper gum. The incisors
 * reach z = 4.15 and the labial gum in front of them reaches 4.62, so an even
 * margin cut 0.7 mm of real tissue — and because this gum is a coarse mesh with
 * big polygons, and a face dies if any one corner is outside, that 0.7 mm took
 * the whole front panel with it and left two incisor roots standing in a gap.
 *
 * The throat is BEHIND the molars and the floor of the mouth is BELOW them.
 * Forwards and upwards there is nothing to cut, so those directions get enough
 * room that the box never reaches the tissue at all.
 *
 * Per axis: [how far past the teeth to keep going DOWN, and UP], in cm.
 * Set to null to keep the gums whole.
 */
const GUM_KEEP = {
  x: [1.5, 1.5],  // the gums are simply wider than the teeth — nothing to trim sideways
  y: [0.4, 1.5],  // down: cut the floor of the mouth. up: keep the whole ridge
  z: [0.4, 1.5],  // back: cut the throat. front: keep the labial gum
}

// ── OBJ ──────────────────────────────────────────────────────────────────────

function parseObj(text) {
  const pos = [], nrm = [], uv = [], faces = []
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/); pos.push([+p[1], +p[2], +p[3]])
    } else if (line.startsWith('vn ')) {
      const p = line.split(/\s+/); nrm.push([+p[1], +p[2], +p[3]])
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/); uv.push([+p[1], +p[2]])
    } else if (line.startsWith('f ')) {
      faces.push(line.trim().split(/\s+/).slice(1).map(tok => {
        const [v, t, n] = tok.split('/')
        const rel = (s, arr) => { const i = +s; return i > 0 ? i - 1 : arr.length + i }
        return {
          v: rel(v, pos),
          t: t ? rel(t, uv) : -1,
          n: n ? rel(n, nrm) : -1,
        }
      }))
    }
  }
  return { pos, nrm, uv, faces }
}

/**
 * Groups faces into disconnected shells.
 *
 * Welds by rounded position first: a UV seam stores the same point twice, and
 * without welding every seam would read as a separate tooth.
 */
function components({ pos, faces }) {
  const key = new Map()
  const weld = pos.map(p => {
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`
    if (!key.has(k)) key.set(k, key.size)
    return key.get(k)
  })

  const parent = Array.from({ length: key.size }, (_, i) => i)
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (const f of faces) for (let i = 1; i < f.length; i++) union(weld[f[0].v], weld[f[i].v])

  const groups = new Map()
  for (const f of faces) {
    const r = find(weld[f[0].v])
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(f)
  }
  return [...groups.values()]
}

const centroid = (shell, pos) => {
  const seen = new Set()
  let x = 0, y = 0, z = 0, n = 0
  for (const f of shell) for (const c of f) {
    if (seen.has(c.v)) continue
    seen.add(c.v)
    x += pos[c.v][0]; y += pos[c.v][1]; z += pos[c.v][2]; n++
  }
  return [x / n, y / n, z / n]
}

/**
 * Assigns an FDI number to each of the 32 shells.
 *
 * Refuses rather than approximates: a count other than 32, or a quadrant
 * without exactly 8 teeth, means the source model is not what this script was
 * written for, and silently producing a 29-tooth chart would be far worse than
 * stopping here.
 */
function assignFdi(shells, pos) {
  if (shells.length !== 32) {
    throw new Error(`expected 32 disconnected teeth, found ${shells.length}`)
  }
  const withC = shells.map(s => ({ shell: s, c: centroid(s, pos) }))

  /**
   * Splits the arches at the WIDEST gap in Y, not at Y = 0.
   *
   * `c[1] > 0` worked and was wrong: it was read off the open-bite model, where
   * the arches happen to straddle the origin. In the closed model every tooth
   * sits at positive Y, so that test put all 32 in the upper jaw — which the
   * per-quadrant count caught immediately.
   *
   * The arches are two tight clusters whatever the bite, so the largest spacing
   * between consecutive teeth IS the gap between jaws: 1.12 cm closed against
   * 0.16 cm inside an arch, and far wider open. Requiring the split to land at
   * exactly 16/16 makes the assumption testable instead of hopeful.
   */
  const byY = [...withC].sort((a, b) => a.c[1] - b.c[1])
  let cut = -1, widest = -Infinity
  for (let i = 0; i < byY.length - 1; i++) {
    const gap = byY[i + 1].c[1] - byY[i].c[1]
    if (gap > widest) { widest = gap; cut = i }
  }
  if (cut !== 15) {
    throw new Error(`widest Y gap splits the arches ${cut + 1}/${31 - cut}, expected 16/16`)
  }
  const upper = new Set(byY.slice(16).map(t => t.shell))

  const quadrants = new Map()
  for (const t of withC) {
    const patientLeft = PLUS_X_IS_PATIENT_LEFT ? t.c[0] > 0 : t.c[0] < 0
    // FDI quadrants run clockwise from the patient's upper right.
    const q = upper.has(t.shell) ? (patientLeft ? 2 : 1) : (patientLeft ? 3 : 4)
    if (!quadrants.has(q)) quadrants.set(q, [])
    quadrants.get(q).push(t)
  }

  const out = new Map()
  for (const [q, teeth] of quadrants) {
    if (teeth.length !== 8) throw new Error(`quadrant ${q} has ${teeth.length} teeth, expected 8`)
    // Most anterior first: tooth 1 is the central incisor, tooth 8 the third molar.
    teeth.sort((a, b) => b.c[2] - a.c[2])
    teeth.forEach((t, i) => out.set(q * 10 + i + 1, t))
  }
  return out
}

// ── textures ─────────────────────────────────────────────────────────────────

function readTga(path) {
  const b = readFileSync(path)
  const idLen = b[0], type = b[2]
  if (type !== 2) throw new Error(`${path}: TGA type ${type} unsupported (need 2, uncompressed)`)
  const w = b.readUInt16LE(12), h = b.readUInt16LE(14)
  const ch = b[16] / 8
  // Bit 5 of the descriptor flips the row order; without it the map arrives
  // upside down and the normals light from the wrong side.
  const topDown = (b[17] & 0x20) !== 0
  const o = 18 + idLen
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    const row = topDown ? y : h - 1 - y
    for (let x = 0; x < w; x++) {
      const s = o + (y * w + x) * ch, d = (row * w + x) * 3
      out[d] = b[s + 2]; out[d + 1] = b[s + 1]; out[d + 2] = b[s]  // BGR -> RGB
    }
  }
  return { w, h, data: out }
}

/**
 * Exact box filter — 4096 to 1024 is a clean 4x4 average, no resampling error.
 *
 * `renormalise` is for the normal map only. Averaging four unit vectors gives a
 * SHORTER vector, not a unit one, and a shader that trusts the length renders
 * the surface progressively flatter the further you zoom out — which is the
 * exact glassy look this texture exists to remove.
 */
function downscale({ w, h, data }, size, renormalise = false) {
  const f = w / size
  if (!Number.isInteger(f)) throw new Error(`${w} does not divide evenly by ${size}`)
  const out = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const s = ((y * f + dy) * w + x * f + dx) * 3
      r += data[s]; g += data[s + 1]; b += data[s + 2]
    }
    const n = f * f, d = (y * size + x) * 3
    r /= n; g /= n; b /= n
    if (renormalise) {
      const vx = r / 127.5 - 1, vy = g / 127.5 - 1, vz = b / 127.5 - 1
      const len = Math.hypot(vx, vy, vz) || 1
      r = (vx / len + 1) * 127.5; g = (vy / len + 1) * 127.5; b = (vz / len + 1) * 127.5
    }
    out[d] = Math.round(r); out[d + 1] = Math.round(g); out[d + 2] = Math.round(b)
  }
  return { w: size, h: size, data: out }
}

const CRC = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC[n] = c
}
const crc32 = buf => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

const pngChunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** PNG with per-scanline adaptive filtering (minimum sum of absolute values). */
function encodePng({ w, h, data }) {
  const bpp = 3, stride = w * bpp
  const raw = Buffer.alloc((stride + 1) * h)
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride))
  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride)
    const prev = y ? data.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      cand[0][i] = cur[i]
      cand[1][i] = (cur[i] - a) & 255
      cand[2][i] = (cur[i] - b) & 255
      cand[3][i] = (cur[i] - ((a + b) >> 1)) & 255
      cand[4][i] = (cur[i] - paeth(a, b, c)) & 255
    }
    let best = 0, bestSum = Infinity
    for (let f = 0; f < 5; f++) {
      let s = 0
      for (let i = 0; i < stride; i++) { const v = cand[f][i]; s += v < 128 ? v : 256 - v }
      if (s < bestSum) { bestSum = s; best = f }
    }
    raw[y * (stride + 1)] = best
    cand[best].copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2  // 8 bits per channel, colour type 2 (RGB)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── glTF ─────────────────────────────────────────────────────────────────────

/**
 * One shell to one glTF primitive.
 *
 * OBJ indexes position, uv and normal separately and glTF cannot — one index
 * buffer feeds every attribute — so corners are re-keyed on the TRIPLE. Faces
 * are quads here and are fan-triangulated, which is safe because every face in
 * this model is planar and convex.
 *
 * ── Why the key is VALUES and not indices ────────────────────────────────────
 * Keying on `${c.v}|${c.t}|${c.n}` looks right and costs 1.4 MB. This exporter
 * wrote a separate normal for every face corner — 70k normals for 17k points —
 * so no two corners ever share an index even where they hold the identical
 * direction, and every vertex in the file gets duplicated four times over.
 *
 * Keying on the rounded VALUES merges those back together while still splitting
 * a corner where the attributes genuinely differ, so hard edges and UV seams
 * both survive and smooth surfaces stop paying for them.
 */
function buildMesh(shell, src, offset) {
  const map = new Map()
  const P = [], N = [], T = [], I = []
  const corner = c => {
    const p = src.pos[c.v]
    const n = c.n >= 0 ? src.nrm[c.n] : [0, 1, 0]
    const t = c.t >= 0 ? src.uv[c.t] : [0, 0]
    const k = `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`
      + `|${n[0].toFixed(3)},${n[1].toFixed(3)},${n[2].toFixed(3)}`
      + `|${t[0].toFixed(5)},${t[1].toFixed(5)}`
    let i = map.get(k)
    if (i === undefined) {
      i = map.size
      map.set(k, i)
      P.push(p[0] - offset[0], p[1] - offset[1], p[2] - offset[2])
      N.push(n[0], n[1], n[2])
      // OBJ puts V=0 at the bottom, glTF puts it at the top.
      T.push(t[0], 1 - t[1])
    }
    return i
  }
  for (const f of shell) {
    const idx = f.map(corner)
    for (let i = 1; i < idx.length - 1; i++) I.push(idx[0], idx[i], idx[i + 1])
  }
  return { P, N, T, I }
}

const align4 = n => (n + 3) & ~3
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

function writeGlb(meshes, images, outPath) {
  const json = {
    asset: { version: '2.0', generator: 'wivo teeth-to-glb' },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [],
    textures: [], images: [], samplers: [], accessors: [], bufferViews: [], buffers: [],
  }

  const blobs = []
  let byteOffset = 0
  const push = (buf, target) => {
    const pad = align4(byteOffset) - byteOffset
    if (pad) { blobs.push(Buffer.alloc(pad)); byteOffset += pad }
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: buf.length, target })
    blobs.push(buf)
    byteOffset += buf.length
    return json.bufferViews.length - 1
  }

  json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 })
  const tex = {}
  for (const [name, png] of Object.entries(images)) {
    json.images.push({ bufferView: push(png), mimeType: 'image/png' })
    json.textures.push({ sampler: 0, source: json.images.length - 1 })
    tex[name] = json.textures.length - 1
  }

  /**
   * One material for all 33 nodes — they share a single 4096 atlas.
   *
   * ORM is packed exactly the way glTF reads it: occlusion in R, roughness in
   * G, metalness in B. So the same texture serves `occlusionTexture` and
   * `metallicRoughnessTexture` and is uploaded to the GPU once.
   *
   * baseColorFactor stays white so the renderer can tint a tooth by work type
   * without the texture fighting it.
   */
  const base = {
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: { index: tex.DIFFUSE },
      metallicRoughnessTexture: { index: tex.ORM },
      metallicFactor: 1,
      roughnessFactor: 1,
    },
    occlusionTexture: { index: tex.ORM },
    normalTexture: { index: tex.NORMAL },
  }
  json.materials.push({ name: 'teeth', ...base })
  // Trimming the throat leaves the gums an OPEN shell. Single-sided, the cut
  // edge turns into a hole you can see straight through when the camera comes
  // round the back; double-sided, the inside is shaded and it still reads solid.
  json.materials.push({ name: 'gingiva', ...base, doubleSided: true })

  for (const { name, mat, P, N, T, I } of meshes) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) {
      if (P[i + a] < min[a]) min[a] = P[i + a]
      if (P[i + a] > max[a]) max[a] = P[i + a]
    }
    const count = P.length / 3
    const big = count > 65535

    const vPos = push(Buffer.from(new Float32Array(P).buffer), 34962)
    const vNrm = push(Buffer.from(new Float32Array(N).buffer), 34962)
    const vUv = push(Buffer.from(new Float32Array(T).buffer), 34962)
    const vIdx = push(Buffer.from((big ? new Uint32Array(I) : new Uint16Array(I)).buffer), 34963)

    json.accessors.push({ bufferView: vPos, componentType: 5126, count, type: 'VEC3', min, max })
    json.accessors.push({ bufferView: vNrm, componentType: 5126, count, type: 'VEC3' })
    json.accessors.push({ bufferView: vUv, componentType: 5126, count, type: 'VEC2' })
    json.accessors.push({ bufferView: vIdx, componentType: big ? 5125 : 5123, count: I.length, type: 'SCALAR' })
    const a = json.accessors.length - 4

    json.meshes.push({
      primitives: [{
        attributes: { POSITION: a, NORMAL: a + 1, TEXCOORD_0: a + 2 },
        indices: a + 3,
        material: mat,
      }],
    })
    json.nodes.push({ name, mesh: json.meshes.length - 1 })
    json.scenes[0].nodes.push(json.nodes.length - 1)
  }

  const bin = Buffer.concat(blobs)
  json.buffers.push({ byteLength: bin.length })

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = Buffer.alloc(align4(jsonBuf.length) - jsonBuf.length, 0x20)
  const binPad = Buffer.alloc(align4(bin.length) - bin.length, 0)

  const body = Buffer.concat([
    u32(jsonBuf.length + jsonPad.length), u32(0x4e4f534a), jsonBuf, jsonPad,
    u32(bin.length + binPad.length), u32(0x004e4942), bin, binPad,
  ])
  writeFileSync(outPath, Buffer.concat([u32(0x46546c67), u32(2), u32(12 + body.length), body]))
}

// ── main ─────────────────────────────────────────────────────────────────────

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/teeth-to-glb.mjs <purchased-archive-root>')
  process.exit(1)
}

const files = VARIANTS[VARIANT]
const teeth = parseObj(readFileSync(join(root, 'meshes', files.teeth), 'utf8'))
const gums = parseObj(readFileSync(join(root, 'meshes', files.gums), 'utf8'))
const fdi = assignFdi(components(teeth), teeth.pos)

// Centre on the TEETH, not the gums: the gums are a loose cuff and would drag
// the pivot off the arch, which the orbit camera would then rotate around.
const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
for (const t of fdi.values()) for (const f of t.shell) for (const c of f) {
  for (let a = 0; a < 3; a++) {
    const v = teeth.pos[c.v][a]
    if (v < bb.min[a]) bb.min[a] = v
    if (v > bb.max[a]) bb.max[a] = v
  }
}
const offset = [0, 1, 2].map(a => (bb.min[a] + bb.max[a]) / 2)

const order = [...fdi.keys()].sort((a, b) => a - b)
const meshes = order.map(n => ({ name: `tooth_${n}`, mat: 0, ...buildMesh(fdi.get(n).shell, teeth, offset) }))

// A face survives only if ALL of its corners are inside the box, so the cut
// lands on a whole-polygon boundary rather than slicing triangles in half.
const whole = components(gums)[0]
const AXIS = ['x', 'y', 'z']
const gumShell = GUM_KEEP === null ? whole : whole.filter(f => f.every(c =>
  [0, 1, 2].every(a => {
    const v = gums.pos[c.v][a]
    const [down, up] = GUM_KEEP[AXIS[a]]
    return v >= bb.min[a] - down && v <= bb.max[a] + up
  })))
meshes.push({ name: 'gingiva', mat: 1, ...buildMesh(gumShell, gums, offset) })
console.log(`gingiva: ${whole.length} faces -> ${gumShell.length} kept`)

const images = {}
for (const [name, size] of Object.entries(SIZES)) {
  const tga = readTga(join(root, 'textures', `Mouth_${name}.tga`))
  images[name] = encodePng(downscale(tga, size, name === 'NORMAL'))
  console.log(`${name}: ${tga.w}px -> ${size}px, ${(images[name].length / 1024).toFixed(0)} KB`)
}

writeGlb(meshes, images, 'resources/teeth.glb')

const tris = meshes.reduce((s, m) => s + m.I.length / 3, 0)
const verts = meshes.reduce((s, m) => s + m.P.length / 3, 0)
console.log(`${meshes.length} nodes · ${verts} verts · ${tris} tris`)
console.log(`centred on [${offset.map(v => v.toFixed(2)).join(', ')}]`)
console.log(`extent [${[0, 1, 2].map(a => (bb.max[a] - bb.min[a]).toFixed(2)).join(' x ')}] cm`)
console.log(order.map(n => `${n}${fdi.get(n).c[0] > 0 ? '+' : '-'}`).join(' '))
