import { beforeEach, describe, expect, it } from 'vitest'
import { createEntity, createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import type { Project } from '../model/types'
import { findMentions, stemPattern } from './mentions'
import { extractTiming, ruleExtractor } from './suggest'
import { capitalize, normalizeText, splitSentences, truncate } from './text'

beforeEach(() => useDeterministicIds(true))

function projectWith(
  entities: [import('../model/types').EntityKind, string, string[]?][],
): Project {
  const p = createProject()
  return applyOperations(
    p,
    entities.map(([k, n, a]) => ({
      type: 'addEntity' as const,
      entity: createEntity(k, n, a ?? []),
    })),
  )
}

describe('splitSentences', () => {
  it('pilkkoo kappaleen lauseiksi ja säilyttää sijainnit', () => {
    const text = 'Lasku saapuu. Sen jälkeen se tarkistetaan! Hyväksytäänkö se?'
    const s = splitSentences(text)
    expect(s.map((x) => x.text)).toEqual([
      'Lasku saapuu.',
      'Sen jälkeen se tarkistetaan!',
      'Hyväksytäänkö se?',
    ])
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text)
  })

  it('ei katkaise lyhenteiden, kellonaikojen tai päivämäärien kohdalta', () => {
    const s = splitSentences(
      'Tarkista esim. summa klo 12.30 mennessä. Päivämäärä on 1.5.2024 ja se kirjataan. Valmis.',
    )
    expect(s.map((x) => x.text)).toEqual([
      'Tarkista esim. summa klo 12.30 mennessä.',
      'Päivämäärä on 1.5.2024 ja se kirjataan.',
      'Valmis.',
    ])
  })

  it('yhdistää kovalla rivinvaihdolla katkotut rivit ja erottaa luettelokohdat', () => {
    const text =
      'Lasku tarkis-\ntetaan ja kirjataan\nERP:hen. Seuraavaksi:\n- Hyväksy lasku\n2) Maksa lasku\n\nUusi kappale.'
    const s = splitSentences(text)
    expect(s.map((x) => [x.listItem, x.text.replace(/\s+/g, ' ')])).toEqual([
      [false, 'Lasku tarkis- tetaan ja kirjataan ERP:hen.'],
      [false, 'Seuraavaksi:'],
      [true, 'Hyväksy lasku'],
      [true, 'Maksa lasku'],
      [false, 'Uusi kappale.'],
    ])
  })

  it('tyhjä ja pelkkä tyhjä teksti', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('  \n\n ')).toEqual([])
  })
})

