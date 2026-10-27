/**
 * The 3D chart's decisions, tested without a GPU.
 *
 * WebGL does not run under jsdom, so these cover everything that can be decided
 * before anything is drawn. What is left uncovered — that the picture is
 * correct — is checked by hand against a packaged build, because development
 * cannot show the `file://` class of failure at all.
 */
import { describe, it, expect } from 'vitest'
import {
  parseToothName, viewOffset, decideGesture, CAMERA_VIEWS, VIEW_LABELS,
  patientRightSign, RIGHT_SIDE_PROBES,
} from './odontogram3dCore'

describe('parseToothName', () => {
  it('reads the FDI number out of a node name', () => {
    expect(parseToothName('tooth_11')).toBe(11)
    expect(parseToothName('tooth_48')).toBe(48)
  })

  it('strips the suffix Blender adds to a duplicate', () => {
    // Without this the symptom is "half the teeth do not react", which looks
    // like a raycasting bug and is not one.
    expect(parseToothName('tooth_16.001')).toBe(16)
    expect(parseToothName('tooth_16.012')).toBe(16)
  })

  it('ignores everything that is not a tooth', () => {
    expect(parseToothName('gingiva')).toBeNull()
    expect(parseToothName('')).toBeNull()
    expect(parseToothName('Scene')).toBeNull()
    expect(parseToothName('tooth_')).toBeNull()
  })

  it('rejects numbers outside the FDI range rather than inventing a tooth', () => {
    expect(parseToothName('tooth_51')).toBeNull()  // quadrant 5
    expect(parseToothName('tooth_09')).toBeNull()  // quadrant 0
    expect(parseToothName('tooth_19')).toBeNull()  // ninth tooth
    expect(parseToothName('tooth_10')).toBeNull()  // zeroth tooth
  })

  it('covers every real FDI number', () => {
    const all = [1, 2, 3, 4].flatMap(q => [1, 2, 3, 4, 5, 6, 7, 8].map(i => q * 10 + i))
    expect(all.filter(n => parseToothName(`tooth_${n}`) === n)).toHaveLength(32)
  })
})

describe('camera presets', () => {
  it('has a label for every view, and no label without a view', () => {
    expect(VIEW_LABELS.map(v => v.view).sort())
      .toEqual(Object.keys(CAMERA_VIEWS).sort())
  })

  it('never looks dead-on, so occlusal surfaces stay lit', () => {
    // A pure front view of a closed bite shows two rows of enamel and no
    // chewing surfaces at all.
    for (const [name, dir] of Object.entries(CAMERA_VIEWS)) {
      const zeros = dir.filter(v => v === 0).length
      expect(zeros, `${name} is axis-aligned`).toBeLessThan(2)
    }
  })

  it('puts the camera further out for a bigger model', () => {
    const near = viewOffset('front', 5, 38)
    const far = viewOffset('front', 10, 38)
    expect(Math.hypot(...far)).toBeGreaterThan(Math.hypot(...near))
  })

  it('scales distance linearly with the model, whatever the preset', () => {
    for (const view of VIEW_LABELS.map(v => v.view)) {
      const a = Math.hypot(...viewOffset(view, 4, 38))
      const b = Math.hypot(...viewOffset(view, 8, 38))
      expect(b / a).toBeCloseTo(2, 5)
    }
  })

  it('keeps the same distance in every direction', () => {
    const lens = VIEW_LABELS.map(v => Math.hypot(...viewOffset(v.view, 6, 38)))
    for (const l of lens) expect(l).toBeCloseTo(lens[0], 5)
  })

  it('points each preset the way its name says', () => {
    expect(viewOffset('top', 6, 38)[1]).toBeGreaterThan(0)
    expect(viewOffset('bottom', 6, 38)[1]).toBeLessThan(0)
    expect(viewOffset('left', 6, 38)[0]).toBeLessThan(0)
    expect(viewOffset('right', 6, 38)[0]).toBeGreaterThan(0)
    expect(viewOffset('front', 6, 38)[2]).toBeGreaterThan(0)
  })

  it('needs a wider frame for a narrower lens', () => {
    expect(Math.hypot(...viewOffset('front', 6, 20)))
      .toBeGreaterThan(Math.hypot(...viewOffset('front', 6, 60)))
  })
})

describe('decideGesture', () => {
  it('marks when the press landed on a tooth', () => {
    expect(decideGesture(true, false)).toBe('mark')
  })

  it('orbits from empty space', () => {
    expect(decideGesture(false, false)).toBe('orbit')
  })

  it('orbits on the secondary button even from a tooth', () => {
    // The escape hatch for a mouth so full of teeth there is no empty space
    // left to grab.
    expect(decideGesture(true, true)).toBe('orbit')
  })
})

describe('patientRightSign', () => {
  it('reads the patient right as -X when tooth 16 sits left of centre', () => {
    expect(patientRightSign(-2.1, 0)).toBe(-1)
  })

  it('reads it as +X when tooth 16 sits right of centre', () => {
    expect(patientRightSign(2.1, 0)).toBe(1)
  })

  it('does not assume the model is centred on the origin', () => {
    // The box centre is whatever the exporter produced, not necessarily 0.
    expect(patientRightSign(8.9, 11)).toBe(-1)
    expect(patientRightSign(13.1, 11)).toBe(1)
  })

  it('answers the mirrored model the other way round', () => {
    // The whole reason this is measured: flipping the converter's mirror flag
    // produces a file that looks identical and IS the other way round. If this
    // ever stops following the measurement, the chart shows the correct FDI
    // numbers on the wrong sides — the one error nobody catches by looking.
    const upright = patientRightSign(-2.1, 0)
    const mirrored = patientRightSign(2.1, 0)
    expect(mirrored).toBe(-upright)
  })

  it('probes only teeth in the upper right quadrant', () => {
    // A probe from any other quadrant would answer the opposite question.
    for (const fdi of RIGHT_SIDE_PROBES) {
      expect(Math.floor(fdi / 10)).toBe(1)
    }
  })

  it('has a probe for every tooth of that quadrant, so gaps cannot blind it', () => {
    expect([...RIGHT_SIDE_PROBES].sort((a, b) => a - b))
      .toEqual([11, 12, 13, 14, 15, 16, 17, 18])
  })
})
