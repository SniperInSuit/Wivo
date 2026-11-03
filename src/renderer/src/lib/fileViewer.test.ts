import { describe, it, expect } from 'vitest'
import { viewKind, stepIndex, clampZoom, zoomStep, clampPan, swipeDirection, viewerFor, attachmentViewerFor, MAX_ZOOM } from './fileViewer'

describe('which files open in the viewer', () => {
  it('images and PDFs; everything else downloads', () => {
    for (const n of ['photo.jpg', 'IMG_1.JPEG', 'a.png', 'b.webp', 'c.gif', 'd.bmp', 'e.avif']) expect(viewKind(n), n).toBe('image')
    expect(viewKind('saatekiri.PDF')).toBe('pdf')
    for (const n of ['scan.stl', 'design.ply', 'iphone.heic', 'xray.tiff', 'notes.txt', 'archive.zip', 'jpg', 'photo.jpg.zip']) {
      expect(viewKind(n), n).toBeNull()
    }
  })
})

describe('moving between images', () => {
  it('arrows go round at either end', () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(2, 3, 1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
    expect(stepIndex(0, 1, 1)).toBe(0)
    expect(stepIndex(0, 0, 1)).toBe(0)
  })

  it('a swipe is mostly sideways and long enough, and not while zoomed in', () => {
    expect(swipeDirection(-120, 10, 1)).toBe(1)
    expect(swipeDirection(120, -10, 1)).toBe(-1)
    expect(swipeDirection(-30, 0, 1)).toBe(0)
    expect(swipeDirection(-100, 90, 1)).toBe(0)
    expect(swipeDirection(-200, 0, 2)).toBe(0)
  })
})

describe('zoom', () => {
  it('between 1× and the maximum, half a step at a time', () => {
    expect(zoomStep(1, 1)).toBe(1.5)
    expect(zoomStep(1.5, -1)).toBe(1)
    expect(zoomStep(1, -1)).toBe(1)
    expect(zoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(100)).toBe(MAX_ZOOM)
  })

  it('a zoomed image is dragged only until its edge meets the frame', () => {
    const frame = { w: 400, h: 300 }
    expect(clampPan({ x: 500, y: -500 }, 2, frame)).toEqual({ x: 200, y: -150 })
    expect(clampPan({ x: 50, y: 20 }, 2, frame)).toEqual({ x: 50, y: 20 })
    expect(clampPan({ x: 50, y: 20 }, 1, frame)).toEqual({ x: 0, y: 0 })
  })
})

describe('what opens when a file is clicked', () => {
  const f = (id: string, file_name: string, extra: Partial<{ is_active: boolean; completed: boolean }> = {}) =>
    ({ id, file_name, is_active: true, completed: true, ...extra })
  const files = [f('a', 'front.jpg'), f('s', 'scan.stl'), f('b', 'side.PNG'), f('p', 'saatekiri.pdf'),
                 f('old', 'front-v1.jpg', { is_active: false }), f('up', 'uploading.jpg', { completed: false })]

  it('an image: among the job\'s current, finished images, in list order, starting at it', () => {
    expect(viewerFor(files[2], files)).toEqual({ files: [files[0], files[2]], start: 1 })
  })

  it('a PDF, or an older version of an image: alone', () => {
    expect(viewerFor(files[3], files)).toEqual({ files: [files[3]], start: 0 })
    expect(viewerFor(files[4], files)).toEqual({ files: [files[4]], start: 0 })
  })

  it('anything else does not open (it downloads)', () => {
    expect(viewerFor(files[1], files)).toBeNull()
  })
})

describe('a chat attachment clicked in a job\'s thread', () => {
  const a = (id: string, file_name: string) => ({ id, file_name })
  const thread = [a('p1', 'first.jpg'), a('s1', 'scan.stl'), a('p2', 'second.png'), a('d1', 'saatekiri.pdf'), a('p1', 'first.jpg'), a('p3', 'third.webp')]

  it('an image: among the thread\'s images, in thread order, each file once', () => {
    expect(attachmentViewerFor(thread[2], thread)).toEqual({ files: [thread[0], thread[2], thread[5]], start: 1 })
    expect(attachmentViewerFor(thread[4], thread)).toEqual({ files: [thread[0], thread[2], thread[5]], start: 0 })
  })

  it('a PDF alone; anything else does not open (it downloads)', () => {
    expect(attachmentViewerFor(thread[3], thread)).toEqual({ files: [thread[3]], start: 0 })
    expect(attachmentViewerFor(thread[1], thread)).toBeNull()
  })

  it('an image not (yet) in the list still opens, alone', () => {
    expect(attachmentViewerFor(a('new', 'new.jpg'), thread)).toEqual({ files: [a('new', 'new.jpg')], start: 0 })
  })
})
