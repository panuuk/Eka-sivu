import { beforeEach, describe, expect, it } from 'vitest'
import {
  ensureEntity,
  opsDeleteNodeBridging,
  opsDuplicateProcess,
  opsExpandNode,
  opsGroupIntoSubprocess,
  opsInsertAfter,
  opsMergeEntities,
} from './commands'
import { createEdge, createEntity, createNode, createProcess, createProject } from './factory'
import { useDeterministicIds } from './ids'
import { applyOperation, applyOperations, OperationError, type Operation } from './operations'
import { parseProjectJson, projectToJson, ImportError, migrateProject } from './serialize'
import { edgesOf, findEntity, nodesOf, processPath, processTree, reachableFrom } from './selectors'
import { validateProject } from './validate'
import type { Project } from './types'

beforeEach(() => useDeterministicIds(true))

/** Pieni A -> B -> C -prosessi. */
function sample(): { p: Project; a: string; b: string; c: string; root: string } {
  let p = createProject('Testi')
  const root = p.rootProcessId
  const a = createNode(root, { label: 'A', kind: 'start' })
  const b = createNode(root, { label: 'B' })
  const c = createNode(root, { label: 'C', kind: 'end' })
  p = applyOperations(p, [
    { type: 'addNode', node: a },
    { type: 'addNode', node: b },
    { type: 'addNode', node: c },
    { type: 'addEdge', edge: createEdge(root, a.id, b.id) },
    { type: 'addEdge', edge: createEdge(root, b.id, c.id) },
  ])
  return { p, a: a.id, b: b.id, c: c.id, root }
}

describe('operaatiot', () => {
  it('ei muuta alkuperäistä projektia (immutable)', () => {
    const { p, b } = sample()
    const before = JSON.stringify(p)
    applyOperation(p, { type: 'updateNode', id: b, patch: { label: 'Uusi' } })
    expect(JSON.stringify(p)).toBe(before)
  })

  it('updateNode päivittää ja undefined poistaa kentän', () => {
    const { p, b } = sample()
    const withRole = applyOperation(p, {
      type: 'updateNode',
      id: b,
      patch: { description: 'kuvaus', notes: 'x' },
    })
    expect(withRole.nodes[b].description).toBe('kuvaus')
    const cleared = applyOperation(withRole, {
      type: 'updateNode',
      id: b,
      patch: { description: undefined },
    })
    expect('description' in cleared.nodes[b]).toBe(false)
    expect(cleared.nodes[b].notes).toBe('x')
  })

  it('hylkää virheelliset operaatiot ja batch on atominen', () => {
    const { p, a, b } = sample()
    expect(() => applyOperation(p, { type: 'updateNode', id: 'puuttuu', patch: {} })).toThrow(
      OperationError,
    )
    expect(() =>
      applyOperation(p, { type: 'addEdge', edge: createEdge(p.rootProcessId, a, b) }),
    ).toThrow(/jo yhdistetty/)
    expect(() =>
      applyOperation(p, { type: 'addEdge', edge: createEdge(p.rootProcessId, a, a) }),
    ).toThrow(/itseensä/)
    expect(() =>
      applyOperation(p, {
        type: 'batch',
        ops: [
          { type: 'updateNode', id: a, patch: { label: 'X' } },
          { type: 'deleteNode', id: 'puuttuu' },
        ],
      }),
    ).toThrow(OperationError)
    expect(p.nodes[a].label).toBe('A')
  })

  it('reuna ei voi ylittää prosessin rajaa', () => {
    const { p, a } = sample()
    const other = createProcess('Toinen')
    const n = createNode(other.id, { label: 'X' })
    const p2 = applyOperations(p, [
      { type: 'addProcess', process: other },
      { type: 'addNode', node: n },
    ])
    expect(() =>
      applyOperation(p2, { type: 'addEdge', edge: createEdge(p.rootProcessId, a, n.id) }),
    ).toThrow(/saman prosessin/)
  })

  it('deleteNode poistaa reunat ja kysymykset', () => {
    const { p, b, root } = sample()
    const q = {
      id: 'q1',
      processId: root,
      targetId: b,
      rule: 'x',
      text: '?',
      status: 'open' as const,
      key: 'k',
    }
    const p2 = applyOperation(p, { type: 'addQuestion', question: q })
    const p3 = applyOperation(p2, { type: 'deleteNode', id: b })
    expect(Object.keys(p3.edges)).toHaveLength(0)
    expect(Object.keys(p3.questions)).toHaveLength(0)
    expect(validateProject(p3)).toEqual([])
  })

  it('deleteEntity siivoaa viittaukset', () => {
    const { p, b } = sample()
    const role = createEntity('role', 'Myynti')
    const sys = createEntity('system', 'CRM')
    const p2 = applyOperations(p, [
      { type: 'addEntity', entity: role },
      { type: 'addEntity', entity: sys },
      { type: 'updateNode', id: b, patch: { roleId: role.id, systemIds: [sys.id] } },
    ])
    expect(validateProject(p2)).toEqual([])
    const p3 = applyOperation(p2, { type: 'deleteEntity', id: role.id })
    expect(p3.nodes[b].roleId).toBeUndefined()
    expect(p3.nodes[b].systemIds).toEqual([sys.id])
    expect(validateProject(p3)).toEqual([])
  })

  it('deleteSource poistaa lähdeviitteet', () => {
    const { p, b } = sample()
    const src = { id: 's1', title: 'Muistio', kind: 'note' as const, text: 'abc', addedAt: 1 }
    const p2 = applyOperations(p, [
      { type: 'addSource', source: src },
      {
        type: 'updateNode',
        id: b,
        patch: { sources: [{ sourceId: 's1', start: 0, end: 3, quote: 'abc' }] },
      },
    ])
    const p3 = applyOperation(p2, { type: 'deleteSource', id: 's1' })
    expect(p3.nodes[b].sources).toEqual([])
    expect(validateProject(p3)).toEqual([])
  })

  it('päätason prosessia ei voi poistaa', () => {
    const { p, root } = sample()
    expect(() => applyOperation(p, { type: 'deleteProcess', id: root })).toThrow(/Päätason/)
  })

  it('syncQuestions säilyttää vastatut ja omat kysymykset sekä poistaa vanhentuneet avoimet', () => {
    const { p, b, root } = sample()
    const mk = (
      id: string,
      key: string,
      status: 'open' | 'answered' | 'dismissed',
      rule = 'r',
    ) => ({
      id,
      processId: root,
      targetId: b,
      rule,
      text: key,
      status,
      key,
    })
    let p2 = applyOperations(p, [
      { type: 'addQuestion', question: mk('q1', 'a', 'open') },
      { type: 'addQuestion', question: mk('q2', 'b', 'dismissed') },
      { type: 'addQuestion', question: mk('q3', 'c', 'open') },
      { type: 'addQuestion', question: mk('q4', 'omat', 'open', 'custom') },
    ])
    p2 = applyOperation(p2, {
      type: 'syncQuestions',
      processId: root,
      generated: [mk('g1', 'a', 'open'), mk('g2', 'b', 'open'), mk('g3', 'd', 'open')],
    })
    const keys = Object.values(p2.questions)
      .map((q) => `${q.key}:${q.status}`)
      .sort()
    expect(keys).toEqual(['a:open', 'b:dismissed', 'd:open', 'omat:open'])
    expect(p2.questions['q1']).toBeDefined() // sama id säilyy
  })
})

