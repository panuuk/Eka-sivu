// @vitest-environment jsdom
import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { createNode } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { buildSampleProject } from '../model/sample'
import { buildLargeProject } from '../model/synthetic'
import { buildRenderGraph, DEFAULT_RENDER, filterProcess } from './graph'
import { esc, fitText, renderSvg, tint, wrapLabel, type SvgOptions } from './svg'
import { DEFAULT_THEME, sanitizeColor, sanitizeTheme, themeColors } from './theme'

beforeEach(() => useDeterministicIds(true))

const elk = new ELK()
const run = (g: Parameters<typeof elk.layout>[0]) => elk.layout(g)

const SVG_OPTS: SvgOptions = {
  theme: DEFAULT_THEME,
  showRoles: true,
  showSystems: true,
  showUncertainty: true,
}

function parseXml(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'image/svg+xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc
}

describe('wrapLabel', () => {
  it('rivittää sanarajalla ja lyhentää ylitykset', () => {
    expect(wrapLabel('Tarkista laskun tiedot ERP-järjestelmästä', 16, 3)).toEqual([
      'Tarkista laskun',
      'tiedot',
      'ERP-järjestelmä…',
    ])
    expect(wrapLabel('lyhyt', 20, 2)).toEqual(['lyhyt'])
    const long = wrapLabel('yksi kaksi kolme neljä viisi kuusi seitsemän kahdeksan', 12, 2)
    expect(long).toHaveLength(2)
    expect(long[1].endsWith('…')).toBe(true)
    expect(
      wrapLabel('Aivanliianpitkäsanajokaeisovisisään', 10, 5).every((l) => l.length <= 10),
    ).toBe(true)
    expect(wrapLabel('   ', 10, 2)).toEqual([])
  })
})

describe('fitText', () => {
  it('lyhentää ellipsillä ja jättää lyhyen ennalleen', () => {
    expect(fitText('lyhyt', 10)).toBe('lyhyt')
    expect(fitText('Ostoreskontra · Verkkolaskuoperaattori', 20)).toBe('Ostoreskontra · Ver…')
    expect(fitText('  a   b  ', 10)).toBe('a b')
  })
})

