import { beforeEach, describe, expect, it } from 'vitest'
import { useDeterministicIds } from '../model/ids'
import { buildSampleProject } from '../model/sample'
import { analyze } from './analyze'
import { EMPTY_FILTER, filterActive, matchNodes, searchHits } from './search'

beforeEach(() => useDeterministicIds(true))

const labels = (
  p: ReturnType<typeof buildSampleProject>,
  f: Parameters<typeof matchNodes>[1],
  open?: Set<string>,
) =>
  matchNodes(p, f, open)
    .map((n) => n.label)
    .sort()

describe('haku ja suodatus', () => {
  const p = buildSampleProject()

  it('tyhjä suodatin ei ole aktiivinen ja palauttaa kaiken', () => {
    expect(filterActive(EMPTY_FILTER)).toBe(false)
    expect(filterActive({ text: '  ' })).toBe(false)
    expect(matchNodes(p, EMPTY_FILTER)).toHaveLength(Object.keys(p.nodes).length)
  })

  it('hakee nimestä kirjainkoosta ja välilyönneistä riippumatta', () => {
    // osittainen sana riittää (haku kirjoittaessa): "tarkista" osuu myös sanaan "tarkistajalle"
    expect(labels(p, { text: 'TARKISTA   laskun' })).toEqual([
      'Palauta laskun tarkistajalle',
      'Tarkista laskun tiedot',
    ])
    expect(labels(p, { text: 'tarkista laskun tied' })).toEqual(['Tarkista laskun tiedot'])
  })

  it('hakusanat yhdistetään JA-ehdolla ja ne voivat osua eri kenttiin', () => {
    // "reskontra" on roolissa, "ERP" järjestelmässä
    expect(labels(p, { text: 'ostoreskontra erp' })).toEqual([
      'Kirjaa ja vie maksuun',
      'Lähetä esimiehelle',
      'Tarkista laskun tiedot',
    ])
    expect(labels(p, { text: 'olematon sana' })).toEqual([])
  })

  it('suodattaa roolin, järjestelmän ja varmuuden mukaan ja yhdistää ehdot', () => {
    const esimies = Object.values(p.entities).find((e) => e.name === 'Esimies')!.id
    const erp = Object.values(p.entities).find((e) => e.name === 'ERP')!.id
    expect(labels(p, { text: '', roleId: esimies })).toEqual([
      'Esimies hyväksyy',
      'Hyväksyntäkierto',
      'Palauta laskun tarkistajalle',
    ])
    expect(labels(p, { text: '', systemId: erp })).toContain('Kirjaa ja vie maksuun')
    expect(labels(p, { text: '', roleId: esimies, confidence: 'guess' })).toEqual([
      'Esimies hyväksyy',
      'Palauta laskun tarkistajalle',
    ])
  })

  it('avoimet kysymykset -suodatin käyttää annettua joukkoa', () => {
    const open = new Set(analyze(p).perNode.keys())
    const res = matchNodes(p, { text: '', openOnly: true }, open)
    expect(res.length).toBeGreaterThan(0)
    expect(res.every((n) => open.has(n.id))).toBe(true)
    expect(matchNodes(p, { text: '', openOnly: true }, new Set())).toEqual([])
  })

  it('searchHits kertoo osumakentät ja ohittaa alku- ja loppupisteet', () => {
    const hits = searchHits(p, { text: 'ERP' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.where.includes('järjestelmä'))).toBe(true)
    expect(searchHits(p, { text: 'Lasku saapuu' })).toEqual([]) // alkupiste
    const byLabel = searchHits(p, { text: 'hyväksy' })
    expect(byLabel.some((h) => h.where.includes('nimi'))).toBe(true)
  })

  it('rajaa tulosten määrän', () => {
    expect(searchHits(p, { text: 'a' }, undefined, 3)).toHaveLength(3)
  })
})
