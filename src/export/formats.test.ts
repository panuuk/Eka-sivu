// @vitest-environment jsdom
import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { analyze } from '../analysis/analyze'
import { createNode } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { buildSampleProject } from '../model/sample'
import { buildDocumentHtml } from './document'
import { buildRenderGraph, DEFAULT_RENDER } from './graph'
import { toBpmn } from './bpmn'
import { toMermaid } from './mermaid'
import { renderSvg } from './svg'
import { DEFAULT_THEME } from './theme'

beforeEach(() => useDeterministicIds(true))

const elk = new ELK()
const run = (g: Parameters<typeof elk.layout>[0]) => elk.layout(g)
const p = buildSampleProject()

describe('toMermaid', () => {
  it('tuottaa flowchartin solmuineen, haaroineen ja rooleineen', () => {
    const m = toMermaid(p, p.rootProcessId)
    const lines = m.split('\n')
    expect(lines[0]).toBe('flowchart TD')
    expect(m).toMatch(/\{"Tiedot kunnossa\?"\}/) // päätös
    expect(m).toMatch(/\(\["Lasku saapuu"\]\)/) // alku
    expect(m).toMatch(/\[\["Hyväksyntäkierto<br\/><i>Esimies<\/i>"\]\]/) // alaprosessi + rooli
    expect(m).toMatch(/-->\|"Kyllä"\|/)
    expect(m).toContain('classDef guess')
    // Jokainen reuna viittaa määriteltyyn solmuun
    const defined = new Set([...m.matchAll(/^\s+(n\d+)[[({]/gm)].map((x) => x[1]))
    for (const [, a, b] of m.matchAll(/^\s+(n\d+) -->(?:\|[^|]*\|)? (n\d+)/gm)) {
      expect(defined.has(a)).toBe(true)
      expect(defined.has(b)).toBe(true)
    }
  })

  it('avaa alaprosessit subgraph-lohkoksi ja kytkee reunat lohkon tunnisteeseen', () => {
    const m = toMermaid(p, p.rootProcessId, { expand: true, direction: 'LR' })
    expect(m.startsWith('flowchart LR')).toBe(true)
    expect(m).toMatch(/subgraph n\d+_g\["Hyväksyntäkierto"\]/)
    expect(m).toMatch(/^\s+end$/m)
    expect(m).toMatch(/-->\|"Kyllä"\| n\d+_g/) // reuna ryhmään
    expect(m).toContain('Lähetä esimiehelle')
  })

  it('escapettaa lainausmerkit ja rivinvaihdot', () => {
    let q = buildSampleProject()
    q = applyOperations(q, [
      { type: 'addNode', node: createNode(q.rootProcessId, { label: 'Sano "hei"\nrivi' }) },
    ])
    const m = toMermaid(q, q.rootProcessId)
    expect(m).toContain('Sano #quot;hei#quot; rivi')
    expect(m).not.toMatch(/"hei"/)
  })
})

describe('toBpmn', () => {
  async function bpmn() {
    const layout = await buildRenderGraph(
      p,
      { ...DEFAULT_RENDER, processId: p.rootProcessId, expand: true },
      run,
    )
    return toBpmn(p, p.rootProcessId, layout)
  }

  it('on hyvin muodostettu XML ja sisältää tehtävät, yhdyskäytävät, tapahtumat ja alaprosessin', async () => {
    const doc = new DOMParser().parseFromString(await bpmn(), 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    const count = (tag: string) => doc.getElementsByTagName(tag).length
    expect(count('startEvent')).toBe(2) // päätaso + alaprosessi
    expect(count('endEvent')).toBe(2)
    expect(count('exclusiveGateway')).toBe(2)
    expect(count('subProcess')).toBe(1)
    expect(count('task')).toBe(5 + 2) // päätason 5 vaihetta + alaprosessin 2
    expect(count('sequenceFlow')).toBe(Object.keys(p.edges).length)
  })

  it('kaikki viittaukset osoittavat olemassa oleviin elementteihin ja DI vastaa malleja', async () => {
    const doc = new DOMParser().parseFromString(await bpmn(), 'application/xml')
    const ids = new Set([...doc.querySelectorAll('[id]')].map((e) => e.getAttribute('id')!))
    expect(ids.size).toBe(doc.querySelectorAll('[id]').length) // uniikit
    for (const f of doc.getElementsByTagName('sequenceFlow')) {
      expect(ids.has(f.getAttribute('sourceRef')!)).toBe(true)
      expect(ids.has(f.getAttribute('targetRef')!)).toBe(true)
    }
    for (const shape of doc.getElementsByTagName('bpmndi:BPMNShape')) {
      expect(ids.has(shape.getAttribute('bpmnElement')!)).toBe(true)
      expect(shape.getElementsByTagName('dc:Bounds')).toHaveLength(1)
    }
    for (const edge of doc.getElementsByTagName('bpmndi:BPMNEdge')) {
      expect(ids.has(edge.getAttribute('bpmnElement')!)).toBe(true)
      expect(edge.getElementsByTagName('di:waypoint').length).toBeGreaterThanOrEqual(2)
    }
    for (const r of doc.getElementsByTagName('flowNodeRef'))
      expect(ids.has(r.textContent!)).toBe(true)
  })

  it('uimaradat vastaavat rooleja ja haaran nimi säilyy', async () => {
    const doc = new DOMParser().parseFromString(await bpmn(), 'application/xml')
    const lanes = [...doc.getElementsByTagName('lane')].map((l) => l.getAttribute('name'))
    expect(lanes.sort()).toEqual(['Esimies', 'Ostoreskontra'])
    expect(
      [...doc.getElementsByTagName('sequenceFlow')].some((f) => f.getAttribute('name') === 'Kyllä'),
    ).toBe(true)
  })

  it('escapettaa nimet ja toimii ilman asettelua', () => {
    let q = buildSampleProject()
    q = applyOperations(q, [
      {
        type: 'addNode',
        node: createNode(q.rootProcessId, { label: `A & B <c> "d" 'e'`, description: 'x\u0001y' }),
      },
    ])
    const xml = toBpmn(q, q.rootProcessId)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(xml).not.toContain('bpmndi:BPMNDiagram')
    expect(
      [...doc.getElementsByTagName('task')].some(
        (t) => t.getAttribute('name') === `A & B <c> "d" 'e'`,
      ),
    ).toBe(true)
  })
})

describe('buildDocumentHtml', () => {
  async function doc(extra: Partial<Parameters<typeof buildDocumentHtml>[1]> = {}) {
    const svgs: Record<string, string> = {}
    for (const id of Object.keys(p.processes)) {
      const g = await buildRenderGraph(p, { ...DEFAULT_RENDER, processId: id }, run)
      svgs[id] = renderSvg(g, {
        theme: DEFAULT_THEME,
        showRoles: true,
        showSystems: true,
        showUncertainty: true,
      })
    }
    const html = buildDocumentHtml(p, {
      processId: p.rootProcessId,
      theme: DEFAULT_THEME,
      svgs,
      includeQuestions: false,
      interactive: false,
      generatedAt: new Date('2026-03-04T12:00:00Z'),
      ...extra,
    })
    return { html, dom: new DOMParser().parseFromString(html, 'text/html') }
  }

  it('sisältää otsikon, kaaviot, vaihetaulukon, vastuumatriisin ja liitteen kaikille prosesseille', async () => {
    const { dom } = await doc()
    expect(dom.querySelector('h1')!.textContent).toBe('Ostolaskun käsittely')
    expect(dom.querySelectorAll('section.process')).toHaveLength(2)
    expect(dom.querySelectorAll('figure.diagram svg')).toHaveLength(2)
    expect(dom.querySelectorAll('table.steps')).toHaveLength(2)
    const firstRows = dom.querySelectorAll('section.process:first-of-type table.steps tbody tr')
    expect(firstRows.length).toBe(8) // 5 vaihetta, 2 päätöstä ja alaprosessi (ilman alkua ja loppua)
    expect(dom.querySelector('table.matrix')).not.toBeNull()
    expect(dom.querySelector('.appendix')!.textContent).toContain('Ostoreskontra')
    expect(dom.body.textContent).toContain('4.3.2026')
  })

  it('vain pyydetty alipuu: alaprosessista alkava dokumentti', async () => {
    const sub = Object.values(p.processes).find((x) => x.parentNodeId)!
    const { dom } = await doc({ processId: sub.id })
    expect(dom.querySelectorAll('section.process')).toHaveLength(1)
    expect(dom.querySelector('h1')!.textContent).toBe('Hyväksyntäkierto')
  })

  it('interaktiivinen sisältää vain kiinteän skriptin, staattinen ei skriptiä lainkaan', async () => {
    const stat = await doc()
    expect(stat.dom.querySelectorAll('script')).toHaveLength(0)
    const inter = await doc({ interactive: true })
    // yksi suoritettava skripti ja yksi data-lohko (application/json, ei suoritettava)
    const executable = [...inter.dom.querySelectorAll('script')].filter(
      (s) => !s.getAttribute('type'),
    )
    expect(executable).toHaveLength(1)
    expect(inter.dom.querySelectorAll('script[type="application/json"]')).toHaveLength(1)
    // suoritettavassa skriptissä ei ole käyttäjän dataa
    expect(executable[0].textContent).not.toContain('Ostolasku')
  })

  it('palautetila lisää kommentointikentät ja kysymysdatan mutta ei käyttäjän tietoja suoritettavaan skriptiin', async () => {
    const { dom, html } = await doc({ interactive: true, review: true, questions: analyze(p).open })
    expect(dom.getElementById('pk-comment')).not.toBeNull()
    expect(dom.getElementById('pk-reviewer')).not.toBeNull()
    expect(dom.getElementById('pk-fb-save')).not.toBeNull()
    const executable = [...dom.querySelectorAll('script')].filter((s) => !s.getAttribute('type'))
    expect(executable).toHaveLength(2)
    for (const s of executable) expect(s.textContent).not.toContain('Ostolasku')
    const meta = JSON.parse(dom.getElementById('pk-review-data')!.textContent!)
    expect(meta.projectId).toBe(p.id)
    expect(Array.isArray(meta.questions)).toBe(true)
    expect(html).not.toContain('</script><script>alert')
    // Ilman palautetilaa kenttiä ei ole
    const plain = await doc({ interactive: true })
    expect(plain.dom.getElementById('pk-comment')).toBeNull()
    expect(plain.dom.getElementById('pk-review-data')).toBeNull()
  })

  it('escapettaa käyttäjän tekstit ja liittää avoimet kysymykset pyydettäessä', async () => {
    let q = buildSampleProject()
    q = applyOperations(q, [
      {
        type: 'addNode',
        node: createNode(q.rootProcessId, {
          label: '<img src=x onerror=alert(1)>',
          description: '</td><script>x</script>',
        }),
      },
    ])
    const html = buildDocumentHtml(q, {
      processId: q.rootProcessId,
      theme: DEFAULT_THEME,
      svgs: {},
      includeQuestions: true,
      questions: analyze(q).open,
      interactive: false,
    })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>x')
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelectorAll('script, img')).toHaveLength(0)
    expect(dom.querySelector('ul.questions li')).not.toBeNull()
  })

  it('käyttää valittua teemaa ja sanitoi sen', async () => {
    const dark = await doc({ theme: { palette: 'dark', accent: '#ff00aa', font: 'serif' } })
    expect(dark.html).toContain('--bg: #0b1120')
    expect(dark.html).toContain('--accent: #ff00aa')
    expect(dark.html).toContain('Georgia')
    const evil = await doc({
      theme: { palette: 'light', accent: 'red;}</style><script>', font: 'x' },
    })
    expect(evil.html).not.toContain('</style><script>')
  })
})
