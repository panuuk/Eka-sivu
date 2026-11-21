import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { applyOperations } from '../model/operations'
import { createProject } from '../model/factory'
import { nodesOf } from '../model/selectors'
import { planText } from './plan'
import {
  columnIndex,
  decodeTextBytes,
  detectDelimiter,
  detectMapping,
  excelDate,
  looksLikeHeader,
  parseDelimited,
  parseXlsx,
  tableToDsl,
} from './table'

describe('parseDelimited', () => {
  it('tunnistaa erottimen ja lainausmerkit', () => {
    const text =
      'Vaihe;Rooli;Kuvaus\r\n"Tarkista; lasku";Talous;"Rivi 1\nrivi 2"\r\nHyväksy;Esimies;"Sanoo ""ok"""\r\n'
    expect(detectDelimiter(text)).toBe(';')
    const t = parseDelimited(text)
    expect(t).toEqual([
      ['Vaihe', 'Rooli', 'Kuvaus'],
      ['Tarkista; lasku', 'Talous', 'Rivi 1 rivi 2'],
      ['Hyväksy', 'Esimies', 'Sanoo "ok"'],
    ])
  })

  it('tabulaattori (leikepöydän taulukko), BOM ja tyhjät rivit', () => {
    const t = parseDelimited('﻿Vaihe\tRooli\nA\tX\n\n\nB\tY\n')
    expect(t).toEqual([
      ['Vaihe', 'Rooli'],
      ['A', 'X'],
      ['B', 'Y'],
    ])
  })

  it('pilkku erottimena ja lainausmerkin sisällä oleva pilkku', () => {
    expect(parseDelimited('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ])
  })

  it('Windows-1252-koodattu CSV puretaan ääkkösineen', () => {
    // "Hyväksy;Päätös" Windows-1252:ssa: ä = 0xE4, ö = 0xF6
    const bytes = Uint8Array.from([
      0x48, 0x79, 0x76, 0xe4, 0x6b, 0x73, 0x79, 0x3b, 0x50, 0xe4, 0xe4, 0x74, 0xf6, 0x73,
    ])
    expect(decodeTextBytes(bytes)).toBe('Hyväksy;Päätös')
    expect(decodeTextBytes(new TextEncoder().encode('Päätös'))).toBe('Päätös')
  })
})

describe('parseXlsx', () => {
  async function makeXlsx(): Promise<ArrayBuffer> {
    const zip = new JSZip()
    zip.file(
      'xl/workbook.xml',
      '<workbook><sheets><sheet name="Prosessi &amp; vaiheet" sheetId="1" r:id="rId1"/><sheet name="Toinen" sheetId="2" r:id="rId2"/></sheets></workbook>',
    )
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    )
    zip.file(
      'xl/sharedStrings.xml',
      '<sst><si><t>Vaihe</t></si><si><t>Kesto</t></si><si><r><t>Tarkista</t></r><r><t xml:space="preserve"> lasku &amp; kuitti</t></r></si><si><t>Pvm</t></si></sst>',
    )
    zip.file(
      'xl/styles.xml',
      '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    )
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>2.5</v></c><c r="C3" t="inlineStr"><is><t>sisäinen</t></is></c><c r="D3" s="1"><v>45292</v></c></row>' +
        '<row r="4"><c r="A4" t="b"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    )
    zip.file(
      'xl/worksheets/sheet2.xml',
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>X</t></is></c></row></sheetData></worksheet>',
    )
    return zip.generateAsync({ type: 'arraybuffer' })
  }

  it('lukee jaetut ja sisäiset merkkijonot, luvut, päivämäärät ja tyhjät rivit', async () => {
    const wb = await parseXlsx(await makeXlsx())
    expect(wb.sheets.map((s) => s.name)).toEqual(['Prosessi & vaiheet', 'Toinen'])
    expect(wb.sheets[0].rows).toEqual([
      ['Vaihe', 'Kesto', '', 'Pvm'],
      ['Tarkista lasku & kuitti', '2.5', 'sisäinen', '2024-01-01'],
      ['tosi', '', '', ''],
    ])
    expect(wb.sheets[1].rows).toEqual([['X']])
  })

  it('hylkää tiedoston, joka ei ole työkirja', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'x')
    await expect(parseXlsx(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(
      /Excel/,
    )
  })

  it('apufunktiot', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('AB12')).toBe(27)
    expect(excelDate(45292)).toBe('2024-01-01')
  })
})

