// @vitest-environment jsdom
import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildRenderGraph, DEFAULT_RENDER } from '../export/graph'
import { toBpmn } from '../export/bpmn'
import { toMermaid } from '../export/mermaid'
import { useDeterministicIds } from '../model/ids'
import { buildSampleProject } from '../model/sample'
import { edgesOf, nodesOf } from '../model/selectors'
import type { Project } from '../model/types'
import { validateProject } from '../model/validate'
import { BpmnImportError, parseBpmn } from './bpmnImport'
import { bridgeMerges, graphToOps, graphToProject, summarize } from './diagram'
import { MermaidImportError, parseMermaid } from './mermaidImport'
import { createProject } from '../model/factory'
import { applyOperations } from '../model/operations'

beforeEach(() => useDeterministicIds(true))
const elk = new ELK()
const run = (g: Parameters<typeof elk.layout>[0]) => elk.layout(g)

/** Rakenteen sormenjälki nimillä: vertailukelpoinen vaikka tunnisteet eroavat. */
function signature(p: Project, processId: string, roles = true): string[] {
  const out: string[] = []
  for (const n of nodesOf(p, processId)) {
    out.push(
      `N ${n.kind} ${n.label}${roles ? ` @${n.roleId ? p.entities[n.roleId].name : ''}` : ''}`,
    )
    if (n.childProcessId)
      out.push(...signature(p, n.childProcessId, roles).map((l) => `  [${n.label}] ${l}`))
  }
  for (const e of edgesOf(p, processId)) {
    out.push(`E ${p.nodes[e.from].label} -${e.label ?? ''}-> ${p.nodes[e.to].label}`)
  }
  return out.sort()
}

describe('BPMN-tuonti', () => {
  it('oma BPMN-vienti palautuu samaksi rakenteeksi (kierto)', async () => {
    const sample = buildSampleProject()
    const layout = await buildRenderGraph(
      sample,
      { ...DEFAULT_RENDER, processId: sample.rootProcessId },
      run,
    )
    const xml = toBpmn(sample, sample.rootProcessId, layout)
    const g = parseBpmn(xml)
    const back = graphToProject(g, 'Tuotu')
    expect(validateProject(back)).toEqual([])
    // Rooleja viedään vain päätasolta (uimaradat)
    const norm = (p: Project) => signature(p, p.rootProcessId).filter((l) => !l.startsWith('  '))
    expect(norm(back)).toEqual(norm(sample))
    // Alaprosessin rakenne säilyy ilman rooleja
    const sub = (p: Project) =>
      signature(p, p.rootProcessId, false).filter((l) => l.startsWith('  '))
    expect(sub(back)).toEqual(sub(sample))
    expect(g.skipped).toEqual([])
  })

  it('lukee uimaradat rooleiksi, dokumentaation kuvaukseksi ja ohittaa viestivirrat', () => {
    const xml = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d">
  <bpmn:collaboration id="c"><bpmn:participant id="P1" name="Asiakaspalvelu" processRef="Proc_1"/><bpmn:messageFlow id="m" sourceRef="a" targetRef="b"/></bpmn:collaboration>
  <bpmn:process id="Proc_1">
    <bpmn:laneSet><bpmn:lane id="L1" name="Myynti"><bpmn:flowNodeRef>T1</bpmn:flowNodeRef><bpmn:flowNodeRef>S</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Talous"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="S"/>
    <bpmn:userTask id="T1" name="Vastaanota tilaus"><bpmn:documentation>Tilaus tulee sähköpostilla</bpmn:documentation></bpmn:userTask>
    <bpmn:exclusiveGateway id="G1" name="Luotto ok?"/>
    <bpmn:serviceTask id="T2" name="Tarkista luotto"/>
    <bpmn:exclusiveGateway id="G2"/>
    <bpmn:endEvent id="E" name="Valmis"/>
    <bpmn:dataObject id="D"/>
    <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="T1"/>
    <bpmn:sequenceFlow id="f2" sourceRef="T1" targetRef="G1"/>
    <bpmn:sequenceFlow id="f3" name="Kyllä" sourceRef="G1" targetRef="T2"/>
    <bpmn:sequenceFlow id="f4" name="Ei" sourceRef="G1" targetRef="G2"/>
    <bpmn:sequenceFlow id="f5" sourceRef="T2" targetRef="G2"/>
    <bpmn:sequenceFlow id="f6" sourceRef="G2" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`
    const g = parseBpmn(xml)
    expect(g.processes).toHaveLength(1)
    expect(g.processes[0].name).toBe('Asiakaspalvelu')
    expect(g.skipped.sort()).toEqual(['dataobjektit', 'viestivirrat'])
    const p = graphToProject(g, 'X')
    const n = nodesOf(p, p.rootProcessId)
    expect(n.find((x) => x.label === 'Vastaanota tilaus')).toMatchObject({
      kind: 'step',
      description: 'Tilaus tulee sähköpostilla',
    })
    expect(p.entities[n.find((x) => x.label === 'Vastaanota tilaus')!.roleId!].name).toBe('Myynti')
    expect(p.entities[n.find((x) => x.label === 'Tarkista luotto')!.roleId!].name).toBe('Talous')
    expect(n.find((x) => x.label === 'Alku')?.kind).toBe('start')
    // Nimetön yhdistävä yhdyskäytävä G2 on sivuutettu ja yhteydet kytketty sen yli
    expect(n.filter((x) => x.kind === 'decision')).toHaveLength(1)
    const edges = edgesOf(p, p.rootProcessId).map(
      (e) => `${p.nodes[e.from].label}>${p.nodes[e.to].label}`,
    )
    expect(edges).toContain('Luotto ok?>Valmis')
    expect(edges).toContain('Tarkista luotto>Valmis')
    expect(validateProject(p)).toEqual([])
  })

  it('useampi prosessi tuodaan omina alaprosesseinaan', () => {
    const xml = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
      <process id="a" name="A"><startEvent id="s1"/><task id="t1" name="Eka"/><sequenceFlow id="x" sourceRef="s1" targetRef="t1"/></process>
      <process id="b" name="B"><task id="t2" name="Toka"/></process></definitions>`
    const p = graphToProject(parseBpmn(xml), 'Kaksi')
    const subs = nodesOf(p, p.rootProcessId).filter((n) => n.kind === 'subprocess')
    expect(subs.map((s) => s.label).sort()).toEqual(['A', 'B'])
    expect(validateProject(p)).toEqual([])
  })

  it('virheelliset tiedostot antavat selkeän virheen', () => {
    expect(() => parseBpmn('ei xml')).toThrow(BpmnImportError)
    expect(() => parseBpmn('<html><body/></html>')).toThrow(/definitions/)
    expect(() => parseBpmn('<definitions><process id="p"/></definitions>')).toThrow(/vaiheita/)
  })

  it('tuonti lisätään olemassa olevaan prosessiin atomisena operaatioerana', () => {
    const base = createProject('P')
    const g = parseBpmn(
      '<definitions><process id="p"><task id="a" name="Yksi"/><task id="b" name="Kaksi"/><sequenceFlow id="f" sourceRef="a" targetRef="b"/></process></definitions>',
    )
    const p = applyOperations(base, graphToOps(base, g, base.rootProcessId))
    expect(
      nodesOf(p, base.rootProcessId)
        .map((n) => n.label)
        .sort(),
    ).toEqual(['Kaksi', 'Yksi'])
    expect(edgesOf(p, base.rootProcessId)).toHaveLength(1)
  })
})

