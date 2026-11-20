import { describe, expect, it } from 'vitest'
import { extractAnnotations, parseSyntax, walkItems } from './syntax'

describe('extractAnnotations', () => {
  it('poimii rooli, järjestelmät, syötteet, tuotokset ja varmuuden', () => {
    const r = extractAnnotations(
      'Tarkista lasku @Talous [ERP, Sähköposti] < Ostolasku, Ostotilaus > Tarkistettu lasku ~arvaus',
    )
    expect(r.label).toBe('Tarkista lasku')
    expect(r.ann).toEqual({
      role: 'Talous',
      systems: ['ERP', 'Sähköposti'],
      inputs: ['Ostolasku', 'Ostotilaus'],
      outputs: ['Tarkistettu lasku'],
      confidence: 'guess',
    })
  })

  it('tukee monisanaista roolia kolmella tavalla', () => {
    expect(extractAnnotations('A @(Ostoreskontra tiimi)').ann.role).toBe('Ostoreskontra tiimi')
    expect(extractAnnotations('A @"Ostoreskontra tiimi"').ann.role).toBe('Ostoreskontra tiimi')
    expect(extractAnnotations('A @Ostoreskontra_tiimi').ann.role).toBe('Ostoreskontra tiimi')
  })

  it('ei tulkitse vertailumerkkejä tuotokseksi ilman välilyöntejä tai päätöksellä', () => {
    expect(extractAnnotations('Summa>1000').label).toBe('Summa>1000')
    const d = extractAnnotations('Summa > 1000 €', { io: false })
    expect(d.label).toBe('Summa > 1000 €')
    expect(d.ann.outputs).toEqual([])
  })

  it('hyväksyy varmuuden eri kirjoitusasuilla ja jättää tuntemattoman ~sanan nimeen', () => {
    expect(extractAnnotations('A ~Todennäköinen').ann.confidence).toBe('likely')
    expect(extractAnnotations('A ~vahvistettu').ann.confidence).toBe('confirmed')
    expect(extractAnnotations('A ~ihme').label).toBe('A ~ihme')
  })

  it('varoittaa useasta roolista', () => {
    const r = extractAnnotations('A @Myynti @Talous')
    expect(r.ann.role).toBe('Myynti')
    expect(r.warnings).toHaveLength(1)
  })
})