describe('tekstiapurit', () => {
  it('normalizeText yhtenäistää rivinvaihdot ja siivoaa', () => {
    expect(normalizeText('a\r\nb c  \n\n\n\nd\u0000')).toBe('a\nb c\n\nd')
  })
  it('capitalize ja truncate', () => {
    expect(capitalize('älä')).toBe('Älä')
    expect(truncate('lyhyt')).toBe('lyhyt')
    const long = truncate('sana '.repeat(40), 30)
    expect(long.length).toBeLessThanOrEqual(31)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('findMentions', () => {
  const p = projectWith([
    ['role', 'Myynti'],
    ['role', 'Esimies'],
    ['role', 'Ostoreskontra', ['reskontra']],
    ['system', 'ERP'],
    ['system', 'Sähköposti'],
  ])
  const name = (id: string) => p.entities[id].name

  it('tunnistaa taivutetut muodot ja aliakset', () => {
    const text =
      'Myynnin on ilmoitettava esimiehen hyväksynnästä. Ostoreskontralle ja reskontraan viedään ERP:hen sähköpostilla.'
    const found = findMentions(p, text).map((m) => [text.slice(m.start, m.end), name(m.entityId)])
    expect(found).toEqual([
      ['Myynnin', 'Myynti'],
      ['esimiehen', 'Esimies'],
      ['Ostoreskontralle', 'Ostoreskontra'],
      ['reskontraan', 'Ostoreskontra'],
      ['ERP', 'ERP'],
      ['sähköpostilla', 'Sähköposti'],
    ])
  })

  it('ei osu sanan keskelle eikä lyhyisiin sattumiin', () => {
    const text = 'Peruste ja ERPTA-koodi. Tämä on aivan toinen asia.'
    expect(findMentions(p, text)).toEqual([])
  })

  it('stemPattern käsittelee monisanaiset nimet', () => {
    const re = new RegExp(stemPattern('Ostoreskontra tiimi'), 'iu')
    expect(re.test('ostoreskontra tiimille')).toBe(true)
  })

  it('rajaa tyypin mukaan', () => {
    const roles = findMentions(p, 'Myynti ja ERP', ['role'])
    expect(roles).toHaveLength(1)
  })
})

describe('ruleExtractor', () => {
  const p = projectWith([
    ['role', 'Ostoreskontra'],
    ['role', 'Esimies'],
    ['system', 'ERP'],
  ])
  const TEXT = [
    'Ostolasku saapuu verkkolaskuoperaattorilta ostoreskontraan. Ostoreskontra tarkistaa laskun tiedot ERP-järjestelmästä.',
    'Jos tiedot eivät täsmää, laskuttajalle lähetetään korjauspyyntö. Muussa tapauksessa lasku lähetetään esimiehelle hyväksyttäväksi.',
    'Esimies hyväksyy laskun. Lopuksi lasku kirjataan ja viedään maksuun.',
  ].join(' ')

  const run = (text: string) => ruleExtractor.suggest(p, 'src_1', text)

  it('ehdottaa vaiheet, päätöksen ja haarat oikeassa järjestyksessä', () => {
    const s = run(TEXT)
    expect(s.map((x) => [x.kind, x.branch ?? '', x.label])).toEqual([
      ['step', '', 'Ostolasku saapuu verkkolaskuoperaattorilta ostoreskontraan'],
      ['step', '', 'Tarkistaa laskun tiedot ERP-järjestelmästä'],
      ['decision', '', 'Tiedot eivät täsmää?'],
      ['step', 'yes', 'Laskuttajalle lähetetään korjauspyyntö'],
      ['step', 'no', 'Lasku lähetetään esimiehelle hyväksyttäväksi'],
      ['step', '', 'Hyväksyy laskun'],
      ['step', '', 'Lasku kirjataan'],
      ['step', '', 'Viedään maksuun'],
    ])
  })

  it('ehdotusten sijainnit osoittavat alkuperäiseen tekstiin', () => {
    for (const s of run(TEXT)) {
      expect(TEXT.slice(s.start, s.end)).toBe(s.quote)
    }
    const decision = run(TEXT).find((x) => x.kind === 'decision')!
    expect(decision.quote).toBe('Jos tiedot eivät täsmää')
  })

  it('liittää roolit ja järjestelmät maininnoista', () => {
    const s = run(TEXT)
    const check = s.find((x) => x.label.startsWith('Tarkistaa laskun'))!
    expect(p.entities[check.roleId!].name).toBe('Ostoreskontra')
    expect(check.systemIds.map((i) => p.entities[i].name)).toEqual(['ERP'])
    const approve = s.find((x) => x.label.startsWith('Hyväksyy laskun'))!
    expect(p.entities[approve.roleId!].name).toBe('Esimies')
    expect(s.find((x) => x.kind === 'decision')!.roleId).toBeUndefined()
    expect(check.reasons.join(' ')).toMatch(/rooli: Ostoreskontra/)
  })

  it('luettelokohdat ovat vahvoja ehdokkaita ja järjestyssanat poistetaan nimestä', () => {
    const s = run(
      'Prosessi:\n1. Vastaanota tilaus\n2) Sitten tarkista luotto\n- Lopuksi lähetä vahvistus',
    )
    expect(s.map((x) => x.label)).toEqual([
      'Vastaanota tilaus',
      'Tarkista luotto',
      'Lähetä vahvistus',
    ])
    expect(s.every((x) => x.score >= 3)).toBe(true)
  })

  it('kysymyslause ehdotetaan päätökseksi', () => {
    const s = run('Onko summa yli 1000 euroa?')
    expect(s).toHaveLength(1)
    expect(s[0].kind).toBe('decision')
    expect(s[0].label).toBe('Onko summa yli 1000 euroa?')
  })

  it('ei ehdota yleistä tekstiä eikä sekoita "luo"-vartaloa sanaan luottoraja', () => {
    expect(run('Tämä on yleinen kuvaus yrityksestä ja sen historiasta.')).toEqual([])
    const s = run('Luottoraja on tärkeä käsite yrityksessä.')
    expect(s.filter((x) => x.reasons.includes('toimintaverbi'))).toEqual([])
  })

  it('antaa uniikit tunnisteet ja käsittelee tyhjän tekstin', () => {
    const s = run(TEXT)
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length)
    expect(run('')).toEqual([])
  })

  it('pitkä lause saa heikomman pistemäärän', () => {
    const long = `${'Tarkista asiat '.repeat(20)}lopuksi.`
    const short = 'Tarkista kaikki asiat.'
    expect(run(short)[0].score).toBeGreaterThan(run(long)[0]?.score ?? -99)
  })
})

describe('aikailmaisut, toistuvuus ja kipupisteet', () => {
  const p = createProject()
  const run = (text: string) => ruleExtractor.suggest(p, 's', text)

  it('tunnistaa työajan ja odotusajan', () => {
    expect(extractTiming('Esimies tarkistaa laskun noin 2 tunnissa').duration).toEqual({
      typical: 120,
    })
    expect(extractTiming('Esimies tarkistaa laskun 2 tuntia').duration).toEqual({ typical: 120 })
    expect(extractTiming('Talous käsittelee laskun kahden päivän kuluessa').waiting).toEqual({
      typical: 960,
    })
    expect(extractTiming('Tulokset toimitetaan viikon kuluessa').waiting).toEqual({ typical: 2400 })
    expect(extractTiming('Raportti tehdään 30 min').duration).toEqual({ typical: 30 })
    expect(extractTiming('Käsittele lasku')).toEqual({})
  })

  it('tunnistaa toistuvuuden', () => {
    expect(extractTiming('Talous ajaa raportin viikoittain').frequency).toBe('viikoittain')
    expect(extractTiming('Tarkistus tehdään kerran kuussa').frequency).toBe('kerran kuussa')
  })

  it('liittää ongelmalauseen edelliseen vaiheeseen kipupisteeksi', () => {
    const s = run(
      'Esimies hyväksyy laskun. Hyväksyntä viivästyy usein, koska esimies on matkoilla. HR lähettää kutsun.',
    )
    const steps = s.filter((x) => x.kind === 'step')
    expect(steps).toHaveLength(2)
    expect(steps[0].pains).toEqual([
      { text: 'Hyväksyntä viivästyy usein, koska esimies on matkoilla', severity: 3 },
    ])
    expect(steps[1].pains).toBeUndefined()
  })

  it('vaiheen omassa lauseessa oleva ongelma liittyy samaan vaiheeseen', () => {
    const s = run('Talous tarkistaa laskun käsin, mikä on hidasta.')
    expect(s[0].pains?.[0].severity).toBe(2)
  })

  it('ehdotukset siirtyvät pikasyötteen merkinnöiksi', async () => {
    const { suggestionsToDsl } = await import('./suggestToText')
    const s = run('Talous käsittelee laskun kahden päivän kuluessa. Käsittely viivästyy usein.')
    const dsl = suggestionsToDsl(p, s, 's').text
    expect(dsl).toContain('^2 pv')
    expect(dsl).toContain('!3 Käsittely viivästyy usein')
  })
})
