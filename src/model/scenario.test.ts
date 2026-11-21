import { beforeEach, describe, expect, it } from 'vitest'
import { createEdge, createNode, createProject } from './factory'
import { useDeterministicIds } from './ids'
import { applyOperations } from './operations'
import { createScenario, createView, decisionsOf, scenarioPath } from './scenario'
import { parseProjectJson, projectToJson } from './serialize'
import { validateProject } from './validate'

beforeEach(() => useDeterministicIds(true))

function build() {
  const base = createProject()
  const root = base.rootProcessId
  const start = createNode(root, { kind: 'start', label: 'Alku' })
  const a = createNode(root, { label: 'A' })
  const d = createNode(root, { kind: 'decision', label: 'Ylittyykö raja?' })
  const yes = createNode(root, { label: 'Pyydä ennakko' })
  const no = createNode(root, { label: 'Jatka' })
  const z = createNode(root, { label: 'Z' })
  const end = createNode(root, { kind: 'end', label: 'Loppu' })
  const e = (f: { id: string }, t: { id: string }, l?: string) => createEdge(root, f.id, t.id, l)
  const edges = [
    e(start, a),
    e(a, d),
    e(d, yes, 'Kyllä'),
    e(d, no, 'Ei'),
    e(yes, z),
    e(no, z),
    e(z, end),
  ]
  const p = applyOperations(base, [
    ...[start, a, d, yes, no, z, end].map((node) => ({ type: 'addNode' as const, node })),
    ...edges.map((edge) => ({ type: 'addEdge' as const, edge })),
  ])
  return { p, root, d, yes, no, edges, start, end, z }
}

describe('skenaariopolku', () => {
  it('seuraa ensimmäistä haaraa oletuksena ja valittua haaraa, kun se on annettu', () => {
    const { p, root, d, yes, no, edges } = build()
    const first = scenarioPath(p, root)
    expect(first.nodeIds).toContain(yes.id)
    expect(first.nodeIds).not.toContain(no.id)
    expect(first.complete).toBe(true)
    const noEdge = edges.find((x) => x.from === d.id && x.to === no.id)!
    const second = scenarioPath(p, root, { [d.id]: noEdge.id })
    expect(second.nodeIds).toContain(no.id)
    expect(second.nodeIds).not.toContain(yes.id)
    expect(second.edgeIds.has(noEdge.id)).toBe(true)
  })

  it('numeroi vaiheet ilman alkua ja loppua', () => {
    const { p, root, start, end } = build()
    const path = scenarioPath(p, root)
    expect(path.order.has(start.id)).toBe(false)
    expect(path.order.has(end.id)).toBe(false)
    expect([...path.order.values()]).toEqual([1, 2, 3, 4]) // A, päätös, haara ja Z
  })

  it('katkaisee silmukan eikä jää ikuiseksi', () => {
    const { p, root, d } = build()
    const back = createEdge(root, Object.values(p.nodes).find((n) => n.label === 'Z')!.id, d.id)
    const looped = applyOperations(p, [{ type: 'addEdge', edge: back }])
    // poista Z -> loppu, jolloin ensimmäinen ulosmeno on silmukka
    const zEnd = Object.values(looped.edges).find((x) => x.from === back.from && x.to !== d.id)!
    const only = applyOperations(looped, [{ type: 'deleteEdge', id: zEnd.id }])
    const path = scenarioPath(only, root)
    expect(path.looped).toBe(true)
    expect(path.complete).toBe(false)
  })

  it('päätökset löydetään haaroineen, ja vioittunut valinta ei kaada polkua', () => {
    const { p, root, d } = build()
    expect(decisionsOf(p, root).map((x) => x.node.id)).toEqual([d.id])
    const path = scenarioPath(p, root, { [d.id]: 'olematon-yhteys', poistettu: 'x' })
    expect(path.complete).toBe(true)
  })
})

describe('skenaariot ja näkymät mallissa', () => {
  it('operaatiot, järjestys ja siivous prosessin poistuessa', () => {
    const { p, root, d, edges } = build()
    const sc = createScenario(root, 'Ennakko', { [d.id]: edges[2].id })
    const v1 = createView({
      name: 'Yleiskuva',
      processId: root,
      expand: false,
      onlyConfirmed: false,
      showMetrics: false,
      heat: 'off',
      changes: false,
    })
    const v2 = { ...v1, id: 'view2', name: 'Skenaario', scenarioId: sc.id }
    let q = applyOperations(p, [
      { type: 'addScenario', scenario: sc },
      { type: 'addView', view: v1 },
      { type: 'addView', view: v2 },
    ])
    expect(q.views!.map((v) => v.name)).toEqual(['Yleiskuva', 'Skenaario'])
    q = applyOperations(q, [{ type: 'moveView', id: 'view2', index: 0 }])
    expect(q.views!.map((v) => v.name)).toEqual(['Skenaario', 'Yleiskuva'])
    q = applyOperations(q, [{ type: 'deleteScenario', id: sc.id }])
    expect(q.scenarios).toBeUndefined()
    expect(q.views!.find((v) => v.id === 'view2')!.scenarioId).toBeUndefined()
    expect(validateProject(q)).toEqual([])
    q = applyOperations(q, [
      { type: 'deleteView', id: v1.id },
      { type: 'deleteView', id: 'view2' },
    ])
    expect(q.views).toBeUndefined()
  })

  it('prosessin poisto poistaa siihen sidotut näkymät ja skenaariot', () => {
    const { p, root } = build()
    const sub = { id: 'proc_sub', name: 'Ala', parentNodeId: undefined }
    let q = applyOperations(p, [{ type: 'addProcess', process: sub }])
    const sc = createScenario(sub.id, 'S', {})
    const v = createView({
      name: 'V',
      processId: sub.id,
      expand: false,
      onlyConfirmed: false,
      showMetrics: false,
      heat: 'off',
      changes: false,
      scenarioId: sc.id,
    })
    q = applyOperations(q, [
      { type: 'addScenario', scenario: sc },
      { type: 'addView', view: v },
    ])
    q = applyOperations(q, [{ type: 'deleteProcess', id: sub.id }])
    expect(q.scenarios).toBeUndefined()
    expect(q.views).toBeUndefined()
    void root
  })

  it('säilyvät JSON-kierroksessa, ja viallinen tietue pudotetaan', () => {
    const { p, root, d, edges } = build()
    const sc = createScenario(root, 'Ennakko', { [d.id]: edges[2].id })
    const v = createView({
      name: 'V',
      processId: root,
      expand: true,
      onlyConfirmed: false,
      showMetrics: true,
      heat: 'pain',
      changes: false,
      scenarioId: sc.id,
      focusNodeIds: [d.id],
    })
    const q = applyOperations(p, [
      { type: 'addScenario', scenario: sc },
      { type: 'addView', view: v },
    ])
    const back = parseProjectJson(projectToJson(q))
    expect(back.scenarios![sc.id].choices).toEqual(sc.choices)
    expect(back.views![0]).toEqual(v)
    const broken = JSON.parse(projectToJson(q))
    broken.project.views = [{ nope: 1 }]
    broken.project.scenarios = { x: { name: 3 } }
    const loaded = parseProjectJson(JSON.stringify(broken))
    expect(loaded.views).toBeUndefined()
    expect(loaded.scenarios).toBeUndefined()
  })
})
