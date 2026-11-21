import { describe, expect, it } from 'vitest'
import { createProject } from '../model/factory'
import { looksLikeMarkdown, markdownToDsl, maskMarkdown, stripInline } from './markdown'
import { TARJOUSPROSESSI_TEKSTI } from './eval/tarjousprosessi'
import { planText } from './plan'
import { ruleExtractor } from './suggest'

const DOC = `# B2B-tarjousprosessi

Tämä dokumentti kuvaa tarjousprosessin.

\`\`\`mermaid
flowchart TD
  A[1. Vastaanotto ja kirjaaminen] --> B[2. Analysointi ja Go / No-Go]
  B -->|No-Go| C[Kohtelias kieltäytyminen]
  B -->|Go| D[3. Suunnittelu]
  D --> E[4. Hinnoittelu]
  E --> F[5. Tarkistus]
  F -->|Korjattavaa| D
  F -->|Hyväksytty| G[6. Lähettäminen]
\`\`\`

| Rooli | Keskeinen vastuu |
| :--- | :--- |
| **Myyjä** | Asiakasyhteys. |

## 1. Vastaanotto ja kirjaaminen
- **Tavoite:** Varmistaa, että tarjouspyyntö rekisteröidään.
- **Toimenpiteet:**
  Kirjaa myyntimahdollisuus CRM-järjestelmään.

## 2. Analysointi ja Go / No-Go
- **Tavoite:** Arvioida, onko tarjous järkevä.

## 3. Suunnittelu
- Kutsu koolle aloituskokous.
`

describe('looksLikeMarkdown', () => {
  it('tunnistaa Markdown-dokumentin mutta ei pikasyötettä', () => {
    expect(looksLikeMarkdown(DOC)).toBe(true)
    expect(looksLikeMarkdown('- Vastaanota tilaus @Myynti\n? Onko ok\n  kyllä: jatka')).toBe(false)
    expect(looksLikeMarkdown('Lasku saapuu. Esimies tarkistaa sen.')).toBe(false)
  })
})

describe('stripInline', () => {
  it('poistaa lihavoinnit, koodimerkit ja linkkien osoitteet', () => {
    expect(stripInline('**Tavoite:** tee `x` ja [lue](http://a.b)')).toBe('Tavoite: tee x ja lue')
  })
})

describe('maskMarkdown', () => {
  it('säilyttää pituuden ja rivit mutta peittää koodin, taulukot ja lihavoinnin', () => {
    const m = maskMarkdown(DOC)
    expect(m.length).toBe(DOC.length)
    expect(m.split('\n')).toHaveLength(DOC.split('\n').length)
    expect(m).not.toContain('flowchart')
    expect(m).not.toContain('|')
    expect(m).not.toContain('**')
    expect(m).toContain('Tavoite:')
  })
})

describe('markdownToDsl', () => {
  it('lukee kulun Mermaid-kaaviosta ja liittää otsikoiden sisällön vaiheiden kuvaukseksi', () => {
    const r = markdownToDsl(DOC)
    expect(r.fromDiagram).toBe(true)
    expect(r.dsl).toContain('# B2B-tarjousprosessi')
    expect(r.dsl).toContain('- Vastaanotto ja kirjaaminen')
    expect(r.dsl).not.toMatch(/1\. Vastaanotto/)
    expect(r.dsl).toMatch(/Varmistaa, että tarjouspyyntö rekisteröidään/)
    expect(r.dsl).not.toContain('**')
    expect(r.dsl).not.toContain('mermaid')
    expect(r.dsl).toContain(':rooli Myyjä: Asiakasyhteys.')
    expect(r.dsl).toContain(':tarkoitus Tämä dokumentti kuvaa tarjousprosessin.')
  })

  it('tulos on jäsennettävissä: haarat ja paluu säilyvät, eikä jäsennys anna virheitä', () => {
    const { dsl } = markdownToDsl(DOC)
    const p = createProject()
    const plan = planText(p, dsl, { processId: p.rootProcessId, mode: 'append' } as never)
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
    const labels = plan.effects.map((e) => e.text)
    expect(labels.length).toBeGreaterThan(4)
    expect(dsl).toMatch(/\? /)
    expect(dsl).toMatch(/-> /)
  })

  it('ilman kaaviota otsikot ovat vaiheita ja sisältö kuvaus', () => {
    const md = DOC.replace(/```mermaid[\s\S]*?```/, '')
    const r = markdownToDsl(md)
    expect(r.fromDiagram).toBe(false)
    const lines = r.dsl.split('\n')
    expect(lines).toContain('- Vastaanotto ja kirjaaminen')
    expect(lines).toContain('- Suunnittelu')
    expect(lines).toContain('  Tavoite: Varmistaa, että tarjouspyyntö rekisteröidään.')
    expect(r.steps).toBe(3)
  })

  it('toimii myös, kun rivien edessä on luettelomerkit (pikasyötteestä viety teksti)', () => {
    const exported = [
      '# Päätason prosessi',
      '- ```mermaid',
      '- flowchart TD',
      '  A[1. Alku] --> B[2. Loppu]',
      '- ```',
    ].join('\n')
    const r = markdownToDsl(exported)
    expect(r.fromDiagram).toBe(true)
    expect(r.dsl).toContain('- Alku')
  })

  it('ilman otsikoita luettelon ylin taso on vaiheita ja sisennetty kuvausta', () => {
    const r = markdownToDsl(
      '- **Kirjaa tilaus** CRM:ään\n  - tarkista liitteet\n- Lähetä vahvistus',
    )
    expect(r.dsl.split('\n')).toEqual([
      '- Kirjaa tilaus CRM:ään',
      '  tarkista liitteet',
      '- Lähetä vahvistus',
    ])
  })
})

