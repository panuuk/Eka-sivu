import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEdge,
  createEntity,
  createNode,
  createProcess,
  createProject,
} from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations, type Operation } from '../model/operations'
import { buildSampleProject } from '../model/sample'
import { validateProject } from '../model/validate'
import { opsExpandNode } from '../model/commands'
import type { Project } from '../model/types'
import { analyze } from './analyze'
import {
  opsAddBranch,
  opsAddEnd,
  opsAddStart,
  opsConnect,
  opsConnectToEnd,
  opsDismissGap,
  opsMergeNodes,
  opsRestoreGap,
} from './fixes'
import { findGaps } from './gaps'

beforeEach(() => useDeterministicIds(true))

/** Rakentaa nimetyistä solmuista ja reunoista prosessin. */
function build(spec: {
  nodes: [string, Partial<Parameters<typeof createNode>[1]>?][]
  edges: [string, string, string?][]
}): { p: Project; id: (label: string) => string } {
  let p = createProject()
  const r = p.rootProcessId
  const map = new Map<string, string>()
  const ops: Operation[] = []
  for (const [label, extra] of spec.nodes) {
    const n = createNode(r, { label, ...extra })
    map.set(label, n.id)
    ops.push({ type: 'addNode', node: n })
  }
  for (const [a, b, l] of spec.edges)
    ops.push({ type: 'addEdge', edge: createEdge(r, map.get(a)!, map.get(b)!, l) })
  p = applyOperations(p, ops)
  return { p, id: (l) => map.get(l)! }
}

const rules = (p: Project) => findGaps(p).map((g) => `${g.rule}`)
const keys = (p: Project) => findGaps(p).map((g) => g.key)

