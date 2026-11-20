import { beforeEach, describe, expect, it } from 'vitest'
import { createEntity, createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { edgesOf } from '../model/selectors'
import { validateProject } from '../model/validate'
import { planText } from './plan'
import { ruleExtractor } from './suggest'
import { suggestionsToDsl } from './suggestToText'

beforeEach(() => useDeterministicIds(true))

const TEXT =
  'Ostolasku saapuu ostoreskontraan. Ostoreskontra tarkistaa laskun tiedot ERP-järjestelmästä. ' +
  'Jos tiedot eivät täsmää, laskuttajalle lähetetään korjauspyyntö. Muussa tapauksessa lasku lähetetään esimiehelle hyväksyttäväksi. ' +
  'Esimies hyväksyy laskun. Lopuksi lasku kirjataan.'

function setup() {
  let p = createProject()
  p = applyOperations(p, [
    { type: 'addEntity', entity: createEntity('role', 'Ostoreskontra') },
    { type: 'addEntity', entity: createEntity('role', 'Esimies') },
    { type: 'addEntity', entity: createEntity('system', 'ERP') },
    {
      type: 'addSource',
      source: { id: 'src1', title: 'Kuvaus', kind: 'document', text: TEXT, addedAt: 1 },
    },
  ])
  return p
}

describe('suggestionsToDsl', () => {
  it('muodostaa päätösblokin haaroineen ja viitteet jokaiselle riville', () => {
    const p = setup()
    const s = ruleExtractor.suggest(p, 'src1', TEXT)
    const { text, lineRefs } = suggestionsToDsl(p, s, 'src1')
    expect(text.split('\n')).toEqual([
      '- Ostolasku saapuu ostoreskontraan',
      '- Ostoreskontra tarkistaa laskun tiedot ERP-järjestelmästä @Ostoreskontra [ERP]',
      '? Tiedot eivät täsmää?',
      '  kyllä: Laskuttajalle lähetetään korjauspyyntö',
      '  ei: Lasku lähetetään esimiehelle hyväksyttäväksi',
      '- Esimies hyväksyy laskun @Esimies',
      '- Lasku kirjataan',
    ])
    expect(lineRefs.size).toBe(7)
    for (const ref of lineRefs.values()) expect(TEXT.slice(ref.start, ref.end)).toBe(ref.quote)
  })

  it('lisäys planneriin tuottaa oikean rakenteen ja viitteet lähteeseen', () => {
    const p = setup()
    const s = ruleExtractor.suggest(p, 'src1', TEXT)
    const { text, lineRefs } = suggestionsToDsl(p, s, 'src1')
    const plan = planText(p, text, { processId: p.rootProcessId, lineRefs })
    expect(plan.hasErrors).toBe(false)
    const after = applyOperations(p, plan.ops)
    expect(validateProject(after)).toEqual([])
    const edges = edgesOf(after, p.rootProcessId).map(
      (e) =>
        `${after.nodes[e.from].label}${e.label ? ` -[${e.label}]->` : ' ->'} ${after.nodes[e.to].label}`,
    )
    expect(edges).toContain(
      'Tiedot eivät täsmää? -[kyllä]-> Laskuttajalle lähetetään korjauspyyntö',
    )
    expect(edges).toContain(
      'Tiedot eivät täsmää? -[ei]-> Lasku lähetetään esimiehelle hyväksyttäväksi',
    )
    // molemmat haarat jatkuvat samaan seuraavaan vaiheeseen
    expect(edges).toContain('Laskuttajalle lähetetään korjauspyyntö -> Esimies hyväksyy laskun')
    expect(edges).toContain(
      'Lasku lähetetään esimiehelle hyväksyttäväksi -> Esimies hyväksyy laskun',
    )
    const node = Object.values(after.nodes).find((n) => n.label === 'Esimies hyväksyy laskun')!
    expect(node.sources[0].sourceId).toBe('src1')
    expect(TEXT.slice(node.sources[0].start, node.sources[0].end)).toBe('Esimies hyväksyy laskun.')
    expect(after.sources.src1.text).toBe(TEXT) // ei uutta lähdettä
    expect(Object.keys(after.sources)).toEqual(['src1'])
  })

  it('päätös ilman ei-haaraa saa jatka-haaran', () => {
    const p = setup()
    const only = 'Jos summa on suuri, tilaus tarkistetaan erikseen.'
    const s = ruleExtractor.suggest(p, 'src1', only)
    expect(suggestionsToDsl(p, s, 'src1').text).toBe(
      '? Summa on suuri?\n  kyllä: Tilaus tarkistetaan erikseen\n  ei: jatka',
    )
  })

  it('siivoaa nimistä syntaksimerkit', () => {
    const p = setup()
    const fake = [
      {
        id: 'x',
        kind: 'step' as const,
        start: 0,
        end: 3,
        quote: 'abc',
        label: '- @Hei [x] > y ~z',
        systemIds: [],
        score: 3,
        reasons: [],
      },
    ]
    const { text } = suggestionsToDsl(p, fake, 'src1')
    expect(text).toBe('- Hei x y z')
  })
})
