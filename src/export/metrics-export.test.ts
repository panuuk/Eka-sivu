// @vitest-environment jsdom
import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { compareProjects } from '../analysis/compare'
import { forkAsTarget, pickBaseline, projectFromSnapshot } from '../model/commands'
import { createNode } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { buildSampleProject } from '../model/sample'
import { buildDocumentHtml } from './document'
import { buildRenderGraph, DEFAULT_RENDER } from './graph'
import { renderSvg } from './svg'
import { DEFAULT_THEME } from './theme'

beforeEach(() => useDeterministicIds(true))
const elk = new ELK()
const run = (g: Parameters<typeof elk.layout>[0]) => elk.layout(g)

describe('tietotyön tiedot vienneissä', () => {
  const p = buildSampleProject()
  const root = p.rootProcessId
  const svgOpts = {
    theme: DEFAULT_THEME,
    showRoles: true,
    showSystems: true,
    showUncertainty: false,
  }

  it('prosessidokumentti sisältää mittarit, kestosarakkeet, RACI ja kipupisteet', () => {
    const html = buildDocumentHtml(p, {
      processId: root,
      theme: DEFAULT_THEME,
      svgs: {},
      includeQuestions: false,
      interactive: false,
    })
    expect(html).toContain('<h4>Mittarit</h4>')
    expect(html).toContain('Läpimenoaika')
    expect(html).toContain('Luovutukset')
    expect(html).toContain('Uudelleenkierrokset')
    expect(html).toContain('<th scope="col">Kesto</th>')
    expect(html).toContain('RACI-matriisi')
    expect(html).toContain('Talousjohtaja')
    expect(html).toContain('Liite: kipupisteet ja parannusideat')
    expect(html).toContain('Laskulta puuttuu usein tilausnumero')
    expect(html).toContain('Nimeä varahyväksyjä')
  })

  it('vanhan muotoinen projekti (ilman kestoja) tuottaa saman rakenteen kuin ennen', () => {
    const plain = buildSampleProject()
    for (const n of Object.values(plain.nodes)) {
      delete n.duration
      delete n.waiting
      delete n.painPoints
      delete n.raci
      delete n.frequency
    }
    const html = buildDocumentHtml(plain, {
      processId: plain.rootProcessId,
      theme: DEFAULT_THEME,
      svgs: {},
      includeQuestions: false,
      interactive: false,
    })
    // Luovutukset ja kierrokset näkyvät rakenteesta, mutta aikaan liittyvää ei ole
    expect(html).not.toContain('Läpimenoaika')
    expect(html).not.toContain('<th scope="col">Kesto</th>')
    expect(html).toContain('Vastuumatriisi')
    expect(html).not.toContain('kipupisteet')
  })

  it('SVG näyttää kestot ja kipupisteen vain pyydettäessä, ja lämpökartta värjää vaiheet', async () => {
    const g = await buildRenderGraph(p, { ...DEFAULT_RENDER, processId: root, heat: 'pain' }, run)
    const off = renderSvg(g, svgOpts)
    expect(off).not.toContain('15-60 min')
    const on = renderSvg(g, { ...svgOpts, showMetrics: true, heat: 'pain' })
    expect(on).toContain('15-60 min')
    expect(on).toContain('>!</text>')
    // Kipupisteellinen vaihe saa punertavan täytön, muut oletuspinnan
    expect(on).not.toBe(renderSvg(g, { ...svgOpts, showMetrics: true }))
  })

  it('muutosluettelo ja korostukset tulevat dokumenttiin ja kuvaan', async () => {
    const target0 = forkAsTarget(p)
    const added = createNode(target0.rootProcessId, { label: 'Automaattitarkistus <b>' })
    const target = applyOperations(target0, [{ type: 'addNode', node: added }])
    const baseline = pickBaseline(target)!
    const cmp = compareProjects(projectFromSnapshot(target, baseline.snapshot), target)
    const comparison = { comparison: cmp, baseName: baseline.name }
    const html = buildDocumentHtml(target, {
      processId: target.rootProcessId,
      theme: DEFAULT_THEME,
      svgs: {},
      includeQuestions: false,
      interactive: false,
      comparison,
    })
    expect(html).toContain('Muutokset lähtötilaan “Nykytila (lähtötilanne)” verrattuna')
    expect(html).toContain('1 lisätty, 0 poistettu, 0 muuttunut')
    expect(html).toContain('Automaattitarkistus &lt;b&gt;') // escapattu
    expect(html).not.toContain('Automaattitarkistus <b>')

    const g = await buildRenderGraph(
      target,
      { ...DEFAULT_RENDER, processId: target.rootProcessId },
      run,
    )
    const svg = renderSvg(g, { ...svgOpts, marks: cmp.targetMarks })
    expect(svg).toContain('stroke-width="3"')
    expect(renderSvg(g, svgOpts)).not.toContain('stroke-width="3"')
  })
})
