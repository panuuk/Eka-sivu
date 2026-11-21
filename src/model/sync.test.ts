import { beforeEach, describe, expect, it } from 'vitest'
import { createEdge, createEntity, createNode } from './factory'
import { useDeterministicIds } from './ids'
import { applyOperations, type Operation } from './operations'
import { buildSampleProject } from './sample'
import { nodesOf } from './selectors'
import { mergeProjects, planMerge, stampChanges } from './sync'
import type { Project } from './types'
import { validateProject } from './validate'

beforeEach(() => useDeterministicIds(true))

/** Tekee muutoksen niin kuin tallennus: operaatiot ja muokkausajat. */
function edit(p: Project, ops: Operation[], at: number): Project {
  return stampChanges(p, { ...applyOperations(p, ops), updatedAt: at }, at)
}

const find = (p: Project, label: string) => Object.values(p.nodes).find((n) => n.label === label)!

describe('stampChanges', () => {
  it('leimaa vain muuttuneet tietueet ja kirjaa poistot poistomerkinnöiksi', () => {
    const base = buildSampleProject()
    const target = find(base, 'Vastaanota lasku')
    const other = find(base, 'Tarkista laskun tiedot')
    const p1 = edit(
      base,
      [{ type: 'updateNode', id: target.id, patch: { label: 'Vastaanota' } }],
      1000,
    )
    expect(p1.stamps?.[target.id]).toBe(1000)
    expect(p1.stamps?.[other.id]).toBeUndefined()
    const p2 = edit(p1, [{ type: 'deleteNode', id: other.id }], 2000)
    expect(p2.tombstones?.[other.id]).toBe(2000)
    expect(p2.stamps?.[other.id]).toBeUndefined()
    // Poiston mukana poistuneet yhteydet saavat myös poistomerkinnän
    expect(Object.keys(p2.tombstones ?? {}).length).toBeGreaterThan(1)
  })

  it('palauttaa saman olion, kun mikään ei muutu', () => {
    const p = buildSampleProject()
    expect(stampChanges(p, p, 5)).toBe(p)
  })
})

