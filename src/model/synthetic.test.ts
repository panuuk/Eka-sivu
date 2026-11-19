import { describe, expect, it } from 'vitest'
import { analyze } from '../analysis/analyze'
import { buildLargeProject } from './synthetic'
import { nodesOf } from './selectors'
import { validateProject } from './validate'

describe('buildLargeProject', () => {
  it('tuottaa eheän, noin halutun kokoisen projektin', () => {
    const p = buildLargeProject(500)
    expect(validateProject(p)).toEqual([])
    const root = nodesOf(p, p.rootProcessId).length
    expect(root).toBeGreaterThanOrEqual(498)
    expect(Object.keys(p.processes).length).toBeGreaterThan(5)
  })

  it('analyysi ja validointi pysyvät nopeina suurella mallilla', () => {
    const p = buildLargeProject(1500)
    const t = performance.now()
    analyze(p)
    validateProject(p)
    expect(performance.now() - t).toBeLessThan(1500)
  })

  it('on deterministinen', () => {
    const a = buildLargeProject(100)
    const b = buildLargeProject(100)
    expect(Object.values(a.nodes).map((n) => n.label)).toEqual(
      Object.values(b.nodes).map((n) => n.label),
    )
  })
})
