import { beforeEach, describe, expect, it } from 'vitest'
import { createEdge, createNode, createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { edgesOf, findEntity, nodesOf } from '../model/selectors'
import { validateProject } from '../model/validate'
import type { Project } from '../model/types'
import { planText, type PlanOptions } from './plan'

beforeEach(() => useDeterministicIds(true))

const EXAMPLE = `# Tilauksen käsittely
- Vastaanota tilaus @Myynti [CRM] > Tilaus
- Tarkista luottotiedot @Talous
? Ylittyykö luottoraja
  kyllä: Pyydä ennakkomaksu @Talous
  ei: jatka
- Lähetä tilausvahvistus @Myynti [Sähköposti] ~arvaus`

function edgeList(p: Project, processId: string): string[] {
  return edgesOf(p, processId)
    .map(
      (e) =>
        `${p.nodes[e.from].label}${e.label ? ` -[${e.label}]->` : ' ->'} ${p.nodes[e.to].label}`,
    )
    .sort()
}

function apply(p: Project, text: string, opts: Partial<PlanOptions> = {}) {
  const plan = planText(p, text, { processId: p.rootProcessId, ...opts })
  return { plan, project: applyOperations(p, plan.ops) }
}

describe('planText: uusi prosessi tyhjään', () => {
  it('luo alun, vaiheet, haaran ja lopun', () => {
    const { plan, project } = apply(createProject(), EXAMPLE)
    expect(plan.hasErrors).toBe(false)
    expect(validateProject(project)).toEqual([])
    const root = project.rootProcessId
    expect(
      nodesOf(project, root)
        .map((n) => n.label)
        .sort(),
    ).toEqual(
      [
        'Alku',
        'Loppu',
        'Lähetä tilausvahvistus',
        'Pyydä ennakkomaksu',
        'Tarkista luottotiedot',
        'Vastaanota tilaus',
        'Ylittyykö luottoraja',
      ].sort(),
    )
    expect(edgeList(project, root)).toEqual(
      [
        'Alku -> Vastaanota tilaus',
        'Vastaanota tilaus -> Tarkista luottotiedot',
        'Tarkista luottotiedot -> Ylittyykö luottoraja',
        'Ylittyykö luottoraja -[kyllä]-> Pyydä ennakkomaksu',
        'Ylittyykö luottoraja -[ei]-> Lähetä tilausvahvistus',
        'Pyydä ennakkomaksu -> Lähetä tilausvahvistus',
        'Lähetä tilausvahvistus -> Loppu',
      ].sort(),
    )
  })

  it('luo entiteetit ja soveltaa merkinnät', () => {
    const { project } = apply(createProject(), EXAMPLE)
    const step = Object.values(project.nodes).find((n) => n.label === 'Vastaanota tilaus')!
    expect(project.entities[step.roleId!].name).toBe('Myynti')
    expect(step.systemIds.map((id) => project.entities[id].name)).toEqual(['CRM'])
    expect(step.outputIds.map((id) => project.entities[id].name)).toEqual(['Tilaus'])
    const guess = Object.values(project.nodes).find((n) => n.label === 'Lähetä tilausvahvistus')!
    expect(guess.confidence).toBe('guess')
    // Sama rooli käytetään uudelleen, ei kaksoiskappaleita
    expect(Object.values(project.entities).filter((e) => e.name === 'Myynti')).toHaveLength(1)
    expect(Object.values(project.entities).filter((e) => e.kind === 'role')).toHaveLength(2)
  })

  it('käyttää alun ja lopun automaattisesti vain kun ne puuttuvat tekstistä', () => {
    const { project } = apply(createProject(), 'alku\n- A\nloppu')
    expect(
      nodesOf(project, project.rootProcessId)
        .map((n) => n.kind)
        .sort(),
    ).toEqual(['end', 'start', 'step'])
    expect(edgeList(project, project.rootProcessId)).toEqual(['A -> Loppu', 'Alku -> A'])
  })
})

describe('planText: idempotenssi ja täsmäys', () => {
  it('saman tekstin lisääminen uudelleen ei muuta mitään', () => {
    const first = apply(createProject(), EXAMPLE)
    const second = apply(first.project, EXAMPLE)
    expect(second.plan.ops).toEqual([])
    expect(second.plan.effects.some((e) => e.status === 'new' || e.status === 'updated')).toBe(
      false,
    )
    expect(second.project).toBe(first.project)
  })

  it('täsmää olemassa olevan vaiheen nimellä ja päivittää merkinnät', () => {
    const first = apply(createProject(), '- A @Myynti\n- B')
    const second = apply(first.project, '- A @Talous [ERP] ~vahvistettu', { mode: 'standalone' })
    const a = Object.values(second.project.nodes).find((n) => n.label === 'A')!
    expect(Object.values(second.project.nodes).filter((n) => n.label === 'A')).toHaveLength(1)
    expect(second.project.entities[a.roleId!].name).toBe('Talous')
    expect(a.confidence).toBe('confirmed')
    expect(second.plan.diff.changedNodes[0].fields.join()).toMatch(/rooli: Myynti → Talous/)
    expect(second.plan.effects[0].status).toBe('updated')
  })

  it('kirjainkoolla ja välilyönneillä ei ole väliä nimen täsmäyksessä', () => {
    const first = apply(createProject(), '- Tarkista   lasku')
    const second = apply(first.project, '- tarkista lasku', { mode: 'standalone' })
    expect(second.plan.diff.newNodes).toEqual([])
  })

  it('saman nimiset vaiheet tekstissä ovat eri solmuja, jos vastinetta ei ole', () => {
    const { project } = apply(createProject(), '- Tarkista\n- Käsittele\n- Tarkista')
    expect(Object.values(project.nodes).filter((n) => n.label === 'Tarkista')).toHaveLength(2)
  })

  it('kuvaus (sisennetyt rivit) ei kasva toistettaessa', () => {
    const text = '- A\n  - lisätieto'
    const first = apply(createProject(), text)
    const second = apply(first.project, text)
    expect(second.plan.ops).toEqual([])
    expect(Object.values(first.project.nodes).find((n) => n.label === 'A')!.description).toBe(
      '- lisätieto'.replace('- ', ''),
    )
  })
})

describe('planText: liittäminen olemassa olevaan prosessiin', () => {
  function base(): { p: Project; ids: Record<string, string> } {
    let p = createProject()
    const r = p.rootProcessId
    const [s, a, e] = [
      createNode(r, { label: 'Alku', kind: 'start' }),
      createNode(r, { label: 'A' }),
      createNode(r, { label: 'Loppu', kind: 'end' }),
    ]
    p = applyOperations(p, [
      ...[s, a, e].map((node) => ({ type: 'addNode' as const, node })),
      { type: 'addEdge', edge: createEdge(r, s.id, a.id) },
      { type: 'addEdge', edge: createEdge(r, a.id, e.id) },
    ])
    return { p, ids: { s: s.id, a: a.id, e: e.id } }
  }

  it('lisää sisällön ennen loppua, kun lopulla on yksi edeltäjä', () => {
    const { p } = base()
    const { project } = apply(p, '- B\n- C')
    expect(validateProject(project)).toEqual([])
    expect(edgeList(project, p.rootProcessId)).toEqual([
      'A -> B',
      'Alku -> A',
      'B -> C',
      'C -> Loppu',
    ])
  })

  it('käyttää valittua solmua liitoskohtana ja liittää väliin', () => {
    const { p, ids } = base()
    const { project } = apply(p, '- X', { anchorNodeId: ids.s })
    expect(edgeList(project, p.rootProcessId)).toEqual(['A -> Loppu', 'Alku -> X', 'X -> A'])
  })

  it('valinta loppusolmusta käyttää loppua edeltävää solmua', () => {
    const { p, ids } = base()
    const { project } = apply(p, '- X', { anchorNodeId: ids.e })
    expect(edgeList(project, p.rootProcessId)).toEqual(['A -> X', 'Alku -> A', 'X -> Loppu'])
  })

  it('standalone ei liitä mihinkään', () => {
    const { p } = base()
    const { project } = apply(p, '- X\n- Y', { mode: 'standalone' })
    expect(edgeList(project, p.rootProcessId)).toEqual(['A -> Loppu', 'Alku -> A', 'X -> Y'])
  })

  it('valittu päätös saa uuden haaran ilman väliinliittämistä', () => {
    let { p } = base()
    const r = p.rootProcessId
    const d = createNode(r, { label: 'Päätös?', kind: 'decision' })
    const b = createNode(r, { label: 'B' })
    p = applyOperations(p, [
      { type: 'addNode', node: d },
      { type: 'addNode', node: b },
      { type: 'addEdge', edge: createEdge(r, d.id, b.id, 'kyllä') },
    ])
    const { project } = apply(p, '- Uusi haara', { anchorNodeId: d.id })
    expect(edgeList(project, r)).toContain('Päätös? -> Uusi haara')
    expect(edgeList(project, r)).toContain('Päätös? -[kyllä]-> B')
  })

  it('varoittaa, kun liitoskohtaa ei voi päätellä', () => {
    let { p } = base()
    const r = p.rootProcessId
    const extra = createNode(r, { label: 'Toinen' })
    p = applyOperations(p, [
      { type: 'addNode', node: extra },
      {
        type: 'addEdge',
        edge: createEdge(r, extra.id, Object.values(p.nodes).find((n) => n.kind === 'end')!.id),
      },
    ])
    const { plan } = apply(p, '- Uusi')
    expect(plan.issues.some((i) => /liitoskohtaa ei voitu päätellä/.test(i.message))).toBe(true)
  })

  it('päätöksen haarat yhdistyvät jatkoon myös silloin, kun haaralla on useita vaiheita', () => {
    const text = '? Q\n  a:\n    - X\n    - Y\n  b: Z\n- Jatko'
    const { project } = apply(createProject(), text)
    expect(edgeList(project, project.rootProcessId)).toEqual(
      [
        'Alku -> Q',
        'Q -[a]-> X',
        'Q -[b]-> Z',
        'X -> Y',
        'Y -> Jatko',
        'Z -> Jatko',
        'Jatko -> Loppu',
      ].sort(),
    )
  })
})

describe('planText: hypyt, loppu ja alaprosessit', () => {
  it('tukee paluuhyppyä (silmukka) ja etuviittausta', () => {
    const text =
      '- Vastaanota\n- Tarkista\n? OK?\n  ei: -> Vastaanota\n  kyllä: -> Valmis\n- Valmis'
    const { plan, project } = apply(createProject(), text)
    expect(plan.hasErrors).toBe(false)
    const edges = edgeList(project, project.rootProcessId)
    expect(edges).toContain('OK? -[ei]-> Vastaanota')
    expect(edges).toContain('OK? -[kyllä]-> Valmis')
    // hyppyhaarat eivät jatka seuraavaan vaiheeseen
    expect(edges).not.toContain('OK? -> Valmis')
  })

  it('raportoi tuntemattoman hyppykohteen', () => {
    const { plan } = apply(createProject(), '- A\n-> Puuttuva')
    expect(plan.issues.some((i) => i.severity === 'error' && /Puuttuva/.test(i.message))).toBe(true)
    expect(plan.hasErrors).toBe(true)
  })

  it('loppu-haara yhdistyy prosessin loppuun', () => {
    const { project } = apply(createProject(), '- A\n? Q\n  ei: loppu\n  kyllä: jatka\n- B')
    const edges = edgeList(project, project.rootProcessId)
    expect(edges).toContain('Q -[ei]-> Loppu')
    expect(edges).toContain('B -> Loppu')
    expect(Object.values(project.nodes).filter((n) => n.kind === 'end')).toHaveLength(1)
  })

  it('luo alaprosessin ja sen sisällön alku- ja loppupisteineen', () => {
    const { project } = apply(
      createProject(),
      '- A\n+ Hyväksyntä @Esimies\n  - Lähetä\n  - Päätä\n- B',
    )
    expect(validateProject(project)).toEqual([])
    const sub = Object.values(project.nodes).find((n) => n.label === 'Hyväksyntä')!
    expect(sub.kind).toBe('subprocess')
    const child = project.processes[sub.childProcessId!]
    expect(child.name).toBe('Hyväksyntä')
    expect(edgeList(project, child.id)).toEqual([
      'Alku -> Lähetä',
      'Lähetä -> Päätä',
      'Päätä -> Loppu',
    ])
    expect(edgeList(project, project.rootProcessId)).toContain('A -> Hyväksyntä')
    expect(edgeList(project, project.rootProcessId)).toContain('Hyväksyntä -> B')
  })

  it('alaprosessin lisääminen uudelleen on idempotenttia ja täydentää olemassa olevaa', () => {
    const first = apply(createProject(), '+ S\n  - X')
    const again = apply(first.project, '+ S\n  - X')
    expect(again.plan.ops).toEqual([])
    const more = apply(first.project, '+ S\n  - Y')
    const sub = Object.values(more.project.nodes).find((n) => n.label === 'S')!
    expect(edgeList(more.project, sub.childProcessId!)).toEqual([
      'Alku -> X',
      'X -> Y',
      'Y -> Loppu',
    ])
  })
})

describe('planText: asetukset', () => {
  it('luo uuden prosessin otsikolla tai annetulla nimellä', () => {
    const p = createProject()
    const a = apply(p, '# Ostot\n- A', { newProcessName: '' })
    expect(Object.values(a.project.processes).map((x) => x.name)).toContain('Ostot')
    const b = apply(p, '- A', { newProcessName: 'Oma nimi' })
    expect(b.plan.targetProcessId).not.toBe(p.rootProcessId)
    expect(b.project.processes[b.plan.targetProcessId].name).toBe('Oma nimi')
    expect(
      nodesOf(b.project, b.plan.targetProcessId)
        .map((n) => n.kind)
        .sort(),
    ).toEqual(['end', 'start', 'step'])
    expect(nodesOf(b.project, p.rootProcessId)).toHaveLength(0)
  })

  it('tallentaa tekstin lähteeksi ja liittää rivikohtaiset viitteet', () => {
    const { project } = apply(createProject(), '- Eka\n- Toka', {
      saveSource: true,
      sourceTitle: 'Muistio',
    })
    const src = Object.values(project.sources)[0]
    expect(src.title).toBe('Muistio')
    const eka = Object.values(project.nodes).find((n) => n.label === 'Eka')!
    expect(eka.sources).toHaveLength(1)
    expect(src.text.slice(eka.sources[0].start, eka.sources[0].end)).toBe('- Eka')
    expect(eka.sources[0].quote).toBe('- Eka')
    expect(validateProject(project)).toEqual([])
  })

  it('ohitetut rivit eivät vaikuta ja yhteydet kulkevat ohitetun yli', () => {
    const { project } = apply(createProject(), '- A\n- B\n- C', { skipLines: new Set([2]) })
    expect(edgeList(project, project.rootProcessId)).toEqual(['A -> C', 'Alku -> A', 'C -> Loppu'])
  })

  it('ei muuta annettua projektia', () => {
    const p = createProject()
    const before = JSON.stringify(p)
    planText(p, EXAMPLE, { processId: p.rootProcessId })
    expect(JSON.stringify(p)).toBe(before)
  })

  it('tyhjä teksti ei tuota mitään', () => {
    const { plan } = apply(createProject(), '   \n// vain kommentti')
    expect(plan.ops).toEqual([])
    expect(findEntity(plan.after, 'role', 'x')).toBeUndefined()
  })

  it('päätöksen nimeämättömät haarat saavat Kyllä/Ei-nimet', () => {
    const { project } = apply(createProject(), '? Q\n  - X\n  - Y')
    const edges = edgeList(project, project.rootProcessId)
    expect(edges).toContain('Q -[Kyllä]-> X')
    expect(edges).toContain('Q -[Ei]-> Y')
  })

  it('varoittaa vaiheesta, joka tulee ketjun päättäneen rivin jälkeen, mutta ei erottimen jälkeen', () => {
    const a = apply(createProject(), '- A\nloppu\n- Orpo')
    expect(a.plan.issues.some((i) => i.line === 3 && /ei saa yhteyttä/.test(i.message))).toBe(true)
    const b = apply(createProject(), '- A\nloppu\n---\n- Orpo')
    expect(b.plan.issues.filter((i) => /ei saa yhteyttä/.test(i.message))).toEqual([])
    // Varoitus ei estä lisäämistä
    expect(a.plan.hasErrors).toBe(false)
  })

  it('päätöksen jälkeinen vaihe saa yhteyden, vaikka vain yksi haara jatkaa', () => {
    const { plan } = apply(createProject(), '? Q\n  a: loppu\n  b: jatka\n- Jatko')
    expect(plan.issues.filter((i) => /ei saa yhteyttä/.test(i.message))).toEqual([])
  })
})

describe('nimenmuutos ja poistot (tekoälyn muokkaama teksti)', () => {
  const base = () =>
    apply(createProject(), '- Vastaanota lasku @Talous\n- Tarkista lasku\n- Maksa lasku').project

  it('(aiemmin: ...) nimeää vaiheen uudelleen ja säilyttää roolin ja yhteydet', () => {
    const p = base()
    const id = nodesOf(p, p.rootProcessId).find((n) => n.label === 'Vastaanota lasku')!.id
    const r = planText(
      p,
      '- Kirjaa lasku (aiemmin: Vastaanota lasku) @Talous\n- Tarkista lasku\n- Maksa lasku',
      {
        processId: p.rootProcessId,
      },
    )
    expect(r.after.nodes[id].label).toBe('Kirjaa lasku')
    expect(r.after.nodes[id].roleId).toBe(p.nodes[id].roleId)
    expect(Object.keys(r.after.nodes)).toHaveLength(Object.keys(p.nodes).length)
    expect(r.effects.map((e) => e.status)).toContain('renamed')
    // Uudelleen lisäys ei muuta mitään (idempotentti)
    const again = planText(
      r.after,
      '- Kirjaa lasku (aiemmin: Vastaanota lasku) @Talous\n- Tarkista lasku\n- Maksa lasku',
      {
        processId: p.rootProcessId,
      },
    )
    expect(again.ops).toEqual([])
  })

  it('removeMissing ehdottaa poistettavaksi vaiheet, joita tekstissä ei ole, ja siltaa aukon', () => {
    const p = base()
    const text = '- Vastaanota lasku\n- Maksa lasku'
    const dry = planText(p, text, { processId: p.rootProcessId })
    expect(dry.removals).toEqual([])
    const r = planText(p, text, { processId: p.rootProcessId, removeMissing: true })
    expect(r.removals.map((x) => x.label)).toEqual(['Tarkista lasku'])
    const labels = nodesOf(r.after, p.rootProcessId).map((n) => n.label)
    expect(labels).not.toContain('Tarkista lasku')
    expect(edgeList(r.after, p.rootProcessId)).toContain('Vastaanota lasku -> Maksa lasku')
  })

  it('käyttäjä voi säilyttää yksittäisen poistoehdotuksen', () => {
    const p = base()
    const id = nodesOf(p, p.rootProcessId).find((n) => n.label === 'Tarkista lasku')!.id
    const r = planText(p, '- Vastaanota lasku\n- Maksa lasku', {
      processId: p.rootProcessId,
      removeMissing: true,
      keepIds: new Set([id]),
    })
    expect(r.removals).toHaveLength(1)
    expect(nodesOf(r.after, p.rootProcessId).map((n) => n.label)).toContain('Tarkista lasku')
  })

  it('poistoja ei ehdoteta virheellisestä tekstistä eikä liitoskohdan kanssa', () => {
    const p = base()
    const anchor = nodesOf(p, p.rootProcessId)[0].id
    expect(
      planText(p, '- Maksa lasku', {
        processId: p.rootProcessId,
        removeMissing: true,
        anchorNodeId: anchor,
      }).removals,
    ).toEqual([])
    expect(
      planText(p, '? \n- Maksa lasku', { processId: p.rootProcessId, removeMissing: true })
        .removals,
    ).toEqual([])
  })

  it('vanhaan nimeen viittaava hyppy löytää uudelleennimetyn vaiheen', () => {
    const p = apply(
      createProject(),
      '- Tarkista lasku\n? Ok\n  kyllä: jatka\n  ei: -> Tarkista lasku',
    ).project
    const r = planText(
      p,
      '- Tarkasta lasku (aiemmin: Tarkista lasku)\n? Ok\n  kyllä: jatka\n  ei: -> Tarkista lasku',
      { processId: p.rootProcessId },
    )
    expect(r.hasErrors).toBe(false)
  })
})
