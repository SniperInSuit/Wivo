import { describe, expect, it } from 'vitest'
import { assignPerson, stagesOf } from './stageAssign'

const stages = [
  { stageKey: 'disain', people: ['a'] },
  { stageKey: 'print', people: [] },
  { stageKey: 'puhastus', people: ['b', 'a'] },
]

describe('quick assignment', () => {
  it('finds the stages a person is on', () => {
    expect(stagesOf(stages, 'a')).toEqual(['disain', 'puhastus'])
  })
  it('adds where ticked and removes where unticked, leaving others alone', () => {
    expect(assignPerson(stages, 'a', ['print', 'puhastus'])).toEqual([
      { stageKey: 'disain', people: [] },
      { stageKey: 'print', people: ['a'] },
    ])
  })
  it('lists nothing when nothing changes', () => {
    expect(assignPerson(stages, 'a', ['disain', 'puhastus'])).toEqual([])
  })
})
