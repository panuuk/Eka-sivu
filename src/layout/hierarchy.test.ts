import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDeterministicIds } from '../model/ids'
import { buildLargeProject } from '../model/synthetic'
import { buildSampleProject } from '../model/sample'
import { edgesOf, nodesOf } from '../model/selectors'
import type { Project } from '../model/types'
import { NODE_SIZE } from '../canvas/geometry'
import { buildHierarchyGraph, layoutHierarchy, type HierarchyInput } from './hierarchy'

beforeEach(() => useDeterministicIds(true))

const elk = new ELK()
const run = (g: Parameters<typeof elk.layout>[0]) => elk.layout(g)

function inputFor(p: Project, maxNodes?: number): HierarchyInput {
  return {
    rootProcessId: p.rootProcessId,
    direction: 'DOWN',
    maxNodes,
    nodesOf: (id) =>
      nodesOf(p, id).map((n) => ({
        id: n.id,
        kind: n.kind,
        ...NODE_SIZE[n.kind],
        childProcessId: n.childProcessId,
      })),
    edgesOf: (id) => edgesOf(p, id).map((e) => ({ id: e.id, from: e.from, to: e.to })),
  }
}

describe('hierarkkinen asettelu', () => {
  it('avaa alaprosessin ryhmäksi, jonka sisällä sen vaiheet ovat', async () => {
    const p = buildSampleProject()
    const sub = Object.values(p.nodes).find((n) => n.kind === 'subprocess')!
    const lay = await layoutHierarchy(inputFor(p), run)
    expect(lay.groups).toBe(1)
    const group = lay.items.find((i) => i.id === sub.id)!
    expect(group.group).toBe(true)
    expect(group.width).toBeGreaterThan(NODE_SIZE.step.width)
    const inner = lay.items.filter((i) => i.parentId === sub.id)
    expect(inner).toHaveLength(nodesOf(p, sub.childProcessId!).length)
    // Lapset mahtuvat ryhmän sisään
    for (const c of inner) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(46)
      expect(c.x + c.width).toBeLessThanOrEqual(group.width)
      expect(c.y + c.height).toBeLessThanOrEqual(group.height)
    }
    // Vanhemmat ennen lapsia
    expect(lay.items.findIndex((i) => i.id === sub.id)).toBeLessThan(
      lay.items.findIndex((i) => i.parentId === sub.id),
    )
  })

  it('kaikilla reunoilla on reitti, ja sisäkkäisten reunojen reitit ovat absoluuttisia', async () => {
    const p = buildSampleProject()
    const lay = await layoutHierarchy(inputFor(p), run)
    expect(lay.routes.size).toBe(Object.keys(p.edges).length)
    // absoluuttinen sijainti = vanhempien sijaintien summa
    const abs = new Map<string, { x: number; y: number }>()
    const byId = new Map(lay.items.map((i) => [i.id, i]))
    const resolve = (id: string): { x: number; y: number } => {
      if (abs.has(id)) return abs.get(id)!
      const it = byId.get(id)!
      const base = it.parentId ? resolve(it.parentId) : { x: 0, y: 0 }
      const v = { x: base.x + it.x, y: base.y + it.y }
      abs.set(id, v)
      return v
    }
    for (const e of Object.values(p.edges).filter((x) => p.processes[x.processId].parentNodeId)) {
      const route = lay.routes.get(e.id)!
      const from = resolve(e.from)
      const fromItem = byId.get(e.from)!
      // reitti alkaa lähtösolmun alareunan keskeltä (portti) absoluuttisissa koordinaateissa
      expect(route[0].x).toBeCloseTo(from.x + fromItem.width / 2, 0)
      expect(route[0].y).toBeCloseTo(from.y + fromItem.height, 0)
    }
  })

  it('maxNodes rajaa avaamisen: liian pieni raja jättää alaprosessit suljetuiksi', async () => {
    const p = buildSampleProject()
    const lay = await layoutHierarchy(inputFor(p, 3), run)
    expect(lay.groups).toBe(0)
    expect(lay.items.every((i) => !i.group && !i.parentId)).toBe(true)
  })

  it('käsittelee monta tasoa ja suuren mallin kohtuullisessa ajassa', async () => {
    const p = buildLargeProject(300, 25)
    const t = performance.now()
    const lay = await layoutHierarchy(inputFor(p), run)
    expect(performance.now() - t).toBeLessThan(8000)
    expect(lay.groups).toBeGreaterThan(5)
    expect(lay.items.length).toBeGreaterThan(300)
  })

  it('tyhjä prosessi ei kaada ja graafi rakentuu ilman alaprosesseja', async () => {
    const p = buildSampleProject()
    const empty = await layoutHierarchy(
      { ...inputFor(p), nodesOf: () => [], edgesOf: () => [] },
      run,
    )
    expect(empty.items).toEqual([])
    const { groups } = buildHierarchyGraph({
      ...inputFor(p),
      nodesOf: (id) =>
        id === p.rootProcessId
          ? inputFor(p)
              .nodesOf(id)
              .map((n) => ({ ...n, childProcessId: undefined }))
          : [],
    })
    expect(groups).toBe(0)
  })
})
