import { describe, expect, it, vi } from 'vitest'
import { createEntity, createProject } from '../model/factory'
import { applyOperations } from '../model/operations'
import { suggestionsToDsl } from './suggestToText'
import {
  chunkText,
  extractJson,
  isLocalUrl,
  listModels,
  llmSuggest,
  LlmError,
  locateQuote,
  parseSteps,
  type LlmConfig,
} from './llm'

const config: LlmConfig = { baseUrl: 'http://localhost:11434/v1/', model: 'testimalli' }

const reply = (steps: unknown[], status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { choices: [{ message: { content: JSON.stringify({ steps }) } }] }
        : { error: { message: 'virhe' } },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  )

describe('isLocalUrl', () => {
  it.each([
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:1234/v1', true],
    ['http://[::1]:8080/v1', true],
    ['http://192.168.1.20:11434/v1', true],
    ['http://10.0.0.5/v1', true],
    ['http://172.20.0.2/v1', true],
    ['http://tietokone.local:11434/v1', true],
    ['https://api.openai.com/v1', false],
    ['http://172.40.0.2/v1', false],
    ['http://8.8.8.8/v1', false],
    ['ei osoite', false],
  ])('%s', (url, expected) => expect(isLocalUrl(url)).toBe(expected))
})

describe('chunkText', () => {
  const text = Array.from(
    { length: 40 },
    (_, i) => `Kappale ${i}. Esimies tarkistaa laskun numero ${i} ja hyväksyy sen.`,
  ).join('\n\n')

  it('palat jatkuvat katkeamatta ja ovat sallitun kokoisia', () => {
    const chunks = chunkText(text, 500)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.map((c) => c.text).join('')).toBe(text)
    let pos = 0
    for (const c of chunks) {
      expect(c.start).toBe(pos)
      expect(c.text).toBe(text.slice(c.start, c.end))
      expect(c.text.length).toBeLessThanOrEqual(750)
      pos = c.end
    }
  })

  it('lyhyt teksti on yksi pala, tyhjä ei yhtään, ja pitkä jatkumo katkaistaan', () => {
    expect(chunkText('Lyhyt teksti.')).toHaveLength(1)
    expect(chunkText('   ')).toHaveLength(0)
    const long = 'a'.repeat(7000)
    const chunks = chunkText(long, 2000)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(chunks.map((c) => c.text).join('')).toBe(long)
  })
})

describe('vastauksen jäsennys', () => {
  it('purkaa koodiaidat ja selitykset JSONin ympäriltä', () => {
    expect(extractJson('```json\n{"steps":[]}\n```')).toEqual({ steps: [] })
    expect(extractJson('Tässä: {"steps":[{"label":"A"}]} valmis')).toEqual({
      steps: [{ label: 'A' }],
    })
    expect(() => extractJson('ei jsonia')).toThrow(LlmError)
  })
  it('hyväksyy listan sellaisenaan ja hylkää muun', () => {
    expect(parseSteps('[{"label":"A","quote":"B"}]')).toHaveLength(1)
    expect(() => parseSteps('{"muu": 1}')).toThrow(/steps/)
  })
})

describe('locateQuote', () => {
  const text =
    'Ostoreskontra tarkistaa laskun. Esimies   hyväksyy laskun kahden päivän kuluessa. Lopuksi lasku kirjataan.'
  it('täsmällinen, väljä ja sanapäällekkäisyyteen perustuva haku', () => {
    expect(locateQuote(text, 'Esimies   hyväksyy laskun')).toEqual({ start: 32, end: 57 })
    const loose = locateQuote(text, 'esimies hyväksyy laskun')!
    expect(text.slice(loose.start, loose.end).toLowerCase()).toContain('esimies')
    // malli muotoili lainauksen hieman uudelleen
    const fuzzy = locateQuote(text, 'Esimies hyväksyy laskun kahden päivän sisällä')!
    expect(text.slice(fuzzy.start, fuzzy.end)).toContain('kahden päivän kuluessa')
    expect(locateQuote(text, 'Täysin keksitty lause jota ei ole')).toBeNull()
    expect(locateQuote(text, 'ab')).toBeNull()
  })
})