describe('findGaps', () => {
  it('ehjä prosessi ei tuota aukkoja', () => {
    const built = build({
      nodes: [
        ['Alku', { kind: 'start', confidence: 'confirmed' }],
        ['A', { confidence: 'confirmed' }],
        ['Loppu', { kind: 'end', confidence: 'confirmed' }],
      ],
      edges: [
        ['Alku', 'A'],
        ['A', 'Loppu'],
      ],
    })
    let p = built.p
    const id = built.id
    const role = createEntity('role', 'Myynti')
    p = applyOperations(p, [
      { type: 'addEntity', entity: role },
      { type: 'updateNode', id: id('A'), patch: { roleId: role.id } },
    ])
    expect(findGaps(p)).toEqual([])
  })

  it('löytää puuttuvan roolin', () => {
    const { p, id } = build({ nodes: [['A'], ['B']], edges: [['A', 'B']] })
    const gaps = findGaps(p).filter((g) => g.rule === 'no-role')
    expect(gaps.map((g) => g.targetId).sort()).toEqual([id('A'), id('B')].sort())
    expect(gaps[0].text).toMatch(/Kuka tekee vaiheen/)
  })

  it('löytää päätöksen puutteelliset haarat ja nimeämättömät haarat', () => {
    const one = build({ nodes: [['D', { kind: 'decision' }], ['X']], edges: [['D', 'X', 'kyllä']] })
    expect(rules(one.p)).toContain('decision-branches')
    expect(findGaps(one.p).find((g) => g.rule === 'decision-branches')!.text).toMatch(
      /vain yksi haara/,
    )
    const none = build({ nodes: [['D', { kind: 'decision' }]], edges: [] })
    expect(findGaps(none.p).find((g) => g.rule === 'decision-branches')!.text).toMatch(
      /ei ole yhtään haaraa/,
    )
    const unlabeled = build({
      nodes: [['D', { kind: 'decision' }], ['X'], ['Y']],
      edges: [
        ['D', 'X', 'kyllä'],
        ['D', 'Y'],
      ],
    })
    const g = findGaps(unlabeled.p).find((x) => x.rule === 'decision-labels')!
    expect(g.data!.edgeIds).toHaveLength(1)
  })

  it('löytää saavuttamattomat solmut ja umpikujat', () => {
    const { p, id } = build({
      nodes: [['Alku', { kind: 'start' }], ['A'], ['Orpo'], ['Umpi'], ['Loppu', { kind: 'end' }]],
      edges: [
        ['Alku', 'A'],
        ['A', 'Umpi'],
        ['Orpo', 'Loppu'],
      ],
    })
    const keysList = keys(p)
    expect(keysList).toContain(`unreachable:${id('Orpo')}`)
    expect(keysList).toContain(`dead-end:${id('Umpi')}`)
    expect(keysList).not.toContain(`unreachable:${id('A')}`)
  })

  it('ei vaadi alkua/loppua yhden solmun prosessilta, mutta huomauttaa useammalta', () => {
    expect(rules(build({ nodes: [['A']], edges: [] }).p)).not.toContain('no-start')
    const two = build({ nodes: [['A'], ['B']], edges: [['A', 'B']] })
    expect(rules(two.p)).toEqual(expect.arrayContaining(['no-start', 'no-end']))
  })

  it('yksittäinen häntä ilman loppupistettä on luonnollinen, useampi umpikuja ei', () => {
    const single = build({
      nodes: [['Alku', { kind: 'start' }], ['A'], ['B']],
      edges: [
        ['Alku', 'A'],
        ['A', 'B'],
      ],
    })
    expect(rules(single.p)).not.toContain('dead-end')
    const multi = build({
      nodes: [['Alku', { kind: 'start' }], ['A'], ['B']],
      edges: [
        ['Alku', 'A'],
        ['Alku', 'B'],
      ],
    })
    expect(rules(multi.p).filter((r) => r === 'dead-end')).toHaveLength(2)
  })

  it('löytää arvauksen ilman lähdettä ja tyhjän alaprosessin', () => {
    const built = build({
      nodes: [
        ['A', { confidence: 'guess' }],
        ['S', { kind: 'subprocess' }],
      ],
      edges: [],
    })
    let p = built.p
    const id = built.id
    p = applyOperations(p, opsExpandNode(p, id('S')).ops)
    const r = rules(p)
    expect(r).toContain('guess-unsourced')
    expect(r).toContain('empty-subprocess')
    // lähteellinen arvaus ei ole aukko
    p = applyOperations(p, [
      {
        type: 'addSource',
        source: { id: 's', title: 'x', kind: 'note', text: 'teksti', addedAt: 1 },
      },
      {
        type: 'updateNode',
        id: id('A'),
        patch: { sources: [{ sourceId: 's', start: 0, end: 5, quote: 'tekst' }] },
      },
    ])
    expect(rules(p)).not.toContain('guess-unsourced')
  })

  it('löytää syötteen, jota mikään ei tuota, kerran artefaktia kohti', () => {
    const built = build({ nodes: [['A'], ['B'], ['C']], edges: [] })
    let p = built.p
    const id = built.id
    const lasku = createEntity('artifact', 'Lasku')
    const maksu = createEntity('artifact', 'Maksu')
    p = applyOperations(p, [
      { type: 'addEntity', entity: lasku },
      { type: 'addEntity', entity: maksu },
      { type: 'updateNode', id: id('A'), patch: { inputIds: [lasku.id], outputIds: [maksu.id] } },
      { type: 'updateNode', id: id('B'), patch: { inputIds: [lasku.id, maksu.id] } },
    ])
    const gaps = findGaps(p).filter((g) => g.rule === 'artifact-source')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].entityId).toBe(lasku.id)
    // kun jokin tuottaa sen, aukko poistuu
    p = applyOperations(p, [{ type: 'updateNode', id: id('C'), patch: { outputIds: [lasku.id] } }])
    expect(rules(p)).not.toContain('artifact-source')
  })

  it('löytää lähteen ja roolin ristiriidan', () => {
    const built = build({ nodes: [['Hyväksy']], edges: [] })
    let p = built.p
    const id = built.id
    const esimies = createEntity('role', 'Esimies')
    const talous = createEntity('role', 'Talous')
    const quote = 'Esimies hyväksyy laskun'
    p = applyOperations(p, [
      { type: 'addEntity', entity: esimies },
      { type: 'addEntity', entity: talous },
      { type: 'addSource', source: { id: 's', title: 'x', kind: 'note', text: quote, addedAt: 1 } },
      {
        type: 'updateNode',
        id: id('Hyväksy'),
        patch: {
          roleId: talous.id,
          sources: [{ sourceId: 's', start: 0, end: quote.length, quote }],
        },
      },
    ])
    const g = findGaps(p).find((x) => x.rule === 'source-conflict')!
    expect(g.entityId).toBe(esimies.id)
    expect(g.text).toMatch(/Esimies.*Talous/)
    // sama rooli kuin lähteessä: ei ristiriitaa
    p = applyOperations(p, [
      { type: 'updateNode', id: id('Hyväksy'), patch: { roleId: esimies.id } },
    ])
    expect(rules(p)).not.toContain('source-conflict')
  })

  it('löytää samannimiset vaiheet, mutta ei saman nimistä vaihetta ja päätöstä', () => {
    const dup = build({ nodes: [['Tarkista'], [' tarkista ']], edges: [] })
    expect(rules(dup.p)).toContain('duplicate-label')
    const mixed = build({
      nodes: [['Hyväksytty', { kind: 'decision' }], ['Hyväksytty']],
      edges: [],
    })
    expect(rules(mixed.p)).not.toContain('duplicate-label')
  })

  it('löytää lähes samannimiset vaiheet mutta ei eri toimenpiteitä samasta kohteesta', () => {
    const similar = build({ nodes: [['Tarkista lasku'], ['Laskun tarkistus']], edges: [] })
    const g = findGaps(similar.p).find((x) => x.rule === 'duplicate-label')
    expect(g?.text).toMatch(/kuulostavat samalta/)
    expect(g?.data?.similar).toBe(true)
    const different = build({ nodes: [['Tarkista lasku'], ['Hyväksy lasku']], edges: [] })
    expect(rules(different.p)).not.toContain('duplicate-label')
    // yhden sanan nimiä ei verrata sumeasti
    const single = build({ nodes: [['Tarkista'], ['Tarkastus']], edges: [] })
    expect(rules(single.p)).not.toContain('duplicate-label')
  })

  it('järjestää vakavuuden mukaan ja avaimet ovat vakaat ajosta toiseen', () => {
    const { p } = build({
      nodes: [['Alku', { kind: 'start' }], ['A'], ['Orpo']],
      edges: [['Alku', 'A']],
    })
    const first = findGaps(p)
    expect(first.map((g) => g.severity)).toEqual(
      [...first.map((g) => g.severity)].sort((a, b) => 'hml'.indexOf(a[0]) - 'hml'.indexOf(b[0])),
    )
    expect(findGaps(p).map((g) => g.key)).toEqual(first.map((g) => g.key))
  })

  it('esimerkkiprojekti: tunnetut aukot löytyvät', () => {
    const p = buildSampleProject()
    const gaps = findGaps(p)
    const rs = gaps.map((g) => g.rule)
    expect(rs).toContain('guess-unsourced')
    expect(rs).toContain('no-role') // "Pyydä korjaus toimittajalta" ilman roolia
    expect(rs).toContain('artifact-source') // Ostotilaus ei tule mistään
    expect(gaps.every((g) => g.text.length > 10)).toBe(true)
  })
})