describe('sarakkeiden tunnistus', () => {
  it('tunnistaa suomalaiset ja englanninkieliset otsikot', () => {
    expect(
      detectMapping([
        'Työvaihe',
        'Vastuuhenkilö',
        'Järjestelmät',
        'Kesto',
        'Odotusaika',
        'Seuraava vaihe',
      ]),
    ).toEqual({
      step: 0,
      role: 1,
      systems: 2,
      duration: 3,
      waiting: 4,
      next: 5,
    })
    expect(detectMapping(['Task', 'Owner', 'Tools', 'Notes'])).toMatchObject({
      step: 0,
      role: 1,
      systems: 2,
      description: 3,
    })
  })
  it('otsikkorivin tunnistus', () => {
    expect(looksLikeHeader(['Vaihe', 'Rooli'])).toBe(true)
    expect(looksLikeHeader(['Tarkista lasku', 'Talous'])).toBe(false)
  })
})

describe('tableToDsl', () => {
  const rows = [
    [
      'Tarkista lasku',
      'Talous',
      'ERP; Sähköposti',
      'Lasku',
      'Tarkistettu lasku',
      '30 min',
      '1 pv',
      'arvaus',
      'Katso summat',
      '',
    ],
    ['Täsmääkö?', '', '', '', '', '', '', '', '', 'Kyllä: Hyväksy; Ei: Pyydä korjaus'],
    ['Hyväksy', 'Esimies', '', '', '', '2 h', '', 'vahvistettu', '', ''],
    ['Pyydä korjaus', 'Talous', '', '', '', '', '', '', '', ''],
  ]
  const mapping = detectMapping([
    'Vaihe',
    'Rooli',
    'Järjestelmät',
    'Syöte',
    'Tuotos',
    'Kesto',
    'Odotus',
    'Varmuus',
    'Kuvaus',
    'Seuraava',
  ])
  const withType = { ...mapping, type: 10 }

  it('muuntaa rivit pikasyötteen teksti ja se jäsentyy malliksi', () => {
    const data = rows.map((r, i) => [...r, i === 1 ? 'päätös' : 'vaihe'])
    const out = tableToDsl(data, withType)
    expect(out.steps).toBe(4)
    expect(out.text).toContain(
      '- Tarkista lasku @Talous [ERP, Sähköposti] < Lasku > Tarkistettu lasku =30 min ^1 pv ~arvaus',
    )
    expect(out.text).toContain('  Katso summat')
    expect(out.text).toContain('? Täsmääkö')
    expect(out.text).toContain('Kyllä: -> Hyväksy')

    const empty = createProject()
    const plan = planText(empty, out.text, { processId: empty.rootProcessId })
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
    const p = applyOperations(empty, plan.ops)
    const n = nodesOf(p, p.rootProcessId)
    expect(n.find((x) => x.label === 'Tarkista lasku')!.duration).toEqual({ typical: 30 })
    expect(n.find((x) => x.label === 'Tarkista lasku')!.waiting).toEqual({ typical: 480 })
    expect(n.find((x) => x.label === 'Hyväksy')!.confidence).toBe('confirmed')
    expect(n.some((x) => x.kind === 'decision')).toBe(true)
  })

  it('ryhmä-sarake tekee alaprosessin, ja virheelliset kestot varoitetaan mutta eivät estä', () => {
    const t = [
      ['Hakemus', 'Vastaanota', 'x'],
      ['Hakemus', 'Arvioi', ''],
      ['Valinta', 'Päätä', ''],
    ]
    const out = tableToDsl(t, { group: 0, step: 1, duration: 2 })
    expect(out.text.split('\n')).toEqual([
      '+ Hakemus',
      '  - Vastaanota',
      '  - Arvioi',
      '+ Valinta',
      '  - Päätä',
    ])
    expect(out.warnings.join(' ')).toContain('“x” ei ole kesto')
    const empty = createProject()
    const plan = planText(empty, out.text, { processId: empty.rootProcessId })
    const p = applyOperations(empty, plan.ops)
    expect(
      Object.values(p.nodes)
        .filter((x) => x.kind === 'subprocess')
        .map((x) => x.label),
    ).toEqual(['Hakemus', 'Valinta'])
  })

  it('solun sisältö ei tulkitse itseään merkinnäksi', () => {
    const out = tableToDsl([['- Hae @tiedot [x] ~arvaus', '=1 pv']], { step: 0 })
    expect(out.text).toBe('- Hae tiedot x arvaus')
  })

  it('Seuraava-viittaus peräkkäisestä poikkeavaan vaiheeseen tekee hypyn, tuntematon viittaus varoittaa', () => {
    const t = [
      ['A', 'C'],
      ['B', ''],
      ['C', 'Puuttuva'],
    ]
    const out = tableToDsl(t, { step: 0, next: 1 })
    expect(out.text).toContain('- A\n-> C\n---')
    expect(out.warnings.join(' ')).toContain('“Puuttuva” ei löydy')
  })

  it('ilman vaihe-saraketta varoitus ja tyhjä tulos', () => {
    const out = tableToDsl([['a']], {})
    expect(out.steps).toBe(0)
    expect(out.warnings.join(' ')).toContain('Valitse sarake')
  })
})
