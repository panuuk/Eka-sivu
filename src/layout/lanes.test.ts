import { describe, expect, it } from 'vitest'
import { assignLayers, LANE, layoutLanes, type LaneEdge, type LaneNode } from './lanes'

const n = (id: string, kind: LaneNode['kind'] = 'step', roleId?: string): LaneNode => ({
  id,
  kind,
  roleId,
})
const e = (from: string, to: string): LaneEdge => ({ from, to })

describe('assignLayers', () => {
  it('antaa jonolle kasvavat kerrokset ja haarojen yhtymäkohdalle pisimmän polun kerroksen', () => {
    const layers = assignLayers(
      [n('a'), n('b'), n('c'), n('d'), n('e')],
      [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd'), e('d', 'e'), e('a', 'd')],
    )
    expect(Object.fromEntries(layers)).toEqual({ a: 0, b: 1, c: 1, d: 2, e: 3 })
  })

  it('ohittaa silmukan paluureunan eikä jää jumiin', () => {
    const layers = assignLayers(
      [n('s', 'start'), n('a'), n('b')],
      [e('s', 'a'), e('a', 'b'), e('b', 'a')],
    )
    expect(layers.get('s')).toBe(0)
    expect(layers.get('a')).toBe(1)
    expect(layers.get('b')).toBe(2)
  })

  it('käsittelee pelkän syklin ja irralliset solmut', () => {
    const layers = assignLayers([n('a'), n('b'), n('x')], [e('a', 'b'), e('b', 'a')])
    expect(layers.size).toBe(3)
    expect(layers.get('x')).toBe(0)
  })
})

describe('layoutLanes', () => {
  const nodes = [
    n('start', 'start'),
    n('a', 'step', 'myynti'),
    n('d', 'decision'),
    n('b', 'step', 'talous'),
    n('c', 'step', 'myynti'),
    n('x', 'step'), // ei roolia
    n('end', 'end'),
  ]
  const edges = [
    e('start', 'a'),
    e('a', 'd'),
    e('d', 'b'),
    e('d', 'c'),
    e('b', 'x'),
    e('c', 'x'),
    e('x', 'end'),
  ]
  const lay = layoutLanes(nodes, edges)

  it('luo radan jokaiselle roolille ja "ei roolia" -radan viimeiseksi', () => {
    expect(lay.lanes.map((l) => l.roleId)).toEqual(['myynti', 'talous', null])
  })

  it('sijoittaa vaiheet oman roolinsa radalle ja päätöksen sekä alun edeltäjän/seuraajan radalle', () => {
    const laneOf = (id: string) => {
      const y = lay.positions.get(id)!.y
      return lay.lanes.find((l) => y >= l.y && y < l.y + l.height)!.roleId
    }
    expect(laneOf('a')).toBe('myynti')
    expect(laneOf('b')).toBe('talous')
    expect(laneOf('c')).toBe('myynti')
    expect(laneOf('d')).toBe('myynti') // päätös lainaa edeltäjän radan
    expect(laneOf('start')).toBe('myynti') // alku lainaa seuraajan radan
    expect(laneOf('x')).toBe(null)
    expect(laneOf('end')).toBe(null) // loppu lainaa edeltäjän radan
  })

  it('sarake kasvaa kerroksen mukana eikä solmut mene päällekkäin', () => {
    const xs = ['start', 'a', 'd', 'b', 'x', 'end'].map((id) => lay.positions.get(id)!.x)
    expect([...xs].sort((p, q) => p - q)).toEqual(xs.slice().sort((p, q) => p - q))
    const boxes = nodes.map((nd) => ({ id: nd.id, ...lay.positions.get(nd.id)! }))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const overlap =
          Math.abs(boxes[i].x - boxes[j].x) < LANE.nodeWidth &&
          Math.abs(boxes[i].y - boxes[j].y) < 72
        expect(overlap).toBe(false)
      }
    }
  })

  it('pinoaa saman radan ja kerroksen solmut allekkain ja kasvattaa rataa', () => {
    const l = layoutLanes(
      [n('s', 'start'), n('a', 'step', 'r'), n('b', 'step', 'r'), n('c', 'step', 'r')],
      [e('s', 'a'), e('s', 'b'), e('s', 'c')],
    )
    const ys = ['a', 'b', 'c'].map((id) => l.positions.get(id)!.y)
    expect(new Set(ys).size).toBe(3)
    expect(l.lanes[0].height).toBeGreaterThanOrEqual(3 * LANE.rowHeight)
  })

  it('tyhjä ja rooliton prosessi', () => {
    expect(layoutLanes([], []).lanes).toHaveLength(1)
    expect(layoutLanes([n('a')], []).lanes.map((l) => l.roleId)).toEqual([null])
  })

  it('on deterministinen', () => {
    expect([...layoutLanes(nodes, edges).positions]).toEqual([...lay.positions])
  })
})