describe('ehdotusmoottori ja Markdown', () => {
  it('ei ehdota koodilohkon, taulukon tai otsikkomerkintöjen sisältöä vaiheiksi', () => {
    const s = ruleExtractor.suggest(createProject(), 's', DOC)
    const labels = s.map((x) => (x as { label: string }).label)
    for (const l of labels) expect(l).not.toMatch(/mermaid|flowchart|\||\*\*/i)
    for (const x of s) expect(DOC.slice(x.start, x.end)).toBe(x.quote)
  })
})

const FULL = `# Tarjousprosessi

Tämä dokumentti kuvaa B2B-tarjousprosessin vastaanotosta lähettämiseen.

\`\`\`mermaid
flowchart TD
  A[1. Vastaanotto] --> B[2. Laadinta]
  B --> C[3. Tarkistus]
\`\`\`

## Roolit ja vastuut

| Rooli | Keskeinen vastuu |
| :--- | :--- |
| **Myyjä** | Asiakasyhteys ja lähettäminen |
| **Tarjouspäällikkö** | Aikataulu ja kokoaminen |

## RACI

| Vaihe | R | A | C | I |
| --- | --- | --- | --- | --- |
| Vastaanotto | Myyjä | Tarjouspäällikkö | | Johto |
| Laadinta | Tarjouspäällikkö | Johto | Myyjä, Juridiikka | |

### 1. Vastaanotto
- **Tavoite:** Varmistaa, että pyyntö kirjataan.
- **Syöte:** Tarjouspyyntö ja liitteet
- **Tuotos:** CRM-kirjaus, kansiorakenne ja vastuuhenkilö
- **Työaika:** 30 min
- **Toimenpiteet:**
  Kirjaa myyntimahdollisuus.
  Nimeä vastuuhenkilö.

### 2. Laadinta
- **Tavoite:** Tuottaa tarjous.
- **Odotus:** 2 pv

### 3. Tarkistus
- **Tarkistuslista:**
  Hinnat tarkistettu
  Ehdot tarkistettu

## Laadunvarmistus
- Kaikkiin vaatimuksiin on vastattu.
- Hyväksyntä on dokumentoitu.

## Mittarit
- **Läpimenoaika:** Aika vastaanotosta lähettämiseen.
- **Täsmällisyys:** Määräaikaan toimitettujen osuus.

## Riskit
- Määräaika ylittyy.
`