describe('llmSuggest', () => {
  const text =
    'Ostoreskontra tarkistaa laskun ERP-järjestelmästä. Jos tiedot eivät täsmää, laskuttajalle lähetetään korjauspyyntö. Esimies hyväksyy laskun kahden päivän kuluessa.'
  const project = applyOperations(createProject(), [
    { type: 'addEntity', entity: createEntity('role', 'Ostoreskontra') },
  ])

  it('muuntaa vastauksen ehdotuksiksi, joilla on oikea sijainti, rooli ja kesto', async () => {
    const fetchMock = vi.fn(async () =>
      reply([
        {
          kind: 'step',
          label: 'Tarkista lasku',
          quote: 'Ostoreskontra tarkistaa laskun ERP-järjestelmästä',
          role: 'Ostoreskontra',
          systems: ['ERP'],
          branch: 'none',
        },
        {
          kind: 'decision',
          label: 'Tiedot täsmäävät',
          quote: 'Jos tiedot eivät täsmää',
          branch: 'none',
        },
        {
          kind: 'step',
          label: 'Lähetä korjauspyyntö',
          quote: 'laskuttajalle lähetetään korjauspyyntö',
          branch: 'yes',
        },
        {
          kind: 'step',
          label: 'Hyväksy lasku',
          quote: 'Esimies hyväksyy laskun',
          role: 'Esimies',
          wait: '2 päivää',
          branch: 'none',
        },
        {
          kind: 'step',
          label: 'Keksitty vaihe',
          quote: 'Tätä ei ole tekstissä lainkaan',
          branch: 'none',
        },
      ]),
    )
    const r = await llmSuggest(
      project,
      'src1',
      text,
      config,
      {},
      fetchMock as unknown as typeof fetch,
    )
    expect(r.rejected).toBe(1)
    expect(r.suggestions.map((s) => s.label)).toEqual([
      'Tarkista lasku',
      'Tiedot täsmäävät?',
      'Lähetä korjauspyyntö',
      'Hyväksy lasku',
    ])
    for (const s of r.suggestions) expect(text.slice(s.start, s.end)).toBe(s.quote)
    const [check, dec, branch, approve] = r.suggestions
    expect(check.roleId).toBe(Object.values(project.entities)[0].id)
    expect(check.systemNames).toEqual(['ERP'])
    expect(dec.kind).toBe('decision')
    expect(branch.branch).toBe('yes')
    expect(approve.roleName).toBe('Esimies')
    expect(approve.waiting).toEqual({ typical: 960 })
    expect(approve.reasons).toEqual(['kielimalli'])
    // kutsu: osoite siistitty, skeema käytössä
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('testimalli')
    expect(body.response_format.type).toBe('json_schema')
  })

  it('ehdotukset kulkevat pikasyötteen tekstiksi nimillä, myös uusilla rooleilla', async () => {
    const fetchMock = vi.fn(async () =>
      reply([
        {
          kind: 'step',
          label: 'Hyväksy lasku',
          quote: 'Esimies hyväksyy laskun',
          role: 'Esimies',
          systems: ['ERP'],
          wait: '2 päivää',
        },
      ]),
    )
    const r = await llmSuggest(project, 's', text, config, {}, fetchMock as unknown as typeof fetch)
    const dsl = suggestionsToDsl(project, r.suggestions, 's').text
    expect(dsl).toBe('- Hyväksy lasku @Esimies [ERP] ^2 pv')
  })

  it('kevennä vastausmuotoa, jos palvelin ei tue skeemaa (400)', async () => {
    const modes: string[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      modes.push(body.response_format?.type ?? 'ei')
      if (body.response_format?.type === 'json_schema') return reply([], 400)
      return reply([{ kind: 'step', label: 'A', quote: 'Esimies hyväksyy laskun' }])
    })
    const r = await llmSuggest(project, 's', text, config, {}, fetchMock as unknown as typeof fetch)
    expect(modes).toEqual(['json_schema', 'json_object'])
    expect(r.suggestions).toHaveLength(1)
  })

  it('pitkä teksti jaetaan paloihin, edistyminen raportoidaan ja päällekkäiset poistetaan', async () => {
    const long = Array.from({ length: 160 }, (_, i) => `Esimies hyväksyy laskun numero ${i}.`).join(
      '\n\n',
    )
    const calls: number[] = []
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const userText = JSON.parse(String(init.body)).messages[1].content as string
      const m = /laskun numero (\d+)/.exec(userText)
      calls.push(1)
      return reply(
        m
          ? [
              {
                kind: 'step',
                label: `Hyväksy ${m[1]}`,
                quote: `Esimies hyväksyy laskun numero ${m[1]}`,
              },
            ]
          : [],
      )
    })
    const progress: [number, number][] = []
    const r = await llmSuggest(
      project,
      's',
      long,
      config,
      { onProgress: (d, t) => progress.push([d, t]) },
      fetchMock as unknown as typeof fetch,
    )
    expect(r.chunks).toBeGreaterThan(1)
    expect(calls.length).toBe(r.chunks)
    expect(progress.at(-1)).toEqual([r.chunks, r.chunks])
    for (const s of r.suggestions) expect(long.slice(s.start, s.end)).toBe(s.quote)
  })

  it('virhetilanteet: ei mallia, verkkovirhe ja peruutus', async () => {
    await expect(llmSuggest(project, 's', text, { ...config, model: '' })).rejects.toMatchObject({
      kind: 'config',
    })
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(
      llmSuggest(project, 's', text, config, {}, failing as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'network' })
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      llmSuggest(
        project,
        's',
        text,
        config,
        { signal: ctrl.signal },
        vi.fn() as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ kind: 'abort' })
    const bad = vi.fn(async () => new Response('en ole json', { status: 200 }))
    await expect(
      llmSuggest(project, 's', text, config, {}, bad as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'parse' })
  })
})

describe('listModels', () => {
  it('lukee OpenAI- ja Ollama-muotoiset luettelot ja neuvoo CORSin kanssa', async () => {
    const openai = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] })),
    )
    expect(await listModels('http://localhost:1/v1/', openai as unknown as typeof fetch)).toEqual([
      'a',
      'b',
    ])
    const ollama = vi.fn(
      async () => new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] })),
    )
    expect(await listModels('http://localhost:1/v1', ollama as unknown as typeof fetch)).toEqual([
      'llama3.2:3b',
    ])
    const down = vi.fn(async () => {
      throw new TypeError('x')
    })
    await expect(
      listModels('http://localhost:1/v1', down as unknown as typeof fetch),
    ).rejects.toThrow(/OLLAMA_ORIGINS/)
    const bad = vi.fn(async () => new Response('', { status: 500 }))
    await expect(
      listModels('http://localhost:1/v1', bad as unknown as typeof fetch),
    ).rejects.toThrow(/500/)
  })
})