describe('mergeProjects: kaksi laitetta', () => {
  const base = edit(buildSampleProject(), [], 1)
  const stepA = find(base, 'Vastaanota lasku')
  const stepB = find(base, 'Tarkista laskun tiedot')

  it('kummankin laitteen lisäykset ja eri vaiheiden muokkaukset säilyvät', () => {
    const phoneNode = createNode(base.rootProcessId, { label: 'Puhelimen vaihe' })
    const phone = edit(
      base,
      [
        { type: 'addNode', node: phoneNode },
        { type: 'updateNode', id: stepA.id, patch: { label: 'Vastaanota ja kirjaa lasku' } },
      ],
      2000,
    )
    const laptopNode = createNode(base.rootProcessId, { label: 'Kannettavan vaihe' })
    const laptop = edit(
      base,
      [
        { type: 'addNode', node: laptopNode },
        { type: 'updateNode', id: stepB.id, patch: { description: 'Tarkistus ERP:ssä' } },
      ],
      3000,
    )
    const merged = mergeProjects(laptop, phone)
    expect(validateProject(merged)).toEqual([])
    const labels = nodesOf(merged, merged.rootProcessId).map((n) => n.label)
    expect(labels).toContain('Puhelimen vaihe')
    expect(labels).toContain('Kannettavan vaihe')
    expect(merged.nodes[stepA.id].label).toBe('Vastaanota ja kirjaa lasku')
    expect(merged.nodes[stepB.id].description).toBe('Tarkistus ERP:ssä')
    // Yhdistäminen toiseen suuntaan antaa saman sisällön
    const reverse = mergeProjects(phone, laptop)
    expect(Object.keys(reverse.nodes).sort()).toEqual(Object.keys(merged.nodes).sort())
    expect(reverse.nodes[stepA.id].label).toBe(merged.nodes[stepA.id].label)
  })

  it('saman vaiheen ristiriita: uudempi voittaa oletuksena ja käyttäjän valinta ohittaa sen', () => {
    const phone = edit(
      base,
      [{ type: 'updateNode', id: stepA.id, patch: { label: 'Puhelin' } }],
      2000,
    )
    const laptop = edit(
      base,
      [{ type: 'updateNode', id: stepA.id, patch: { label: 'Kannettava' } }],
      3000,
    )
    const plan = planMerge(laptop, phone)
    expect(plan.counts.changed).toBe(1)
    expect(plan.changes[0].winner).toBe('local')
    expect(mergeProjects(laptop, phone).nodes[stepA.id].label).toBe('Kannettava')
    const choice = new Map([[stepA.id, 'incoming' as const]])
    expect(mergeProjects(laptop, phone, choice).nodes[stepA.id].label).toBe('Puhelin')
  })

  it('poisto toisella laitteella poistaa vaiheen yhteyksineen, ellei sitä ole muokattu poiston jälkeen', () => {
    const phone = edit(base, [{ type: 'deleteNode', id: stepB.id }], 2000)
    const laptopStale = edit(base, [], 1500)
    const m1 = mergeProjects(laptopStale, phone)
    expect(m1.nodes[stepB.id]).toBeUndefined()
    expect(Object.values(m1.edges).every((e) => m1.nodes[e.from] && m1.nodes[e.to])).toBe(true)
    expect(validateProject(m1)).toEqual([])
    // Muokattu poiston jälkeen: säilyy
    const laptopEdited = edit(
      base,
      [{ type: 'updateNode', id: stepB.id, patch: { description: 'x' } }],
      3000,
    )
    expect(mergeProjects(laptopEdited, phone).nodes[stepB.id]).toBeDefined()
  })

  it('samat roolit kummallakin laitteella erikseen luotuina yhdistyvät yhdeksi', () => {
    const roleP = createEntity('role', 'Hankinta')
    const roleL = createEntity('role', 'hankinta')
    const nodeP = createNode(base.rootProcessId, { label: 'Tilaa', roleId: roleP.id })
    const nodeL = createNode(base.rootProcessId, { label: 'Vahvista', roleId: roleL.id })
    const phone = edit(
      base,
      [
        { type: 'addEntity', entity: roleP },
        { type: 'addNode', node: nodeP },
      ],
      2000,
    )
    const laptop = edit(
      base,
      [
        { type: 'addEntity', entity: roleL },
        { type: 'addNode', node: nodeL },
      ],
      3000,
    )
    const merged = mergeProjects(laptop, phone)
    const roles = Object.values(merged.entities).filter(
      (e) => e.kind === 'role' && /hankinta/i.test(e.name),
    )
    expect(roles).toHaveLength(1)
    expect(merged.nodes[nodeP.id].roleId).toBe(roles[0].id)
    expect(merged.nodes[nodeL.id].roleId).toBe(roles[0].id)
    expect(validateProject(merged)).toEqual([])
  })

  it('on idempotentti: sama tiedosto kahdesti ei tuo uusia eroja', () => {
    const phone = edit(
      base,
      [
        { type: 'addNode', node: createNode(base.rootProcessId, { label: 'Uusi' }) },
        { type: 'updateNode', id: stepA.id, patch: { label: 'Muutettu' } },
      ],
      2000,
    )
    const once = mergeProjects(base, phone)
    const plan = planMerge(once, phone)
    expect(plan.counts.changed).toBe(0)
    expect(plan.counts['new-incoming']).toBe(0)
    const twice = mergeProjects(once, phone)
    expect(Object.keys(twice.nodes).sort()).toEqual(Object.keys(once.nodes).sort())
  })

  it('uusi yhteys uuden vaiheen ja vanhan välillä säilyy, ja alaprosessit pysyvät eheinä', () => {
    const n = createNode(base.rootProcessId, { label: 'Lisävaihe' })
    const phone = edit(
      base,
      [
        { type: 'addNode', node: n },
        { type: 'addEdge', edge: createEdge(base.rootProcessId, stepA.id, n.id) },
      ],
      2000,
    )
    const merged = mergeProjects(edit(base, [], 1500), phone)
    expect(Object.values(merged.edges).some((e) => e.from === stepA.id && e.to === n.id)).toBe(true)
    expect(validateProject(merged)).toEqual([])
    expect(Object.keys(merged.processes)).toEqual(Object.keys(base.processes))
  })
})