describe('dokumentin rakenne malliin (prosessikortti, roolit, RACI, kentät)', () => {
  it('kokonainen dokumentti tuottaa kortin, roolit, kentät ja tarkistuslistat ja jäsentyy virheittä', () => {
    const r = markdownToDsl(FULL)
    expect(r.fromDiagram).toBe(true)
    const lines = r.dsl.split('\n')
    expect(lines[0]).toBe('# Tarjousprosessi')
    for (const l of [
      ':tarkoitus Tämä dokumentti kuvaa B2B-tarjousprosessin vastaanotosta lähettämiseen.',
      ':tarkistus Kaikkiin vaatimuksiin on vastattu.',
      ':mittari Läpimenoaika: Aika vastaanotosta lähettämiseen.',
      ':riski Määräaika ylittyy.',
      ':rooli Myyjä: Asiakasyhteys ja lähettäminen',
    ])
      expect(lines).toContain(l)

    const p = createProject()
    const plan = planText(p, r.dsl, { processId: p.rootProcessId, mode: 'append' })
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
    const after = plan.after
    const nodes = Object.values(after.nodes)
    const rec = nodes.find((n) => n.label === 'Vastaanotto')!
    expect(after.entities[rec.roleId!].name).toBe('Myyjä')
    expect(rec.outputIds.map((id) => after.entities[id].name)).toEqual([
      'CRM-kirjaus',
      'kansiorakenne',
      'vastuuhenkilö',
    ])
    expect(rec.inputIds.map((id) => after.entities[id].name)).toEqual(['Tarjouspyyntö ja liitteet'])
    expect(rec.duration?.typical ?? rec.duration?.min).toBe(30)
    expect(rec.description).toContain('Tavoite: Varmistaa, että pyyntö kirjataan.')
    expect(rec.raci?.accountableIds?.map((id) => after.entities[id].name)).toEqual([
      'Tarjouspäällikkö',
    ])
    expect(rec.raci?.informedIds?.map((id) => after.entities[id].name)).toEqual(['Johto'])
    const laat = nodes.find((n) => n.label === 'Laadinta')!
    expect(laat.waiting?.typical ?? laat.waiting?.min).toBe(2 * 480)
    expect(laat.raci?.consultedIds?.map((id) => after.entities[id].name)).toEqual([
      'Myyjä',
      'Juridiikka',
    ])
    const tark = nodes.find((n) => n.label === 'Tarkistus')!
    expect(tark.checklist).toEqual(['Hinnat tarkistettu', 'Ehdot tarkistettu'])
    const proc = after.processes[after.rootProcessId]
    expect(proc.card?.checklist).toHaveLength(2)
    expect(proc.card?.metrics).toHaveLength(2)
    expect(
      after.entities[Object.keys(after.entities).find((id) => after.entities[id].name === 'Myyjä')!]
        .description,
    ).toBe('Asiakasyhteys ja lähettäminen')
  })

  it('ilman kaaviota otsikoiden kentät, prosessin yleisosiot ja RACI tulevat pikasyötteeseen', () => {
    const md = FULL.replace(/```mermaid[\s\S]*?```/, '')
    const r = markdownToDsl(md)
    expect(r.fromDiagram).toBe(false)
    const lines = r.dsl.split('\n')
    expect(lines).toContain(':tarkistus Hyväksyntä on dokumentoitu.')
    // Yleisosiot eivät ole vaiheita
    expect(r.dsl).not.toMatch(/^- (Roolit|RACI|Mittarit|Riskit|Laadunvarmistus)/m)
    const step = lines.find((l) => l.startsWith('- Vastaanotto'))!
    expect(step).toContain('@Myyjä')
    expect(step).toContain('< Tarjouspyyntö ja liitteet')
    expect(step).toContain('> CRM-kirjaus, kansiorakenne, vastuuhenkilö')
    expect(step).toContain('=30 min')
    expect(step).toContain('A@Tarjouspäällikkö')
    expect(step).toContain('I@Johto')
    expect(lines).toContain('  :tarkistus Hinnat tarkistettu')
    const p = createProject()
    const plan = planText(p, r.dsl, { processId: p.rootProcessId })
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
  })
})

describe('oikea, sotkuinen dokumentti', () => {
  it('tarjousprosessi muuntuu eheäksi prosessiksi ilman virheitä ja ilman Markdown-jätettä', () => {
    const r = markdownToDsl(TARJOUSPROSESSI_TEKSTI)
    expect(r.fromDiagram).toBe(true)
    expect(r.steps).toBeGreaterThanOrEqual(9)
    expect(r.dsl).not.toMatch(/mermaid|\*\*|\|/)
    expect(r.dsl).toMatch(/^:rooli Myyjä \/ Asiakkuusvastaava: /m)
    const p = createProject()
    const plan = planText(p, r.dsl, { processId: p.rootProcessId, mode: 'append' })
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([])
    const labels = Object.values(plan.after.nodes).map((n) => n.label)
    expect(labels).toContain('Analysointi ja Go / No-Go')
    expect(labels).toContain('Viimeistely ja lähettäminen')
    // Roolit ovat entiteettejä kuvauksineen
    const roles = Object.values(plan.after.entities).filter((e) => e.kind === 'role')
    expect(roles.length).toBeGreaterThanOrEqual(6)
    expect(roles.every((e) => !!e.description)).toBe(true)
  })
})
