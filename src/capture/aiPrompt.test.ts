import { describe, expect, it } from 'vitest'
import { createProject } from '../model/factory'
import { AI_EXAMPLE, buildAiPrompt } from './aiPrompt'
import { SYNTAX_HELP } from './example'
import { planText } from './plan'
import { parseSyntax } from './syntax'

describe('tekoälyohje', () => {
  it('esimerkki jäsentyy ilman virheitä ja sisältää kaikki rakenteet', () => {
    const r = parseSyntax(AI_EXAMPLE)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.title).toBe('Matkalaskun käsittely')
    const kinds = new Set<string>()
    const walk = (items: typeof r.items) => {
      for (const i of items) {
        kinds.add(i.kind)
        walk(i.children)
        for (const b of i.branches) {
          if (typeof b.jump === 'object') kinds.add('goto')
          walk(b.body)
        }
      }
    }
    walk(r.items)
    for (const k of ['start', 'step', 'decision', 'subprocess', 'end', 'goto'])
      expect(kinds).toContain(k)
  })

  it('esimerkki voidaan lisätä malliin: roolit, järjestelmät, ajat ja kipupiste tulevat mukaan', () => {
    const p = createProject()
    const plan = planText(p, AI_EXAMPLE, { processId: p.rootProcessId, mode: 'append' } as never)
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
    const names = (kind: string) =>
      plan.ops.flatMap((o) =>
        o.type === 'addEntity' && o.entity.kind === kind ? [o.entity.name] : [],
      )
    expect(names('role').sort()).toEqual(
      ['Esimies', 'Palkka-asiantuntija', 'Talous', 'Talousjohtaja', 'Työntekijä'].sort(),
    )
    expect(names('system').sort()).toEqual(['Matkahallinta', 'Palkanlaskenta'])
    const text = JSON.stringify(plan.ops)
    expect(text).toContain('Kuitit puuttuvat usein')
    expect(text).toContain('"duration"')
    expect(text).toContain('"waiting"')
  })

  it('ohje sisältää syntaksitaulukon, esimerkin ja paikan muistiinpanoille', () => {
    const prompt = buildAiPrompt()
    for (const h of SYNTAX_HELP) expect(prompt).toContain(h.syntax)
    expect(prompt).toContain(AI_EXAMPLE)
    expect(prompt).toMatch(/MUISTIINPANOT/)
    expect(prompt).toMatch(/Älä keksi tietoa/)
  })

  it('kommenttirivi ("// Avoin: ...") on sallittu vaiheiden välissä', () => {
    const r = parseSyntax('- Tarkista lasku\n// Avoin: kuka hyväksyy?\n- Maksa lasku')
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.items.map((i) => i.label)).toEqual(['Tarkista lasku', 'Maksa lasku'])
  })
})
