import { describe, expect, it } from 'vitest'
import { createEdge, createNode, createProject } from './factory'
import { flowOrder } from './flow'
import { applyOperations } from './operations'

describe('flowOrder', () => {
  it('järjestää haarat peräkkäin ja näyttää yhdistyvän solmun kerran', () => {
    let p = createProject()
    const r = p.rootProcessId
    const [s, d, y, n, e, o] = ['Alku', 'Päätös', 'Kyllä-haara', 'Ei-haara', 'Loppu', 'Orpo'].map(
      (label, i) =>
        createNode(r, {
          label,
          kind: i === 0 ? 'start' : i === 1 ? 'decision' : i === 4 ? 'end' : 'step',
        }),
    )
    p = applyOperations(p, [
      ...[s, d, y, n, e, o].map((node) => ({ type: 'addNode' as const, node })),
      { type: 'addEdge', edge: createEdge(r, s.id, d.id) },
      { type: 'addEdge', edge: createEdge(r, d.id, y.id, 'Kyllä') },
      { type: 'addEdge', edge: createEdge(r, d.id, n.id, 'Ei') },
      { type: 'addEdge', edge: createEdge(r, y.id, e.id) },
      { type: 'addEdge', edge: createEdge(r, n.id, e.id) },
    ])
    const rows = flowOrder(p, r)
    expect(rows.map((x) => x.node.label)).toEqual([
      'Alku',
      'Päätös',
      'Kyllä-haara',
      'Loppu',
      'Ei-haara',
      'Orpo',
    ])
    expect(rows.find((x) => x.node.label === 'Orpo')!.orphan).toBe(true)
    expect(rows.find((x) => x.node.label === 'Alku')!.orphan).toBe(false)
    expect(rows.find((x) => x.node.label === 'Kyllä-haara')!.depth).toBe(1)
  })

  it('käsittelee syklit päättymättä', () => {
    let p = createProject()
    const r = p.rootProcessId
    const a = createNode(r, { label: 'A' })
    const b = createNode(r, { label: 'B' })
    p = applyOperations(p, [
      { type: 'addNode', node: a },
      { type: 'addNode', node: b },
      { type: 'addEdge', edge: createEdge(r, a.id, b.id) },
      { type: 'addEdge', edge: createEdge(r, b.id, a.id) },
    ])
    expect(flowOrder(p, r)).toHaveLength(2)
  })
})