describe('komennot', () => {
  it('opsInsertAfter lisää väliin yksihaaraiseen jatkoon', () => {
    const { p, a, b, root } = sample()
    const { ops, nodeId } = opsInsertAfter(p, root, a, { label: 'Uusi' })
    const p2 = applyOperations(p, ops)
    const edges = edgesOf(p2, root).map((e) => `${p2.nodes[e.from].label}>${p2.nodes[e.to].label}`)
    expect(edges.sort()).toEqual(['A>Uusi', 'B>C', 'Uusi>B'])
    expect(p2.nodes[nodeId]).toBeDefined()
    expect(b).toBeDefined()
    expect(validateProject(p2)).toEqual([])
  })

  it('opsInsertAfter ilman edeltäjää luo irrallisen solmun', () => {
    const { p, root } = sample()
    const { ops } = opsInsertAfter(p, root, undefined, { label: 'Irrallinen' })
    expect(applyOperations(p, ops).nodes).not.toBe(p.nodes)
    expect(Object.keys(applyOperations(p, ops).edges)).toHaveLength(2)
  })

  it('opsDeleteNodeBridging yhdistää naapurit', () => {
    const { p, a, b, c } = sample()
    const p2 = applyOperations(p, opsDeleteNodeBridging(p, b))
    expect(p2.nodes[b]).toBeUndefined()
    const edges = Object.values(p2.edges)
    expect(edges).toHaveLength(1)
    expect(edges[0].from).toBe(a)
    expect(edges[0].to).toBe(c)
  })

  it('opsExpandNode luo alaprosessin ja on idempotentti', () => {
    const { p, b } = sample()
    const { ops, processId } = opsExpandNode(p, b)
    const p2 = applyOperations(p, ops)
    expect(p2.nodes[b].kind).toBe('subprocess')
    expect(p2.nodes[b].childProcessId).toBe(processId)
    expect(
      nodesOf(p2, processId)
        .map((n) => n.kind)
        .sort(),
    ).toEqual(['end', 'start'])
    expect(validateProject(p2)).toEqual([])
    expect(opsExpandNode(p2, b).ops).toEqual([])
    expect(processPath(p2, processId).map((x) => x.id)).toEqual([p.rootProcessId, processId])
    expect(processTree(p2).map((x) => x.depth)).toEqual([0, 1])
  })

  it('deleteProcess ja deleteNode poistavat alaprosessit rekursiivisesti', () => {
    const { p, b } = sample()
    const p2 = applyOperations(p, opsExpandNode(p, b).ops)
    const childId = p2.nodes[b].childProcessId!
    const p3 = applyOperation(p2, { type: 'deleteNode', id: b })
    expect(p3.processes[childId]).toBeUndefined()
    expect(Object.values(p3.nodes).every((n) => n.processId === p.rootProcessId)).toBe(true)
    // alaprosessin poisto vapauttaa vanhempivaiheen
    const p4 = applyOperation(p2, { type: 'deleteProcess', id: childId })
    expect(p4.nodes[b].childProcessId).toBeUndefined()
    expect(p4.nodes[b].kind).toBe('step')
    expect(validateProject(p4)).toEqual([])
  })

  it('opsGroupIntoSubprocess siirtää valinnan alaprosessiin ja säilyttää kytkennät', () => {
    const s0 = sample()
    let p = s0.p
    const root = s0.root
    const x = createNode(root, { label: 'X' })
    const c = Object.values(p.nodes).find((n) => n.label === 'C')!
    const b = Object.values(p.nodes).find((n) => n.label === 'B')!
    p = applyOperations(p, [
      { type: 'addNode', node: x },
      { type: 'deleteEdge', id: Object.values(p.edges).find((e) => e.from === b.id)!.id },
      { type: 'addEdge', edge: createEdge(root, b.id, x.id) },
      { type: 'addEdge', edge: createEdge(root, x.id, c.id) },
    ])
    const { ops, processId, nodeId } = opsGroupIntoSubprocess(p, [b.id, x.id], 'Ryhmä')
    const p2 = applyOperations(p, ops)
    expect(validateProject(p2)).toEqual([])
    expect(p2.nodes[b.id]).toBeUndefined()
    expect(p2.nodes[nodeId].childProcessId).toBe(processId)
    expect(
      nodesOf(p2, processId)
        .map((n) => n.label)
        .sort(),
    ).toEqual(['Alku', 'B', 'Loppu', 'X'])
    // A -> Ryhmä -> C
    const reach = reachableFrom(p2, [Object.values(p2.nodes).find((n) => n.label === 'A')!.id])
    expect(reach.has(nodeId)).toBe(true)
    expect(reach.has(c.id)).toBe(true)
  })

  it('opsGroupIntoSubprocess hylkää alku/loppu-solmut ja liian pienen valinnan', () => {
    const { p, a, b } = sample()
    expect(() => opsGroupIntoSubprocess(p, [b], 'x')).toThrow()
    expect(() => opsGroupIntoSubprocess(p, [a, b], 'x')).toThrow(/Alku/)
  })

  it('opsGroupIntoSubprocess siirtää sisäkkäisen alaprosessin mukana', () => {
    let p = sample().p
    const b = Object.values(p.nodes).find((n) => n.label === 'B')!
    p = applyOperations(p, opsExpandNode(p, b.id).ops)
    const x = createNode(p.rootProcessId, { label: 'X' })
    p = applyOperations(p, [
      { type: 'addNode', node: x },
      { type: 'addEdge', edge: createEdge(p.rootProcessId, b.id, x.id) },
    ])
    const { ops } = opsGroupIntoSubprocess(p, [b.id, x.id], 'Ryhmä')
    const p2 = applyOperations(p, ops)
    expect(validateProject(p2)).toEqual([])
    expect(Object.values(p2.processes)).toHaveLength(3)
  })

  it('opsDuplicateProcess kopioi koko puun uusilla tunnisteilla', () => {
    const { p, b } = sample()
    const p2 = applyOperations(p, opsExpandNode(p, b).ops)
    const { ops, processId } = opsDuplicateProcess(p2, p.rootProcessId)
    const p3 = applyOperations(p2, ops)
    expect(validateProject(p3)).toEqual([])
    expect(Object.keys(p3.processes)).toHaveLength(4)
    expect(p3.processes[processId].name).toMatch(/kopio/)
    expect(nodesOf(p3, processId)).toHaveLength(3)
    const ids = new Set(Object.keys(p3.nodes))
    expect(ids.size).toBe(Object.keys(p3.nodes).length)
  })

  it('ensureEntity löytää nimen/aliaksen perusteella ja välttää kaksoiskappaleet erässä', () => {
    const { p } = sample()
    const first = ensureEntity(p, 'role', ' Myynti ')
    expect(first.ops).toHaveLength(1)
    const p2 = applyOperations(p, first.ops)
    expect(ensureEntity(p2, 'role', 'myynti').ops).toHaveLength(0)
    expect(ensureEntity(p2, 'system', 'Myynti').ops).toHaveLength(1)
    const again = ensureEntity(p, 'role', 'MYYNTI', first.ops)
    expect(again.id).toBe(first.id)
    expect(again.ops).toHaveLength(0)
  })

  it('opsMergeEntities siirtää viittaukset ja säilyttää nimen aliaksena', () => {
    const { p, b } = sample()
    const r1 = createEntity('role', 'Myynti')
    const r2 = createEntity('role', 'Myyntiosasto')
    const p2 = applyOperations(p, [
      { type: 'addEntity', entity: r1 },
      { type: 'addEntity', entity: r2 },
      { type: 'updateNode', id: b, patch: { roleId: r2.id } },
    ])
    const p3 = applyOperations(p2, opsMergeEntities(p2, r2.id, r1.id))
    expect(p3.nodes[b].roleId).toBe(r1.id)
    expect(p3.entities[r2.id]).toBeUndefined()
    expect(findEntity(p3, 'role', 'myyntiosasto')?.id).toBe(r1.id)
    expect(validateProject(p3)).toEqual([])
  })
})

