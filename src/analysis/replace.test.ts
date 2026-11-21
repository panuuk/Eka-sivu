import { beforeEach, describe, expect, it } from 'vitest'
import { createNode, createProcess, createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { opsReplace, planReplace } from './replace'

beforeEach(() => useDeterministicIds(true))

function setup() {
  const p0 = createProject()
  const other = createProcess('Toinen')
  const a = createNode(p0.rootProcessId, {
    label: 'Tarkista lasku',
    description: 'Lasku tarkistetaan',
  })
  const b = createNode(p0.rootProcessId, { label: 'Hyväksy LASKU' })
  const c = createNode(other.id, { label: 'Kirjaa lasku', notes: 'lasku, lasku' })
  const p = applyOperations(p0, [
    { type: 'addProcess', process: other },
    ...[a, b, c].map((node) => ({ type: 'addNode' as const, node })),
  ])
  return { p, a, b, c, other }
}

describe('etsi ja korvaa', () => {
  it('korvaa kirjainkoosta riippumatta ja laskee osumat', () => {
    const { p } = setup()
    const ch = planReplace(p, {
      find: 'lasku',
      replace: 'tilaus',
      caseSensitive: false,
      fields: ['label'],
    })
    expect(ch.map((c) => c.after).sort()).toEqual([
      'Hyväksy tilaus',
      'Kirjaa tilaus',
      'Tarkista tilaus',
    ])
  })

  it('kirjainkoko-asetus ja kenttärajaus toimivat', () => {
    const { p } = setup()
    const ch = planReplace(p, {
      find: 'lasku',
      replace: 'X',
      caseSensitive: true,
      fields: ['label', 'notes'],
    })
    expect(ch.map((c) => `${c.field}:${c.after}`).sort()).toEqual([
      'label:Kirjaa X',
      'label:Tarkista X',
      'notes:X, X',
    ])
  })

  it('rajaa prosessiin', () => {
    const { p, other } = setup()
    const ch = planReplace(p, {
      find: 'lasku',
      replace: 'X',
      caseSensitive: false,
      fields: ['label'],
      processId: other.id,
    })
    expect(ch).toHaveLength(1)
  })

  it('erikoismerkit etsinnässä ja korvauksessa käsitellään kirjaimellisesti', () => {
    const p0 = createProject()
    const n = createNode(p0.rootProcessId, { label: 'Hinta (EUR) $&' })
    const p = applyOperations(p0, [{ type: 'addNode', node: n }])
    const ch = planReplace(p, {
      find: '(EUR)',
      replace: '$&$&',
      caseSensitive: true,
      fields: ['label'],
    })
    expect(ch[0].after).toBe('Hinta $&$& $&')
  })

  it('operaatiot päivittävät mallin yhdellä erällä eikä nimi voi tyhjentyä', () => {
    const { p, a } = setup()
    const ch = planReplace(p, {
      find: 'Tarkista lasku',
      replace: '',
      caseSensitive: true,
      fields: ['label', 'description'],
    })
    const next = applyOperations(p, opsReplace(ch))
    expect(next.nodes[a.id].label).toBe('Tarkista lasku') // tyhjäksi jäävää nimeä ei muuteta
    const ch2 = planReplace(p, {
      find: 'tarkistetaan',
      replace: 'käsitellään',
      caseSensitive: false,
      fields: ['description'],
    })
    expect(applyOperations(p, opsReplace(ch2)).nodes[a.id].description).toBe('Lasku käsitellään')
  })

  it('tyhjä hakusana ei muuta mitään', () => {
    const { p } = setup()
    expect(
      planReplace(p, { find: '', replace: 'x', caseSensitive: false, fields: ['label'] }),
    ).toEqual([])
  })
})
