import { describe, expect, it } from 'vitest'
import { buildSampleProject } from './sample'
import { parseProjectJson, projectToJson } from './serialize'
import { validateProject } from './validate'

describe('esimerkkiprojekti', () => {
  it('on eheä ja säilyy JSON-kierroksessa', () => {
    const p = buildSampleProject()
    expect(validateProject(p)).toEqual([])
    expect(Object.keys(p.processes)).toHaveLength(2)
    expect(parseProjectJson(projectToJson(p))).toEqual(p)
  })
})
