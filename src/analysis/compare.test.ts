import { beforeEach, describe, expect, it } from 'vitest'
import { createVersion, forkAsTarget, projectFromSnapshot, snapshotOf } from '../model/commands'
import { MIN_PER_DAY as D } from '../model/duration'
import { createEdge, createEntity, createNode, createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { parseProjectJson, projectToJson } from '../model/serialize'
import { buildSampleProject } from '../model/sample'
import { validateProject } from '../model/validate'
import { compareProjects } from './compare'

beforeEach(() => useDeterministicIds(true))

describe('versiot ja tavoitetila', () => {
  it('tavoitetilaprojekti on kopio samoilla tunnisteilla ja lähtötila versiona', () => {
    const p = buildSampleProject()
    const target = forkAsTarget(p)
    expect(target.id).not.toBe(p.id)
    expect(Object.keys(target.nodes)).toEqual(Object.keys(p.nodes))
    const versions = Object.values(target.versions!)
    expect(versions).toHaveLength(1)
    expect(versions[0].kind).toBe('baseline')
    expect(Object.keys(versions[0].snapshot.nodes)).toEqual(Object.keys(p.nodes))
    expect(validateProject(target)).toEqual([])
    // Alkuperäinen ei saanut versioita
    expect(p.versions).toBeUndefined()
  })

  it('versiot säilyvät JSON-kierroksessa, ja vioittunut versio pudotetaan', () => {
    const t = forkAsTarget(buildSampleProject())
    const back = parseProjectJson(projectToJson(t))
    expect(Object.keys(back.versions!)).toEqual(Object.keys(t.versions!))
    const broken = JSON.parse(projectToJson(t))
    const id = Object.keys(broken.project.versions)[0]
    broken.project.versions[id].snapshot = { nope: true }
    const loaded = parseProjectJson(JSON.stringify(broken))
    expect(loaded.versions).toBeUndefined()
  })

  it('palautus tuo rakenteen versiosta mutta säilyttää lähteet, versiot ja siivoaa kysymykset', () => {
    let p = buildSampleProject()
    const v = createVersion(p, 'Ennen muutosta', 'kommentti')
    p = applyOperations(p, [{ type: 'addVersion', version: v }])
    const someNode = Object.values(p.nodes).find((n) => n.label === 'Kirjaa ja vie maksuun')!
    p = applyOperations(p, [
      { type: 'deleteNode', id: someNode.id },
      { type: 'renameProject', name: 'Uusi nimi' },
    ])
    expect(p.nodes[someNode.id]).toBeUndefined()
    const restored = applyOperations(p, [{ type: 'restoreVersion', id: v.id }])
    expect(restored.nodes[someNode.id]).toBeDefined()
    expect(restored.name).toBe('Uusi nimi') // vain rakenne palautuu
    expect(restored.versions![v.id]).toBeDefined()
    expect(validateProject(restored)).toEqual([])
  })

  it('palautus pudottaa viitteet lähteisiin, joita ei enää ole', () => {
    let p = createProject()
    const src = { id: 's1', title: 'T', kind: 'note' as const, text: 'abc', addedAt: 1 }
    const n = createNode(p.rootProcessId, {
      label: 'X',
      sources: [{ sourceId: 's1', start: 0, end: 1, quote: 'a' }],
    })
    p = applyOperations(p, [
      { type: 'addSource', source: src },
      { type: 'addNode', node: n },
    ])
    const v = createVersion(p, 'V')
    p = applyOperations(p, [
      { type: 'addVersion', version: v },
      { type: 'deleteSource', id: 's1' },
    ])
    const restored = applyOperations(p, [{ type: 'restoreVersion', id: v.id }])
    expect(restored.nodes[n.id].sources).toEqual([])
    expect(validateProject(restored)).toEqual([])
  })

  it('versioiden nimeäminen ja poisto', () => {
    let p = createProject()
    const v = createVersion(p, 'A')
    p = applyOperations(p, [
      { type: 'addVersion', version: v },
      { type: 'updateVersion', id: v.id, patch: { name: 'B', comment: 'c' } },
    ])
    expect(p.versions![v.id].name).toBe('B')
    p = applyOperations(p, [{ type: 'deleteVersion', id: v.id }])
    expect(p.versions).toBeUndefined()
  })
})

describe('compareProjects', () => {
  function pair() {
    const base = createProject()
    const root = base.rootProcessId
    const myynti = createEntity('role', 'Myynti')
    const talous = createEntity('role', 'Talous')
    const a = createNode(root, { label: 'Vastaanota', roleId: myynti.id, duration: { typical: D } })
    const b = createNode(root, { label: 'Tarkista', roleId: myynti.id })
    const c = createNode(root, { label: 'Hyväksy', roleId: talous.id })
    const old = applyOperations(base, [
      { type: 'addEntity', entity: myynti },
      { type: 'addEntity', entity: talous },
      ...[a, b, c].map((node) => ({ type: 'addNode' as const, node })),
      { type: 'addEdge', edge: createEdge(root, a.id, b.id) },
      { type: 'addEdge', edge: createEdge(root, b.id, c.id) },
    ])
    return { old, a, b, c, myynti, talous, root }
  }

  it('tunnistaa lisätyt, poistetut ja muuttuneet vaiheet sekä yhteydet', () => {
    const { old, a, b, c, talous, root } = pair()
    const d = createNode(root, { label: 'Automaattitarkistus', roleId: talous.id })
    const edge = Object.values(old.edges).find((e) => e.from === b.id)!
    const next = applyOperations(old, [
      { type: 'updateNode', id: b.id, patch: { roleId: talous.id, duration: { typical: 2 * D } } },
      { type: 'deleteNode', id: c.id },
      { type: 'addNode', node: d },
      { type: 'addEdge', edge: createEdge(root, b.id, d.id) },
    ])
    void a
    void edge
    const cmp = compareProjects(old, next)
    expect(cmp.counts).toMatchObject({ added: 1, removed: 1, changed: 1 })
    const changed = cmp.nodes.find((n) => n.kind === 'changed')!
    expect(changed.label).toBe('Tarkista')
    expect(changed.fields.map((f) => f.field).sort()).toEqual(['duration', 'role'])
    expect(changed.fields.find((f) => f.field === 'role')).toMatchObject({
      before: 'Myynti',
      after: 'Talous',
    })
    expect(cmp.roleChanges).toHaveLength(1)
    expect(cmp.nodes.find((n) => n.kind === 'removed')!.label).toBe('Hyväksy')
    expect(cmp.nodes.find((n) => n.kind === 'added')!.label).toBe('Automaattitarkistus')
    expect(cmp.counts.edgesAdded).toBe(1)
    expect(cmp.counts.edgesRemoved).toBe(1) // b -> c poistui solmun mukana
    expect(cmp.baseMarks.get(c.id)).toBe('removed')
    expect(cmp.targetMarks.get(d.id)).toBe('added')
    expect(cmp.identical).toBe(false)
  })

  it('identtinen tila ei tuota eroja', () => {
    const { old } = pair()
    const cmp = compareProjects(old, projectFromSnapshot(old, snapshotOf(old)))
    expect(cmp.identical).toBe(true)
    expect(cmp.nodes).toEqual([])
  })

  it('uudelleen luotu samanniminen vaihe tunnistetaan samaksi (muuttunut, ei poistettu ja lisätty)', () => {
    const { old, b, root } = pair()
    const recreated = createNode(root, {
      label: 'Tarkista',
      roleId: old.nodes[b.id].roleId,
      duration: { typical: 3 * D },
    })
    const next = applyOperations(old, [
      { type: 'deleteNode', id: b.id },
      { type: 'addNode', node: recreated },
    ])
    const cmp = compareProjects(old, next)
    expect(cmp.counts.added).toBe(0)
    expect(cmp.counts.removed).toBe(0)
    const ch = cmp.nodes.find((n) => n.label === 'Tarkista')!
    expect(ch.kind).toBe('changed')
    expect(ch.matchedByLabel).toBe(true)
  })

  it('mittarit ja niiden muutos: luovutukset vähenevät, kun peräkkäiset vaiheet siirtyvät samalle roolille', () => {
    const { old, c, myynti } = pair()
    expect(compareProjects(old, old).base.handoffs).toBe(1) // Tarkista (Myynti) -> Hyväksy (Talous)
    const next = applyOperations(old, [
      { type: 'updateNode', id: c.id, patch: { roleId: myynti.id } },
    ])
    const cmp = compareProjects(old, next)
    expect(cmp.base.handoffs).toBe(1)
    expect(cmp.target.handoffs).toBe(0)
  })

  it('prosessien lisäys ja uudelleennimeäminen', () => {
    const { old, root } = pair()
    const next = applyOperations(old, [
      { type: 'updateProcess', id: root, patch: { name: 'Uusi nimi' } },
    ])
    const cmp = compareProjects(old, next)
    expect(cmp.processes).toEqual([
      { kind: 'changed', name: 'Uusi nimi', before: 'Päätason prosessi' },
    ])
  })
})