describe('korjaukset', () => {
  it('opsAddStart ja opsAddEnd yhdistävät oikeat solmut', () => {
    const { p, id } = build({
      nodes: [['A'], ['B'], ['C']],
      edges: [
        ['A', 'B'],
        ['A', 'C'],
      ],
    })
    const withStart = applyOperations(p, opsAddStart(p, p.rootProcessId))
    const start = Object.values(withStart.nodes).find((n) => n.kind === 'start')!
    expect(
      Object.values(withStart.edges)
        .filter((e) => e.from === start.id)
        .map((e) => e.to),
    ).toEqual([id('A')])
    const withEnd = applyOperations(withStart, opsAddEnd(withStart, p.rootProcessId))
    const end = Object.values(withEnd.nodes).find((n) => n.kind === 'end')!
    expect(
      Object.values(withEnd.edges)
        .filter((e) => e.to === end.id)
        .map((e) => e.from)
        .sort(),
    ).toEqual([id('B'), id('C')].sort())
    expect(validateProject(withEnd)).toEqual([])
    expect(rules(withEnd)).not.toContain('no-start')
    expect(rules(withEnd)).not.toContain('no-end')
    // idempotentti
    expect(opsAddStart(withEnd, p.rootProcessId)).toEqual([])
    expect(opsAddEnd(withEnd, p.rootProcessId)).toEqual([])
  })

  it('opsAddStart käsittelee pelkän syklin', () => {
    const { p } = build({
      nodes: [['A'], ['B']],
      edges: [
        ['A', 'B'],
        ['B', 'A'],
      ],
    })
    const next = applyOperations(p, opsAddStart(p, p.rootProcessId))
    expect(validateProject(next)).toEqual([])
    expect(Object.values(next.edges)).toHaveLength(3)
  })

  it('opsConnectToEnd luo loppupisteen tarvittaessa ja käyttää olemassa olevaa', () => {
    const { p, id } = build({ nodes: [['A'], ['B']], edges: [] })
    const once = applyOperations(p, opsConnectToEnd(p, id('A')))
    const twice = applyOperations(once, opsConnectToEnd(once, id('B')))
    expect(Object.values(twice.nodes).filter((n) => n.kind === 'end')).toHaveLength(1)
    expect(Object.values(twice.edges)).toHaveLength(2)
  })

  it('opsConnect estää kaksoiskappaleet ja itsesilmukat', () => {
    const { p, id } = build({ nodes: [['A'], ['B']], edges: [['A', 'B']] })
    expect(opsConnect(p, id('A'), id('B'))).toEqual([])
    expect(opsConnect(p, id('A'), id('A'))).toEqual([])
    expect(opsConnect(p, id('B'), id('A'))).toHaveLength(1)
  })

  it('opsAddBranch nimeää haaran seuraavalla vapaalla nimellä', () => {
    const { p, id } = build({
      nodes: [['D', { kind: 'decision' }], ['X']],
      edges: [['D', 'X', 'Kyllä']],
    })
    const r = opsAddBranch(p, id('D'), 'Korjaa')!
    const next = applyOperations(p, r.ops)
    const e = Object.values(next.edges).find((x) => x.to === r.nodeId)!
    expect(e.label).toBe('Ei')
    expect(next.nodes[r.nodeId].label).toBe('Korjaa')
    expect(rules(next)).not.toContain('decision-branches')
  })

  it('opsMergeNodes siirtää reunat ja tiedot ilman silmukoita tai kaksoisyhteyksiä', () => {
    const { p, id } = build({
      nodes: [['Eka'], ['Tarkista'], ['Tarkista '], ['Loppu']],
      edges: [
        ['Eka', 'Tarkista'],
        ['Eka', 'Tarkista '],
        ['Tarkista ', 'Loppu'],
      ],
    })
    const role = createEntity('role', 'Talous')
    const sys = createEntity('system', 'ERP')
    const withData = applyOperations(p, [
      { type: 'addEntity', entity: role },
      { type: 'addEntity', entity: sys },
      {
        type: 'updateNode',
        id: id('Tarkista '),
        patch: {
          roleId: role.id,
          systemIds: [sys.id],
          confidence: 'confirmed',
          description: 'lisätieto',
        },
      },
    ])
    const merged = applyOperations(
      withData,
      opsMergeNodes(withData, id('Tarkista'), id('Tarkista ')),
    )
    expect(merged.nodes[id('Tarkista ')]).toBeUndefined()
    const keep = merged.nodes[id('Tarkista')]
    expect(keep.roleId).toBe(role.id)
    expect(keep.systemIds).toEqual([sys.id])
    expect(keep.confidence).toBe('confirmed')
    expect(keep.description).toBe('lisätieto')
    const edges = Object.values(merged.edges)
      .map((e) => `${merged.nodes[e.from].label}>${merged.nodes[e.to].label}`)
      .sort()
    expect(edges).toEqual(['Eka>Tarkista', 'Tarkista>Loppu'])
    expect(validateProject(merged)).toEqual([])
  })

  it('opsMergeNodes siirtää alaprosessin säilytettävälle', () => {
    const built = build({ nodes: [['A'], ['B', { kind: 'subprocess' }]], edges: [] })
    let p = built.p
    const id = built.id
    p = applyOperations(p, opsExpandNode(p, id('B')).ops)
    const merged = applyOperations(p, opsMergeNodes(p, id('A'), id('B')))
    expect(validateProject(merged)).toEqual([])
    expect(merged.nodes[id('A')].kind).toBe('subprocess')
    expect(Object.keys(merged.processes)).toHaveLength(2)
  })

  it('ohitus ja palautus toimivat avaimella', () => {
    const { p } = build({ nodes: [['A'], ['B']], edges: [['A', 'B']] })
    const gap = findGaps(p).find((g) => g.rule === 'no-role')!
    const dismissed = applyOperations(p, opsDismissGap(gap))
    const a = analyze(dismissed)
    expect(a.open.some((g) => g.key === gap.key)).toBe(false)
    expect(a.dismissed.map((g) => g.key)).toEqual([gap.key])
    const restored = applyOperations(dismissed, opsRestoreGap(dismissed, gap.key))
    expect(analyze(restored).open.some((g) => g.key === gap.key)).toBe(true)
    expect(validateProject(dismissed)).toEqual([])
  })
})

