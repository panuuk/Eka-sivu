import { describe, expect, it } from 'vitest'
import { cleanAiResponse, looksLikeAiResponse } from './aiResponse'
import { AI_EXAMPLE } from './aiPrompt'
import { parseSyntax } from './syntax'

const wrap = (s: string) =>
  `Tässä muistiinpanot pikasyötteen muodossa:\n\n\`\`\`\n${s}\n\`\`\`\n\nKerro, jos haluat muutoksia.`

describe('cleanAiResponse', () => {
  it('poimii koodilohkon ja poistaa johdannon ja loppuselityksen', () => {
    const r = cleanAiResponse(wrap(AI_EXAMPLE))
    expect(r.text).toBe(AI_EXAMPLE)
    expect(r.changed).toBe(true)
    expect(parseSyntax(r.text).issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('toimii koodilohkon kielimerkinnällä ja Gemini-tyylisellä tähtiluettelolla', () => {
    const r = cleanAiResponse('Hyvä!\n```text\n* Tarkista lasku **heti**\n* Maksa lasku\n```')
    expect(r.text).toBe('- Tarkista lasku heti\n- Maksa lasku')
  })

  it('ilman koodilohkoa poistaa johdannon ja loppukappaleen', () => {
    const r = cleanAiResponse(
      'Tässä prosessi:\n- Tarkista lasku @Esimies\n- Maksa lasku\n\nHaluatko, että tarkennan roolit?',
    )
    expect(r.text).toBe('- Tarkista lasku @Esimies\n- Maksa lasku')
    expect(r.notes.length).toBe(2)
  })

  it('ei kosketa Mermaid-lohkoa eikä puhdasta pikasyötettä', () => {
    const mermaid = '```mermaid\nflowchart TD\n  A --> B\n```'
    expect(cleanAiResponse(mermaid).text).toBe(mermaid)
    const clean = '- Tarkista lasku\n  perustelu tähän\n- Maksa lasku'
    const r = cleanAiResponse(clean)
    expect(r.text).toBe(clean)
    expect(r.changed).toBe(false)
  })

  it('sisennetty kuvaus loppuselityksen sijasta säilyy', () => {
    const t = '- Tarkista lasku\n\n  Tämä on kuvaus, ei loppuselitys.'
    expect(cleanAiResponse(t).text).toBe(t)
  })

  it('tabulaattorisisennys muutetaan välilyönneiksi', () => {
    expect(cleanAiResponse('```\n? Onko ok\n\tkyllä: jatka\n```').text).toBe(
      '? Onko ok\n  kyllä: jatka',
    )
  })
})

describe('looksLikeAiResponse', () => {
  it('tunnistaa chatbotin vastauksen mutta ei pikasyötettä tai proosaa', () => {
    expect(looksLikeAiResponse(wrap(AI_EXAMPLE))).toBe(true)
    expect(looksLikeAiResponse(AI_EXAMPLE)).toBe(false)
    expect(looksLikeAiResponse('Lasku saapuu. Esimies tarkistaa sen ja hyväksyy maksun.')).toBe(
      false,
    )
  })
})