describe('serialisointi', () => {
  it('JSON-kierros säilyttää datan', () => {
    const { p } = sample()
    const back = parseProjectJson(projectToJson(p))
    expect(back).toEqual(p)
  })

  it('hylkää väärän tiedoston ja uudemman skeeman', () => {
    expect(() => parseProjectJson('ei json')).toThrow(ImportError)
    expect(() => parseProjectJson('{"foo":1}')).toThrow(/Prosessikartan/)
    const { p } = sample()
    const text = projectToJson(p).replace('"schemaVersion": 1', '"schemaVersion": 99')
    expect(() => parseProjectJson(text)).toThrow(/uudemmasta/)
  })

  it('täydentää puuttuvat kentät ja havaitsee vioittuneen projektin', () => {
    const { p } = sample()
    const raw = JSON.parse(JSON.stringify(p))
    for (const n of Object.values(raw.nodes) as Record<string, unknown>[]) delete n.systemIds
    delete raw.questions
    const fixed = migrateProject(raw)
    expect(Object.values(fixed.nodes)[0].systemIds).toEqual([])
    expect(fixed.questions).toEqual({})
    const broken = JSON.parse(JSON.stringify(p))
    broken.edges[Object.keys(broken.edges)[0]].to = 'olematon'
    expect(() => migrateProject(broken)).toThrow(/vioittunut/)
  })
})

