import { beforeEach, describe, expect, it } from 'vitest'
import { MIN_PER_DAY as D } from '../model/duration'
import {
  createEdge,
  createEntity,
  createNode,
  createProcess,
  createProject,
} from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import type { ProcessNode } from '../model/types'
import { analyzeMetrics } from './metrics'

beforeEach(() => useDeterministicIds(true))

function build() {
  const base = createProject()
  const root = base.rootProcessId
  const myynti = createEntity('role', 'Myynti')
  const talous = createEntity('role', 'Talous')
  const mk = (label: string, init: Partial<ProcessNode> = {}) =>
    createNode(root, { label, ...init })
  const start = mk('Alku', { kind: 'start' })
  const a = mk('A', { roleId: myynti.id, duration: { typical: 1 * D } })
  const b = mk('B', {
    roleId: talous.id,
    duration: { min: 1 * D, typical: 2 * D, max: 4 * D },
    waiting: { typical: 1 * D },
  })
  const d = mk('Kunnossa?', { kind: 'decision', roleId: talous.id })
  const c = mk('C', { roleId: talous.id, duration: { typical: 1 * D } })
  const end = mk('Loppu', { kind: 'end' })
  const e = (f: ProcessNode, t: ProcessNode, label?: string) => ({
    type: 'addEdge' as const,
    edge: createEdge(root, f.id, t.id, label),
  })
  const p = applyOperations(base, [
    { type: 'addEntity', entity: myynti },
    { type: 'addEntity', entity: talous },
    ...[start, a, b, d, c, end].map((node) => ({ type: 'addNode' as const, node })),
    e(start, a),
    e(a, b),
    e(b, d),
    e(d, c, 'Kyllä'),
    e(d, a, 'Ei'), // paluu = uudelleenkierros
    e(c, end),
  ])
  return { p, root, a, b, c, d, myynti, talous }
}

