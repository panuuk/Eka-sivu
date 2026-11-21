import { describe, expect, it } from 'vitest'
import { analyze } from '../analysis/analyze'
import { createProject } from '../model/factory'
import { buildSampleProject } from '../model/sample'
import { AI_EXAMPLE, buildAiPrompt, buildTemplates } from './aiPrompt'
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

describe('ohjepohjat', () => {
  const p = buildSampleProject()
  const open = analyze(p).open
  const templates = buildTemplates(p, p.rootProcessId, open)

  it('on neljä pohjaa, joista kaksi tuottaa takaisin liitettävää tekstiä', () => {
    expect(templates.map((t) => t.id)).toEqual(['format', 'review', 'interview', 'present'])
    for (const t of templates) {
      expect(t.text.length).toBeGreaterThan(200)
      expect(t.usage).not.toBe('')
    }
  })

  it('arviointiohje sisältää nykyisen prosessin, syntaksin ja avoimet kysymykset', () => {
    const t = templates.find((x) => x.id === 'review')!.text
    expect(t).toContain('SYNTAKSI')
    expect(t).toContain('(aiemmin: Vanha nimi)')
    expect(t).toContain('# Ostolaskun käsittely')
    expect(t).toContain('AVOIMET KYSYMYKSET')
  })

  it('ohjeeseen upotettu prosessiteksti on idempotentti: sen lisääminen takaisin ei muuta mitään', () => {
    const t = templates.find((x) => x.id === 'review')!.text
    const block = /NYKYINEN PROSESSI\n```\n([\s\S]*?)\n```/.exec(t)![1]
    const plan = planText(p, block, { processId: p.rootProcessId, mode: 'append' })
    expect(plan.hasErrors).toBe(false)
    expect(plan.ops).toEqual([])
  })

  it('haastatteluohje ja esittelyohje sisältävät prosessin nimen tai kuvauksen', () => {
    expect(templates.find((x) => x.id === 'interview')!.text).toContain('Ostolaskun käsittely')
    expect(templates.find((x) => x.id === 'present')!.text).toContain('Hyväksyntäkierto')
  })
})
