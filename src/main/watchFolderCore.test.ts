import { describe, it, expect } from 'vitest'
import { isInside, isWatchedFile, fileKey, unsorted } from './watchFolderCore'

describe('isInside', () => {
  const root = '/Users/lab/Scans'
  it('accepts files in the folder and below', () => {
    expect(isInside(root, '/Users/lab/Scans/case1.stl')).toBe(true)
    expect(isInside(root, '/Users/lab/Scans/2026/case2/upper.stl')).toBe(true)
  })
  it('refuses everything else, including tricks with ..', () => {
    expect(isInside(root, '/Users/lab/Scans')).toBe(false)
    expect(isInside(root, '/Users/lab/Secrets/a.stl')).toBe(false)
    expect(isInside(root, '/Users/lab/Scans/../Secrets/a.stl')).toBe(false)
    expect(isInside(root, '/Users/lab/ScansEvil/a.stl')).toBe(false)
    expect(isInside(root, '/etc/passwd')).toBe(false)
    expect(isInside('', '/Users/lab/Scans/a.stl')).toBe(false)
  })
})

describe('isWatchedFile', () => {
  it('takes scans, x-rays and photos, not hidden or unrelated files', () => {
    expect(isWatchedFile('Upper.STL')).toBe(true)
    expect(isWatchedFile('cbct.dcm')).toBe(true)
    expect(isWatchedFile('.DS_Store')).toBe(false)
    expect(isWatchedFile('notes.txt')).toBe(false)
  })
})

describe('unsorted', () => {
  it('hides handled files and lists the newest first', () => {
    const a = { path: '/s/a.stl', name: 'a.stl', size: 1, modifiedAt: 1, key: fileKey('/s/a.stl', 1, 1) }
    const b = { path: '/s/b.stl', name: 'b.stl', size: 1, modifiedAt: 2, key: fileKey('/s/b.stl', 1, 2) }
    const c = { path: '/s/c.stl', name: 'c.stl', size: 1, modifiedAt: 3, key: fileKey('/s/c.stl', 1, 3) }
    expect(unsorted([a, b, c], { [b.key]: { jobId: 'x' } }).map(f => f.name)).toEqual(['c.stl', 'a.stl'])
  })
  it('a re-exported file (new size or time) shows up again', () => {
    expect(fileKey('/s/a.stl', 10, 5)).not.toBe(fileKey('/s/a.stl', 11, 5))
  })
})
