import { beforeEach, describe, expect, it } from 'vitest'
import { copyNodes, opsPaste } from './clipboard'
import { createEdge, createEntity, createNode, createProcess, createProject } from './factory'
import { useDeterministicIds } from './ids'
import { applyOperations } from './operations'
import { validateProject } from './validate'

beforeEach(() => useDeterministicIds(true))

function setup() {
  let p = createProject()
  const role = createEntity('role', 'Esimies')
  const a = createNode(p.rootProcessId, { label: 'A', roleId: role.id })
  const b = createNode(p.rootProcessId, { label: 'B' })
  const c = createNode(p.rootProcessId, { label: 'C' })
  const start = createNode(p.rootProcessId, { kind: 'start', label: 'Alku' })
  const other = createProcess('Toinen')
  p = applyOperations(p, [
    { type: 'addEntity', entity: role },
    { type: 'addProcess', process: other },
    ...[start, a, b, c].map((node) => ({ type: 'addNode' as const, node })),
    { type: 'addEdge', edge: createEdge(p.rootProcessId, start.id, a.id) },
    { type: 'addEdge', edge: createEdge(p.rootProcessId, a.id, b.id) },
    { type: 'addEdge', edge: createEdge(p.rootProcessId, b.id, c.id) },
  ])
  return { p, a, b, c, start, other }
}

describe('leikepöytä', () => {
  it('kopioi vaiheet ja niiden väliset yhteydet mutta ei alkua eikä ulkopuolisia yhteyksiä', () => {
    const { p, a, b, start } = setup()
    const clip = copyNodes(p, [start.id, a.id, b.id])!
    expect(clip.nodes.map((n) => n.label)).toEqual(['A', 'B'])
    expect(clip.edges).toHaveLength(1)
    expect(copyNodes(p, [start.id])).toBeNull()
  })

  it('liittää toiseen prosessiin uusina vaiheina samoilla rooleilla', () => {
    const { p, a, b, other } = setup()
    const clip = copyNodes(p, [a.id, b.id])!
    const { ops, nodeIds } = opsPaste(p, clip, other.id)
    const next = applyOperations(p, ops)
    expect(nodeIds).toHaveLength(2)
    expect(nodeIds.every((id) => next.nodes[id].processId === other.id)).toBe(true)
    expect(next.nodes[nodeIds[0]].roleId).toBe(a.roleId)
    expect(next.nodes[nodeIds[0]].id).not.toBe(a.id)
    expect(
      Object.values(next.edges).filter((e) => e.processId === other.id && e.from === nodeIds[0]),
    ).toHaveLength(1)
    // Alkuperäinen ei muutu
    expect(Object.keys(next.nodes)).toHaveLength(Object.keys(p.nodes).length + 2)
    expect(validateProject(next)).toEqual([])
  })

  it('liittää valitun vaiheen perään', () => {
    const { p, a, c } = setup()
    const clip = copyNodes(p, [a.id])!
    const { ops, nodeIds } = opsPaste(p, clip, p.rootProcessId, c.id)
    const next = applyOperations(p, ops)
    expect(Object.values(next.edges).some((e) => e.from === c.id && e.to === nodeIds[0])).toBe(true)
  })

  it('ei liitä loppupisteen perään eikä toisen prosessin vaiheeseen', () => {
    const { p, a, other } = setup()
    const clip = copyNodes(p, [a.id])!
    const { ops } = opsPaste(p, clip, other.id, a.id)
    expect(ops.filter((o) => o.type === 'addEdge')).toHaveLength(0)
  })

  it('alaprosessi liitetään tavallisena vaiheena', () => {
    const { p, b, other } = setup()
    const sub = applyOperations(p, [
      { type: 'updateNode', id: b.id, patch: { kind: 'subprocess' } },
    ])
    const { ops, nodeIds } = opsPaste(sub, copyNodes(sub, [b.id])!, other.id)
    expect(applyOperations(sub, ops).nodes[nodeIds[0]].kind).toBe('step')
  })
})