describe('validointi', () => {
  it('havaitsee epäjohdonmukaiset alaprosessiviittaukset', () => {
    const { p, b } = sample()
    const p2 = applyOperations(p, opsExpandNode(p, b).ops)
    const bad = {
      ...p2,
      nodes: { ...p2.nodes, [b]: { ...p2.nodes[b], childProcessId: undefined } },
    }
    delete bad.nodes[b].childProcessId
    expect(validateProject(bad).some((i) => i.code === 'parent-mismatch')).toBe(true)
  })
})

describe('operaatiotyypit ovat sarjallistettavia', () => {
  it('operaatiolista säilyy JSON-kierroksessa', () => {
    const { p, b } = sample()
    const ops: Operation[] = [
      { type: 'updateNode', id: b, patch: { label: 'Z', confidence: 'confirmed' } },
    ]
    const again = JSON.parse(JSON.stringify(ops))
    expect(applyOperations(p, again).nodes[b].label).toBe('Z')
  })
})

describe('alaprosessin nimen synkronointi', () => {
  it('vaiheen ja alaprosessin nimi pysyvät samana molempiin suuntiin', () => {
    const { p, b } = sample()
    const p2 = applyOperations(p, opsExpandNode(p, b).ops)
    const cid = p2.nodes[b].childProcessId!
    const p3 = applyOperation(p2, { type: 'updateNode', id: b, patch: { label: 'Uusi nimi' } })
    expect(p3.processes[cid].name).toBe('Uusi nimi')
    const p4 = applyOperation(p3, {
      type: 'updateProcess',
      id: cid,
      patch: { name: 'Toinen nimi' },
    })
    expect(p4.nodes[b].label).toBe('Toinen nimi')
  })
})
