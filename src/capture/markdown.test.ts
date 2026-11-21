import { describe, expect, it } from 'vitest'
import { createProject } from '../model/factory'
import { looksLikeMarkdown, markdownToDsl, maskMarkdown, stripInline } from './markdown'
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
    expect(r.notes.join(' ')).toMatch(/Taulukot/)
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
