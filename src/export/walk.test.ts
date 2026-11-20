import { beforeEach, describe, expect, it } from 'vitest'
import { useDeterministicIds } from '../model/ids'
import { buildSampleProject } from '../model/sample'
import { walkSteps } from './walk'

beforeEach(() => useDeterministicIds(true))

describe('walkSteps', () => {
  const p = buildSampleProject()
  const rootNodes = (pid: string) =>
    new Set(
      Object.values(p.nodes)
        .filter((n) => n.processId === pid)
        .map((n) => n.id),
    )

  it('kulkee prosessin alusta loppuun, haarat peräkkäin ja jokainen vaihe kerran', () => {
    const steps = walkSteps(p, p.rootProcessId, rootNodes(p.rootProcessId), false)
    const labels = steps.map((s) => s.node.label)
    expect(labels[0]).toBe('Lasku saapuu')
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toHaveLength(10)
    expect(labels.indexOf('Vastaanota lasku')).toBeLessThan(
      labels.indexOf('Tarkista laskun tiedot'),
    )
    expect(labels.indexOf('Tiedot kunnossa?')).toBeLessThan(labels.indexOf('Hyväksyntäkierto'))
  })

  it('päätöksen seuraajat tulevat haaran nimineen', () => {
    const steps = walkSteps(p, p.rootProcessId, rootNodes(p.rootProcessId), false)
    const d = steps.find((s) => s.node.label === 'Tiedot kunnossa?')!
    expect(d.next.map((n) => n.label).sort()).toEqual(['Ei', 'Kyllä'])
  })

  it('avatun alaprosessin vaiheet tulevat heti alaprosessin kohdalle', () => {
    const visible = new Set(Object.keys(p.nodes))
    const labels = walkSteps(p, p.rootProcessId, visible, true).map((s) => s.node.label)
    const i = labels.indexOf('Hyväksyntäkierto')
    expect(labels.slice(i + 1, i + 5)).toContain('Lähetä esimiehelle')
    expect(labels).toHaveLength(Object.keys(p.nodes).length)
    // suljettuna alaprosessin vaiheita ei ole
    expect(walkSteps(p, p.rootProcessId, visible, false).map((s) => s.node.label)).not.toContain(
      'Lähetä esimiehelle',
    )
  })

  it('rajaa näkyviin vain annetut vaiheet', () => {
    const only = new Set(
      Object.values(p.nodes)
        .filter((n) => n.confidence === 'confirmed' && n.processId === p.rootProcessId)
        .map((n) => n.id),
    )
    const steps = walkSteps(p, p.rootProcessId, only, false)
    expect(steps.every((s) => only.has(s.node.id))).toBe(true)
    expect(steps.every((s) => s.next.every((n) => only.has(n.id)))).toBe(true)
  })

  it('tyhjä näkyvyys ja puuttuva prosessi eivät kaada', () => {
    expect(walkSteps(p, p.rootProcessId, new Set(), false)).toEqual([])
    expect(walkSteps(p, 'puuttuu', new Set(), false)).toEqual([])
  })
})