describe('parseSyntax', () => {
  it('jäsentää otsikon, vaiheet ja eri listamerkit', () => {
    const r = parseSyntax('# Tilaus\n- Yksi\n* Kaksi\n1. Kolme\n2) Neljä\nViisi')
    expect(r.title).toBe('Tilaus')
    expect(r.items.map((i) => i.label)).toEqual(['Yksi', 'Kaksi', 'Kolme', 'Neljä', 'Viisi'])
    expect(r.issues).toEqual([])
  })

  it('tallentaa rivien sijainnit alkuperäiseen tekstiin', () => {
    const text = 'A\n  - Vaihe @R\nB'
    const r = parseSyntax(text)
    const item = r.items[0].children[0]
    expect(item).toBeUndefined()
    const second = r.items[0]
    expect(text.slice(second.start, second.end)).toBe('A')
    const nested = parseSyntax('- A\n  ? Q\n    ja: B').items[0]
    // vaiheen alle sisennetty rivi on kuvausta, ei lapsi
    expect(nested.notes).toEqual(['? Q', 'ja: B'])
  })

  it('jäsentää päätöksen haarat eri muodoissa', () => {
    const text = [
      '? Ylittyykö raja',
      '  kyllä: Pyydä ennakkomaksu @Talous',
      '  ei: jatka',
      '? Toinen',
      '  a: loppu',
      '  b: -> Alku',
      '  c:',
      '    - X',
      '    - Y',
    ].join('\n')
    const r = parseSyntax(text)
    expect(r.issues).toEqual([])
    const [d1, d2] = r.items
    expect(d1.kind).toBe('decision')
    expect(d1.branches.map((b) => b.label)).toEqual(['kyllä', 'ei'])
    expect(d1.branches[0].body[0].label).toBe('Pyydä ennakkomaksu')
    expect(d1.branches[0].body[0].ann.role).toBe('Talous')
    expect(d1.branches[1].jump).toBe('continue')
    expect(d2.branches[0].jump).toBe('end')
    expect(d2.branches[1].jump).toEqual({ goto: 'Alku' })
    expect(d2.branches[2].body.map((i) => i.label)).toEqual(['X', 'Y'])
  })

  it('inline-haaran sisennetyt rivit jatkavat haaran runkoa', () => {
    const r = parseSyntax('? Q\n  kyllä: Eka\n    - Toka\n    - Kolmas')
    expect(r.items[0].branches[0].body.map((i) => i.label)).toEqual(['Eka', 'Toka', 'Kolmas'])
  })

  it('haara voi sisältää sisäkkäisen päätöksen', () => {
    const r = parseSyntax('? A\n  kyllä: ? B\n    x: Eka\n    y: Toka\n  ei: jatka')
    const inner = r.items[0].branches[0].body[0]
    expect(inner.kind).toBe('decision')
    expect(inner.branches.map((b) => b.label)).toEqual(['x', 'y'])
  })

  it('alaprosessin sisältö on sisennettynä', () => {
    const r = parseSyntax('+ Hyväksyntä @Esimies\n  - Lähetä\n  - Päätä\n- Jatko')
    expect(r.items).toHaveLength(2)
    expect(r.items[0].kind).toBe('subprocess')
    expect(r.items[0].children.map((i) => i.label)).toEqual(['Lähetä', 'Päätä'])
    expect(r.items[0].ann.role).toBe('Esimies')
  })

  it('tunnistaa alku, loppu ja hypyn', () => {
    const r = parseSyntax('alku\n- A\n-> A\nloppu')
    expect(r.items.map((i) => [i.kind, i.label])).toEqual([
      ['start', 'Alku'],
      ['step', 'A'],
      ['goto', 'A'],
      ['end', 'Loppu'],
    ])
  })

  it('tukee nimettyä alkua ja loppua sekä erotinta', () => {
    const r = parseSyntax('alku: Lasku saapuu\n- A\n---\nloppu: Lasku maksettu')
    expect(r.items.map((i) => [i.kind, i.label])).toEqual([
      ['start', 'Lasku saapuu'],
      ['step', 'A'],
      ['break', ''],
      ['end', 'Lasku maksettu'],
    ])
  })

  it('ohittaa tyhjät rivit ja kommentit, ja tukee CRLF-rivinvaihtoja ja tabeja', () => {
    const r = parseSyntax('// kommentti\r\n\r\n- A\r\n\t? B\r\n\t\tkyllä: C')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].notes).toEqual(['? B', 'kyllä: C'])
    expect(r.items[0].label).toBe('A')
  })

  it('raportoi virheet ja varoitukset rivinumeroilla', () => {
    const r = parseSyntax('- A\n? Q\n  yksi: X\n-> \n- @Rooli')
    const byLine = (n: number) => r.issues.filter((i) => i.line === n)
    expect(byLine(2).some((i) => /vain yksi haara/.test(i.message))).toBe(true)
    expect(byLine(4).some((i) => i.severity === 'error')).toBe(true)
    expect(byLine(5).some((i) => i.severity === 'error' && /Nimi puuttuu/.test(i.message))).toBe(
      true,
    )
  })

  it('nimeämätön haara saa varoituksen', () => {
    const r = parseSyntax('? Q\n  - Pelkkä vaihe')
    expect(r.items[0].branches[0].label).toBe('')
    expect(r.issues[0].severity).toBe('warning')
  })

  it('skipLines ohittaa rivin alipuineen', () => {
    const text = '- A\n? Q\n  kyllä: B\n  ei: C\n- D'
    const r = parseSyntax(text, { skipLines: new Set([2]) })
    expect(r.items.map((i) => i.label)).toEqual(['A', 'D'])
    const r2 = parseSyntax(text, { skipLines: new Set([3]) })
    expect(r2.items[1].branches.map((b) => b.label)).toEqual(['ei'])
  })

  it('walkItems käy läpi sisäkkäiset kohteet', () => {
    const r = parseSyntax('? Q\n  a: X\n  b:\n    - Y\n+ S\n  - Z')
    const names: string[] = []
    walkItems(r.items, (i) => names.push(i.label))
    expect(names).toEqual(['Q', 'X', 'Y', 'S', 'Z'])
  })
})
