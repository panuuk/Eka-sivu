import { describe, expect, it } from 'vitest'
import { diffSummary } from './summary'
import { indentLines } from './indent'

describe('indentLines', () => {
  it('lisää kaksi välilyöntiä kohdistimen kohtaan ilman valintaa', () => {
    expect(indentLines('ab', 1, 1, false)).toEqual({ text: 'a  b', start: 3, end: 3 })
  })

  it('sisentää kaikki valitut rivit', () => {
    const r = indentLines('a\nb\nc', 0, 3, false)
    expect(r.text).toBe('  a\n  b\nc')
    expect(r.start).toBe(2)
    expect(r.end).toBe(7)
  })

  it('poistaa sisennystä enintään kaksi merkkiä riviltä', () => {
    expect(indentLines('    a\n b\nc', 0, 9, true).text).toBe('  a\nb\nc')
    expect(indentLines('\ta', 1, 1, true).text).toBe('a')
  })

  it('shift+tab riville ilman sisennystä ei muuta mitään', () => {
    expect(indentLines('a', 0, 0, true).text).toBe('a')
  })
})

describe('diffSummary', () => {
  it('muodostaa suomenkielisen yhteenvedon oikeilla taivutuksilla', () => {
    const base = {
      newNodes: [],
      changedNodes: [],
      newEdges: [],
      removedEdges: [],
      removedNodes: [],
      newEntities: [],
      newProcesses: [],
      newSources: [],
    }
    expect(diffSummary(base)).toBe('')
    expect(
      diffSummary({
        ...base,
        newNodes: [
          { id: '1', label: 'a', kind: 'step' },
          { id: '2', label: 'b', kind: 'decision' },
        ],
        newEdges: [{ id: 'e', from: '1', to: '2' }],
        newEntities: [{ id: 'r', name: 'Myynti', kind: 'role' }],
      }),
    ).toBe('1 uusi vaihe · 1 uusi päätös · 1 yhteys · 1 uusi rooli')
  })
})