describe('analyze ja valmiusaste', () => {
  it('välimuisti palauttaa saman tuloksen samalle projektille', () => {
    const { p } = build({ nodes: [['A']], edges: [] })
    expect(analyze(p)).toBe(analyze(p))
  })

  it('valmiusaste: tyhjä on 0, valmis 100, arvaukset ja aukot laskevat sitä', () => {
    expect(analyze(createProject()).readiness(createProject().rootProcessId).percent).toBe(0)

    const role = createEntity('role', 'R')
    const built = build({
      nodes: [
        ['Alku', { kind: 'start', confidence: 'confirmed' }],
        ['A', { confidence: 'confirmed' }],
        ['B', { confidence: 'confirmed' }],
        ['Loppu', { kind: 'end', confidence: 'confirmed' }],
      ],
      edges: [
        ['Alku', 'A'],
        ['A', 'B'],
        ['B', 'Loppu'],
      ],
    })
    let p = built.p
    const id = built.id
    p = applyOperations(p, [
      { type: 'addEntity', entity: role },
      { type: 'updateNode', id: id('A'), patch: { roleId: role.id } },
      { type: 'updateNode', id: id('B'), patch: { roleId: role.id } },
    ])
    const full = analyze(p).readiness(p.rootProcessId)
    expect(full).toMatchObject({
      percent: 100,
      nodes: 2,
      confirmed: 2,
      guesses: 0,
      openQuestions: 0,
    })

    const worse = applyOperations(p, [
      { type: 'updateNode', id: id('B'), patch: { confidence: 'guess', roleId: undefined } },
    ])
    const r = analyze(worse).readiness(worse.rootProcessId)
    expect(r.percent).toBeLessThan(100)
    expect(r.guesses).toBe(1)
    expect(r.openQuestions).toBeGreaterThanOrEqual(2) // ei roolia + arvaus ilman lähdettä
  })

  it('alaprosessit lasketaan mukaan vanhemman valmiusasteeseen', () => {
    const built = build({ nodes: [['S', { kind: 'subprocess' }]], edges: [] })
    let p = built.p
    const id = built.id
    p = applyOperations(p, opsExpandNode(p, id('S')).ops)
    const child = Object.values(p.processes).find((x) => x.parentNodeId)!
    const x = createNode(child.id, { label: 'Sisällä' })
    p = applyOperations(p, [{ type: 'addNode', node: x }])
    const a = analyze(p)
    expect(a.readiness(p.rootProcessId, true).nodes).toBe(2)
    expect(a.readiness(p.rootProcessId, false).nodes).toBe(1)
    expect(a.perNode.get(x.id)).toBeGreaterThan(0)
  })

  it('omat kysymykset lasketaan avoimiin ja solmuihin', () => {
    const { p, id } = build({ nodes: [['A']], edges: [] })
    const q = applyOperations(p, [
      {
        type: 'addQuestion',
        question: {
          id: 'q1',
          processId: p.rootProcessId,
          targetId: id('A'),
          rule: 'custom',
          text: 'Entä jos?',
          status: 'open',
          key: 'custom:1',
        },
      },
      {
        type: 'addQuestion',
        question: {
          id: 'q2',
          processId: p.rootProcessId,
          rule: 'custom',
          text: 'Vastattu',
          status: 'answered',
          key: 'custom:2',
          answer: 'ok',
        },
      },
    ])
    const a = analyze(q)
    expect(a.custom).toHaveLength(2)
    expect(a.perNode.get(id('A'))).toBe(2) // ei-rooli + oma kysymys
    expect(a.readiness(p.rootProcessId).openQuestions).toBe(2)
  })

  it('process-ei-käytössä-importit', () => {
    expect(createProcess('x').name).toBe('x')
  })
})