describe('analyzeMetrics', () => {
  it('laskee luovutukset roolien välillä', () => {
    const { p, root, myynti, talous } = build()
    const m = analyzeMetrics(p).perProcess.get(root)!
    // A(Myynti)->B(Talous): luovutus. D->A (Talous->Myynti): luovutus. B->D, D->C samaa roolia.
    expect(m.handoffs).toHaveLength(2)
    const pairs = analyzeMetrics(p).rolePairs
    expect(pairs.find((x) => x.fromRoleId === myynti.id && x.toRoleId === talous.id)?.count).toBe(1)
    expect(pairs.find((x) => x.fromRoleId === talous.id && x.toRoleId === myynti.id)?.count).toBe(1)
    // vastaanottajan odotus liitetään luovutukseen
    expect(pairs.find((x) => x.toRoleId === talous.id)?.waiting).toBe(1 * D)
  })

  it('tunnistaa uudelleenkierroksen ja sen keston', () => {
    const { p, root, a, b, d } = build()
    const m = analyzeMetrics(p).perProcess.get(root)!
    expect(m.loops).toHaveLength(1)
    expect(m.loops[0].fromId).toBe(d.id)
    expect(m.loops[0].toId).toBe(a.id)
    expect(new Set(m.loops[0].nodeIds)).toEqual(new Set([a.id, b.id, d.id]))
    // A 1 pv + B 2 pv + odotus 1 pv
    expect(m.loops[0].extraMinutes).toBe(4 * D)
  })

  it('arvioi läpimenoajan polkua pitkin ilman kierroksen kaksinkertaistumista', () => {
    const { p, root } = build()
    const lead = analyzeMetrics(p).perProcess.get(root)!.lead
    // A 1 + (B 2 + odotus 1) + C 1 = 5 pv tyypillisesti
    expect(lead.typicalHigh).toBe(5 * D)
    expect(lead.typicalLow).toBe(5 * D)
    // minimi: A 1 + B min 1 + odotus (ei minimiä -> typical 1) + C 1 = 4
    expect(lead.best).toBe(4 * D)
    // maksimi: A 1 + B 4 + 1 + C 1 = 7
    expect(lead.worst).toBe(7 * D)
    expect(lead.coveredSteps).toBe(lead.pathSteps - 1) // päätöksellä ei ole kestoa
  })

  it('haarautuva prosessi antaa lyhimmän ja pisimmän polun', () => {
    const base = createProject()
    const root = base.rootProcessId
    const mk = (label: string, min?: number) =>
      createNode(root, { label, duration: min ? { typical: min * D } : undefined })
    const s = createNode(root, { label: 'Alku', kind: 'start' })
    const dec = createNode(root, { label: 'Haara?', kind: 'decision' })
    const fast = mk('Nopea', 1)
    const slow = mk('Hidas', 10)
    const end = createNode(root, { label: 'Loppu', kind: 'end' })
    const ed = (f: ProcessNode, t: ProcessNode) => ({
      type: 'addEdge' as const,
      edge: createEdge(root, f.id, t.id),
    })
    const p = applyOperations(base, [
      ...[s, dec, fast, slow, end].map((node) => ({ type: 'addNode' as const, node })),
      ed(s, dec),
      ed(dec, fast),
      ed(dec, slow),
      ed(fast, end),
      ed(slow, end),
    ])
    const lead = analyzeMetrics(p).perProcess.get(root)!.lead
    expect(lead.typicalLow).toBe(1 * D)
    expect(lead.typicalHigh).toBe(10 * D)
    expect(lead.criticalPath).toContain(slow.id)
  })

  it('ilman kestoarvioita läpimenoaikaa ei arvioida', () => {
    const base = createProject()
    const n = createNode(base.rootProcessId, { label: 'X' })
    const p = applyOperations(base, [{ type: 'addNode', node: n }])
    const m = analyzeMetrics(p).perProcess.get(base.rootProcessId)!
    expect(m.lead.typicalHigh).toBeUndefined()
    expect(m.estimatedSteps).toBe(0)
  })

  it('alaprosessin kesto tulee vanhemman painoksi, ellei vanhemmalla ole omaa arviota', () => {
    const base = createProject()
    const root = base.rootProcessId
    const parent = createNode(root, { label: 'Ala', kind: 'subprocess' })
    const child = createProcess('Ala', parent.id)
    const inner = createNode(child.id, { label: 'Sisä', duration: { typical: 3 * D } })
    const s = createNode(root, { label: 'Alku', kind: 'start' })
    const e = createNode(root, { label: 'Loppu', kind: 'end' })
    const p = applyOperations(base, [
      { type: 'addNode', node: parent },
      { type: 'addProcess', process: child },
      { type: 'updateNode', id: parent.id, patch: { childProcessId: child.id } },
      { type: 'addNode', node: inner },
      { type: 'addNode', node: s },
      { type: 'addNode', node: e },
      { type: 'addEdge', edge: createEdge(root, s.id, parent.id) },
      { type: 'addEdge', edge: createEdge(root, parent.id, e.id) },
    ])
    const m = analyzeMetrics(p)
    expect(m.perProcess.get(root)!.lead.typicalHigh).toBe(3 * D)
    expect(m.nodeTime.get(parent.id)).toBe(3 * D)
  })

  it('roolien kuormitus ja kipupisteet kootaan projektitasolla', () => {
    const { p, myynti, talous, b } = build()
    const withPain = applyOperations(p, [
      {
        type: 'updateNode',
        id: b.id,
        patch: {
          painPoints: [{ id: 'pp1', text: 'Viivästyy usein', severity: 3, idea: 'Automatisoi' }],
        },
      },
    ])
    const m = analyzeMetrics(withPain)
    const load = (id: string) => m.roleLoad.find((r) => r.roleId === id)!
    expect(load(myynti.id).effort).toBe(1 * D)
    expect(load(talous.id).effort).toBe(3 * D) // B 2 + C 1
    expect(load(talous.id).waiting).toBe(1 * D)
    expect(m.painPoints).toHaveLength(1)
    expect(m.painPoints[0].idea).toBe('Automatisoi')
  })

  it('suuri prosessi (iteratiivinen DFS) ei kaada pinoa', () => {
    const base = createProject()
    const root = base.rootProcessId
    const nodes = Array.from({ length: 5000 }, (_, i) =>
      createNode(root, { label: `N${i}`, duration: { typical: 1 } }),
    )
    // Rakennetaan suoraan: yksittäiset operaatiot kopioisivat tietueita neliöllisesti.
    const p = {
      ...base,
      nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
      edges: Object.fromEntries(
        nodes.slice(1).map((n, i) => {
          const e = createEdge(root, nodes[i].id, n.id)
          return [e.id, e]
        }),
      ),
    }
    expect(analyzeMetrics(p).perProcess.get(root)!.lead.typicalHigh).toBe(5000)
  })
})