describe('esc ja teema', () => {
  it('esc estää XML-injektion', () => {
    expect(esc(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
  it('sanitoi värit ja teemat', () => {
    expect(sanitizeColor('#abc123')).toBe('#abc123')
    expect(sanitizeColor('red"/><script>')).toBe(DEFAULT_THEME.accent)
    expect(sanitizeTheme({ palette: 'x' as never, accent: 'javascript:1', font: 'comic' })).toEqual(
      DEFAULT_THEME,
    )
    expect(sanitizeTheme({ palette: 'dark', accent: '#112233', font: 'serif' })).toEqual({
      palette: 'dark',
      accent: '#112233',
      font: 'serif',
    })
    expect(themeColors({ palette: 'print', accent: '#ff0000', font: 'system' }).accent).toBe(
      '#000000',
    )
    expect(tint('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('buildRenderGraph', () => {
  const p = buildSampleProject()

  it('asettelee prosessin: kaikilla solmuilla on koko ja reunoilla reitti', async () => {
    const g = await buildRenderGraph(p, { ...DEFAULT_RENDER, processId: p.rootProcessId }, run)
    expect(g.nodes).toHaveLength(
      Object.values(p.nodes).filter((n) => n.processId === p.rootProcessId).length,
    )
    expect(g.nodes.every((n) => n.w > 0 && n.h > 0)).toBe(true)
    expect(g.edges.every((e) => e.points.length >= 2)).toBe(true)
    expect(g.width).toBeGreaterThan(200)
    expect(g.nodes.find((n) => n.kind === 'subprocess')!.hasChild).toBe(true)
    expect(g.nodes.some((n) => n.roleName === 'Ostoreskontra')).toBe(true)
  })

  it('avaa alaprosessit ryhmäksi ja antaa sisäkkäisille solmuille absoluuttiset sijainnit', async () => {
    const g = await buildRenderGraph(
      p,
      { ...DEFAULT_RENDER, processId: p.rootProcessId, expand: true },
      run,
    )
    const group = g.nodes.find((n) => n.group)!
    const inner = g.nodes.filter((n) => n.parentId === group.id)
    expect(inner.length).toBeGreaterThan(0)
    for (const n of inner) {
      expect(n.x).toBeGreaterThanOrEqual(group.x)
      expect(n.y).toBeGreaterThanOrEqual(group.y)
      expect(n.x + n.w).toBeLessThanOrEqual(group.x + group.w + 0.5)
      expect(n.y + n.h).toBeLessThanOrEqual(group.y + group.h + 0.5)
    }
  })

  it('vain vahvistetut: piilotettujen vaiheiden yli yhdistetään eikä virta katkea', async () => {
    const g = await buildRenderGraph(
      p,
      { ...DEFAULT_RENDER, processId: p.rootProcessId, onlyConfirmed: true },
      run,
    )
    expect(
      g.nodes.every((n) => n.kind === 'start' || n.kind === 'end' || n.confidence === 'confirmed'),
    ).toBe(true)
    // Kaikki näkyvät solmut ovat edelleen yhteydessä johonkin
    const connected = new Set(g.edges.flatMap((e) => [e.from, e.to]))
    expect(g.nodes.every((n) => connected.has(n.id))).toBe(true)
    expect(g.nodes.length).toBeLessThan(10)
  })

  it('filterProcess ei luo itsesilmukoita eikä kaksoisreunoja siltauksessa', () => {
    const f = filterProcess(p, p.rootProcessId, true)
    expect(f.edges.every((e) => e.from !== e.to)).toBe(true)
    expect(new Set(f.edges.map((e) => `${e.from}>${e.to}`)).size).toBe(f.edges.length)
  })

  it('selviää suuresta mallista kohtuullisessa ajassa', async () => {
    const big = buildLargeProject(250, 30)
    const t = performance.now()
    const g = await buildRenderGraph(
      big,
      { ...DEFAULT_RENDER, processId: big.rootProcessId, expand: true },
      run,
    )
    expect(performance.now() - t).toBeLessThan(10000)
    expect(g.nodes.length).toBeGreaterThan(250)
  })
})

describe('renderSvg', () => {
  const p = buildSampleProject()

  it('tuottaa kelvollista XML:ää, jossa jokaisella vaiheella on oma ryhmänsä', async () => {
    const g = await buildRenderGraph(
      p,
      { ...DEFAULT_RENDER, processId: p.rootProcessId, expand: true },
      run,
    )
    const svg = renderSvg(g, { ...SVG_OPTS, title: 'Ostolasku' })
    const doc = parseXml(svg)
    expect(doc.documentElement.getAttribute('aria-label')).toBe('Ostolasku')
    for (const n of g.nodes) expect(doc.querySelector(`[data-id="${n.id}"]`)).not.toBeNull()
    expect(doc.querySelectorAll('[data-edge]')).toHaveLength(g.edges.length)
    expect(doc.querySelector('marker#arrow')).not.toBeNull()
    expect(svg).toContain('Vastaanota lasku')
    expect(svg).toContain('Ostoreskontra')
  })

  it('suojaa XML-injektiolta nimissä, rooleissa ja haaroissa', async () => {
    const evil = '<script>alert(1)</script>" onload="x'
    let q = buildSampleProject()
    const id = Object.values(q.nodes).find((n) => n.label === 'Vastaanota lasku')!.id
    q = applyOperations(q, [
      { type: 'updateNode', id, patch: { label: evil } },
      { type: 'addNode', node: createNode(q.rootProcessId, { label: `</text><g onclick="x">` }) },
    ])
    const g = await buildRenderGraph(q, { ...DEFAULT_RENDER, processId: q.rootProcessId }, run)
    const svg = renderSvg(g, SVG_OPTS)
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('<g onclick')
    const doc = parseXml(svg)
    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('[onclick]')).toBeNull()
  })

  it('teemat ja varmuuden näyttö vaikuttavat ulkoasuun', async () => {
    const g = await buildRenderGraph(p, { ...DEFAULT_RENDER, processId: p.rootProcessId }, run)
    const light = renderSvg(g, SVG_OPTS)
    const dark = renderSvg(g, { ...SVG_OPTS, theme: { ...DEFAULT_THEME, palette: 'dark' } })
    const plain = renderSvg(g, {
      ...SVG_OPTS,
      showUncertainty: false,
      showRoles: false,
      showSystems: false,
    })
    expect(light).toContain('fill="#ffffff"')
    expect(dark).toContain('fill="#0b1120"')
    expect(light).toContain('stroke-dasharray="5 4"') // arvaus katkoviivalla
    expect(plain).not.toContain('stroke-dasharray')
    expect(plain).not.toContain('Ostoreskontra')
    // tulostusteema ei käytä värillisiä roolipalkkeja
    const print = renderSvg(g, { ...SVG_OPTS, theme: { ...DEFAULT_THEME, palette: 'print' } })
    expect(print).not.toMatch(/fill="hsl\(/)
  })

  it('läpikäyntikorostus himmentää muut vaiheet', async () => {
    const g = await buildRenderGraph(p, { ...DEFAULT_RENDER, processId: p.rootProcessId }, run)
    const cur = g.nodes[1].id
    const doc = parseXml(
      renderSvg(g, { ...SVG_OPTS, highlight: { current: cur, visited: new Set([g.nodes[0].id]) } }),
    )
    expect(doc.querySelector(`[data-id="${cur}"]`)!.getAttribute('opacity')).toBe('1')
    expect(doc.querySelector(`[data-id="${g.nodes[5].id}"]`)!.getAttribute('opacity')).toBe('0.25')
  })

  it('tyhjä graafi tuottaa silti kelvollisen kuvan', () => {
    parseXml(renderSvg({ nodes: [], edges: [], width: 0, height: 0 }, SVG_OPTS))
  })
})
