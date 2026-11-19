import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it } from 'vitest'
import { buildElkGraph, computeLayout } from './elk'

const elk = new ELK()
const run = (g: Parameters<typeof elk.layout>[0]) => elk.layout(g)

describe('asettelu', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, width: 100, height: 50 }))
  const edges = [
    { id: 'e1', from: 'a', to: 'b' },
    { id: 'e2', from: 'a', to: 'c' },
    { id: 'e3', from: 'b', to: 'd' },
    { id: 'e4', from: 'c', to: 'd' },
  ]

  it('asettaa solmut kerroksiin suunnan mukaan', async () => {
    const down = (await computeLayout({ nodes, edges, direction: 'DOWN' }, run)).positions
    expect(down.get('a')!.y).toBeLessThan(down.get('b')!.y)
    expect(down.get('b')!.y).toBeLessThan(down.get('d')!.y)
    const right = (await computeLayout({ nodes, edges, direction: 'RIGHT' }, run)).positions
    expect(right.get('a')!.x).toBeLessThan(right.get('b')!.x)
  })

  it('on deterministinen ja sietää syklit ja irralliset solmut', async () => {
    const cyc = [...edges, { id: 'e5', from: 'd', to: 'a' }]
    const withLoose = [...nodes, { id: 'x', width: 100, height: 50 }]
    const a = await computeLayout({ nodes: withLoose, edges: cyc, direction: 'DOWN' }, run)
    const b = await computeLayout({ nodes: withLoose, edges: cyc, direction: 'DOWN' }, run)
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    expect([...a.routes.entries()]).toEqual([...b.routes.entries()])
    expect(a.positions.size).toBe(5)
    expect(a.routes.size).toBe(5)
  })

  it('jättää huomiotta reunat puuttuviin solmuihin ja tyhjän graafin', async () => {
    const g = buildElkGraph({
      nodes,
      edges: [{ id: 'z', from: 'a', to: 'puuttuu' }],
      direction: 'DOWN',
    })
    expect(g.edges).toHaveLength(0)
    expect(
      (await computeLayout({ nodes: [], edges: [], direction: 'DOWN' }, run)).positions.size,
    ).toBe(0)
  })

  it('solmut eivät mene päällekkäin', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, width: 120, height: 60 }))
    const es = many
      .slice(1)
      .map((n, i) => ({ id: `e${i}`, from: `n${Math.floor(i / 2)}`, to: n.id }))
    const pos = (await computeLayout({ nodes: many, edges: es, direction: 'DOWN' }, run)).positions
    const list = many.map((n) => ({ ...pos.get(n.id)!, w: n.width, h: n.height }))
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i],
          b = list[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('reitit alkavat ja päättyvät solmujen sivujen keskipisteisiin', async () => {
    const res = await computeLayout({ nodes, edges, direction: 'DOWN' }, run)
    for (const e of edges) {
      const route = res.routes.get(e.id)!
      const from = res.positions.get(e.from)!
      const to = res.positions.get(e.to)!
      expect(route[0].x).toBeCloseTo(from.x + 50, 0)
      expect(route[0].y).toBeCloseTo(from.y + 50, 0)
      expect(route[route.length - 1].x).toBeCloseTo(to.x + 50, 0)
      expect(route[route.length - 1].y).toBeCloseTo(to.y, 0)
    }
  })
})