describe('Mermaid-tuonti', () => {
  it('oma Mermaid-vienti palautuu samaksi rakenteeksi (laajennetut alaprosessit subgraphina)', () => {
    const sample = buildSampleProject()
    const text = toMermaid(sample, sample.rootProcessId, { expand: true })
    const g = parseMermaid(text)
    const back = graphToProject(g, 'Tuotu')
    expect(validateProject(back)).toEqual([])
    const labels = (p: Project) =>
      Object.values(p.nodes)
        .filter((n) => n.kind !== 'start' && n.kind !== 'end')
        .map((n) => n.label)
        .sort()
    expect(labels(back)).toEqual(labels(sample))
    // Alaprosessi tuli subgraphista
    const sub = Object.values(back.nodes).find((n) => n.label === 'Hyväksyntäkierto')!
    expect(sub.kind).toBe('subprocess')
    expect(nodesOf(back, sub.childProcessId!).map((n) => n.label)).toContain('Lähetä esimiehelle')
    // Roolit tulevat kursiivirivistä
    const check = Object.values(back.nodes).find((n) => n.label === 'Tarkista laskun tiedot')!
    expect(back.entities[check.roleId!].name).toBe('Ostoreskontra')
  })

  it('lukee eri solmumuodot, nuolinimikkeet ja ketjut', () => {
    const g = parseMermaid(`flowchart LR
      A([Alku]) --> B[Vastaanota]
      B --> C{Kunnossa?}
      C -->|Kyllä| D[Hyväksy]
      C -- Ei --> E["Pyydä (korjaus)"]
      D --> F([Loppu])
      E -.-> B
      classDef x fill:#fff
      style A fill:#f00`)
    const p = graphToProject(g, 'X')
    const byLabel = (l: string) => Object.values(p.nodes).find((n) => n.label === l)!
    expect(byLabel('Alku').kind).toBe('start')
    expect(byLabel('Loppu').kind).toBe('end')
    expect(byLabel('Kunnossa?').kind).toBe('decision')
    expect(byLabel('Pyydä (korjaus)').kind).toBe('step')
    const edges = edgesOf(p, p.rootProcessId).map(
      (e) => `${p.nodes[e.from].label}-${e.label ?? ''}->${p.nodes[e.to].label}`,
    )
    expect(edges).toContain('Kunnossa?-Kyllä->Hyväksy')
    expect(edges).toContain('Kunnossa?-Ei->Pyydä (korjaus)')
    expect(edges).toContain('Pyydä (korjaus)-->Vastaanota')
  })

  it('markdown-koodilohko ja kommentit', () => {
    const g = parseMermaid('Teksti\n```mermaid\ngraph TD\n%% kommentti\nA[X] --> B[Y]\n```')
    expect(summarize(g).steps).toBe(2)
  })

  it('virheet', () => {
    expect(() => parseMermaid('hei vaan')).toThrow(MermaidImportError)
    expect(() => parseMermaid('flowchart TD\n%% tyhjä')).toThrow(/solmuja/)
  })
})

describe('bridgeMerges', () => {
  it('jättää nimetyt ja haarautuvat yhdyskäytävät', () => {
    const out = bridgeMerges({
      name: 'x',
      nodes: [
        { key: 'a', kind: 'step', label: 'A' },
        { key: 'g', kind: 'decision', label: '' },
        { key: 'b', kind: 'step', label: 'B' },
        { key: 'c', kind: 'step', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'g' },
        { from: 'g', to: 'b' },
        { from: 'g', to: 'c' },
      ],
    })
    expect(out.nodes.map((n) => n.key)).toContain('g')
  })
})
