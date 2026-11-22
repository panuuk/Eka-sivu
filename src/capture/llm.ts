import { parseDuration } from '../model/duration'
import { normalizeName } from '../model/selectors'
import type { DurationRange, Project } from '../model/types'
import type { Suggestion } from './suggest'
import { collapse, truncate } from './text'

/**
 * Paikallinen kielimalli ehdotusten poimijana. Puhuu OpenAI-yhteensopivaa rajapintaa (Ollama
 * `/v1`, LM Studio, llama.cpp-palvelin), jonka käyttäjä ajaa omalla koneellaan. Mallin vastaus
 * kulkee saman hyväksynnän läpi kuin sääntöpohjaiset ehdotukset, ja jokaisen ehdotuksen on löydyttävä
 * lähdetekstistä, jotta lähdeviite säilyy.
 */

export interface LlmConfig {
  /** Esim. http://localhost:11434/v1 */
  baseUrl: string
  model: string
  temperature?: number
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'http://localhost:11434/v1',
  model: '',
  temperature: 0.1,
}

export class LlmError extends Error {
  constructor(
    message: string,
    public kind: 'network' | 'http' | 'parse' | 'abort' | 'config' = 'http',
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/** Onko osoite omalla koneella tai paikallisessa verkossa? Muulle osoitteelle teksti lähtisi ulos koneelta. */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.local'))
      return true
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
    if (!m) return false
    const [a, b] = [Number(m[1]), Number(m[2])]
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  } catch {
    return false
  }
}

const trimBase = (u: string) => u.trim().replace(/\/+$/, '')

type Fetch = typeof fetch

/** Hakee mallien nimet. Toimii yhteyskokeena: virheilmoitus kertaa yleisimmän syyn (CORS). */
export async function listModels(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  let res: Response
  try {
    res = await fetchImpl(`${trimBase(baseUrl)}/models`, { signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LlmError('Peruttu', 'abort')
    throw new LlmError(
      'Yhteys kielimalliin epäonnistui. Tarkista, että palvelin on käynnissä ja että se sallii selaimen pyynnöt (Ollamalla: OLLAMA_ORIGINS="*" tai tämän sivun osoite).',
      'network',
    )
  }
  if (!res.ok) throw new LlmError(`Palvelin vastasi virheellä ${res.status}`, 'http')
  const json = (await res.json().catch(() => null)) as {
    data?: { id: string }[]
    models?: { name: string }[]
  } | null
  const ids = json?.data?.map((m) => m.id) ?? json?.models?.map((m) => m.name) ?? []
  return ids.filter(Boolean).sort((a, b) => a.localeCompare(b))
}

// --- Tekstin pilkkominen ---

interface Chunk {
  start: number
  end: number
  text: string
}

const CHUNK_CHARS = 2500

/** Jakaa tekstin kappaleiden rajoilta enintään `max` merkin paloihin. Palojen sijainnit säilyvät. */
export function chunkText(text: string, max = CHUNK_CHARS): Chunk[] {
  const chunks: Chunk[] = []
  let start = 0
  const flush = (end: number) => {
    const raw = text.slice(start, end)
    if (raw.trim()) chunks.push({ start, end, text: raw })
    start = end
  }
  // Mahdolliset katkaisukohdat: kappaleen ja lauseen loppu
  const breaks: number[] = []
  const re = /\n\s*\n|(?<=[.!?])\s+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) breaks.push(m.index + m[0].length)
  breaks.push(text.length)
  let prev = 0
  for (const b of breaks) {
    // Pala täynnä: katkaise edelliseen taukoon, ja jos jatkumo on vieläkin liian pitkä, väkisin
    if (b - start > max && prev > start) flush(prev)
    while (b - start > max * 1.5) flush(start + max)
    prev = b
  }
  flush(text.length)
  return chunks
}

// --- Vastauksen jäsennys ---

interface RawStep {
  kind?: string
  label?: string
  quote?: string
  role?: string
  systems?: string[]
  branch?: string
  duration?: string
  wait?: string
}

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['step', 'decision'] },
          label: { type: 'string' },
          quote: { type: 'string' },
          role: { type: 'string' },
          systems: { type: 'array', items: { type: 'string' } },
          branch: { type: 'string', enum: ['yes', 'no', 'none'] },
          duration: { type: 'string' },
          wait: { type: 'string' },
        },
        required: ['kind', 'label', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['steps'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `Olet prosessianalyytikko. Poimi annetusta suomenkielisestä tekstistä prosessin vaiheet ja päätökset siinä järjestyksessä kuin ne tekstissä esiintyvät. Vastaa vain JSON-muodossa.

Säännöt:
- "label": lyhyt vaiheen nimi (esim. "Tarkista lasku"). Päätöksen nimi on kysymys (esim. "Ylittyykö raja?").
- "quote": TÄSMÄLLEEN tekstissä oleva lause tai sen osa, josta vaihe on poimittu. Älä muuta, käännä tai tiivistä sitä.
- "role": toimija, jos teksti mainitsee sen vaiheelle. Muuten tyhjä.
- "systems": tekstissä mainitut järjestelmät ja työkalut.
- "kind": "decision", kun teksti kuvaa ehtoa tai valintaa (jos, mikäli, onko). Päätöksen haarojen vaiheet merkitään "branch": "yes" (ehto toteutuu) tai "no" (ei toteudu). Muille "branch": "none".
- "duration" ja "wait": vain jos teksti mainitsee keston tai odotuksen (esim. "2 päivää").
- Yksi lause voi sisältää useita vaiheita: tee niistä erilliset vaiheet.
- Älä keksi mitään, mitä tekstissä ei ole. Jos tekstissä ei ole prosessin vaiheita, palauta {"steps": []}.`

/** Poimii JSON-olion vastauksesta, vaikka malli olisi lisännyt selitystä tai koodiaidat. */
export function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  const body = fenced ? fenced[1] : trimmed
  try {
    return JSON.parse(body)
  } catch {
    const a = body.indexOf('{')
    const b = body.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(body.slice(a, b + 1))
    throw new LlmError('Mallin vastaus ei ollut JSONia', 'parse')
  }
}

export function parseSteps(content: string): RawStep[] {
  const json = extractJson(content) as { steps?: unknown } | RawStep[]
  const list = Array.isArray(json) ? json : json?.steps
  if (!Array.isArray(list)) throw new LlmError('Mallin vastauksesta puuttuu “steps”-lista', 'parse')
  return list.filter((x): x is RawStep => !!x && typeof x === 'object')
}

// --- Sijainnin etsintä ---

const tokens = (s: string) =>
  new Set(
    normalizeName(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3)
      .map((t) => t.slice(0, 5)),
  )

/**
 * Löytää lainauksen paikan lähdetekstistä: ensin täsmällisesti, sitten välilyönneistä ja kirjainkoosta
 * riippumatta ja lopuksi lauseen sanojen päällekkäisyyden perusteella. Palauttaa null, jos mikään
 * kohta ei vastaa riittävästi (silloin ehdotus hylätään, koska lähdeviite ei olisi luotettava).
 */
export function locateQuote(
  text: string,
  quote: string,
  from = 0,
): { start: number; end: number } | null {
  const q = quote.trim()
  if (q.length < 3) return null
  const exact = text.indexOf(q, from)
  if (exact >= 0) return { start: exact, end: exact + q.length }
  const loose = text.indexOf(q)
  if (loose >= 0) return { start: loose, end: loose + q.length }
  // Välilyönneistä ja kirjainkoosta riippumaton haku
  const words = q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(words.join('\\s+'), 'iu')
  const m = re.exec(text)
  if (m) return { start: m.index, end: m.index + m[0].length }
  // Lauseen sanojen päällekkäisyys
  const want = tokens(q)
  if (want.size < 2) return null
  let best: { start: number; end: number; score: number } | null = null
  const sentenceRe = /[^.!?\n]+[.!?]?/g
  let s: RegExpExecArray | null
  while ((s = sentenceRe.exec(text))) {
    const have = tokens(s[0])
    let inter = 0
    for (const t of want) if (have.has(t)) inter++
    const score = inter / Math.max(want.size, 1)
    if (score >= 0.6 && (!best || score > best.score)) {
      const lead = s[0].length - s[0].trimStart().length
      best = { start: s.index + lead, end: s.index + s[0].trimEnd().length, score }
    }
  }
  return best
}

function durationOf(s: string | undefined): DurationRange | undefined {
  if (!s) return undefined
  return parseDuration(s.replace(/,/g, '.').trim()) ?? parseDuration(s.trim()) ?? undefined
}

/** Muuntaa mallin vastauksen ehdotuksiksi: sijainnit etsitään tekstistä, entiteetit yhdistetään nimillä. */
function stepsToSuggestions(
  project: Pick<Project, 'entities'>,
  sourceId: string,
  fullText: string,
  chunk: Chunk,
  steps: RawStep[],
): { suggestions: Suggestion[]; rejected: number } {
  const suggestions: Suggestion[] = []
  let rejected = 0
  let cursor = 0
  const byName = (kind: 'role' | 'system', name: string) =>
    Object.values(project.entities).find(
      (e) => e.kind === kind && normalizeName(e.name) === normalizeName(name),
    )
  for (const [i, st] of steps.entries()) {
    const label = collapse(String(st.label ?? '')).replace(/[.!?…:;,\s]+$/, '')
    const quote = String(st.quote ?? '')
    const loc = label && quote ? locateQuote(chunk.text, quote, cursor) : null
    if (!loc) {
      rejected++
      continue
    }
    cursor = loc.start
    const start = chunk.start + loc.start
    const end = chunk.start + loc.end
    const role = st.role?.trim() ? collapse(st.role) : undefined
    const roleEntity = role ? byName('role', role) : undefined
    const systemEntities: string[] = []
    const systemNames: string[] = []
    for (const sys of (st.systems ?? []).map((x) => collapse(String(x))).filter(Boolean)) {
      const e = byName('system', sys)
      if (e) systemEntities.push(e.id)
      else systemNames.push(sys)
    }
    const kind = st.kind === 'decision' ? 'decision' : 'step'
    suggestions.push({
      id: `${sourceId}:llm:${start}-${end}:${i}`,
      kind,
      start,
      end,
      quote: fullText.slice(start, end),
      label:
        kind === 'decision' && !label.endsWith('?')
          ? `${truncate(label, 88)}?`
          : truncate(label, 90),
      roleId: roleEntity?.id,
      roleName: roleEntity ? undefined : role,
      systemIds: [...new Set(systemEntities)],
      systemNames: systemNames.length ? systemNames : undefined,
      branch: st.branch === 'yes' || st.branch === 'no' ? st.branch : undefined,
      duration: durationOf(st.duration),
      waiting: durationOf(st.wait),
      score: 3,
      reasons: ['kielimalli'],
    })
  }
  return { suggestions, rejected }
}

/** Poistaa päällekkäiset ehdotukset (palojen rajat): samaa kohtaa ei ehdoteta kahdesti. */
function dedupe(list: Suggestion[]): Suggestion[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Suggestion[] = []
  for (const s of sorted) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.label.toLowerCase() === s.label.toLowerCase() &&
      Math.abs(prev.start - s.start) < 10
    )
      continue
    out.push(s)
  }
  return out
}

// --- Poimija ---

interface LlmRunOptions {
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

interface LlmResult {
  suggestions: Suggestion[]
  rejected: number
  chunks: number
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

async function chat(
  config: LlmConfig,
  userText: string,
  fetchImpl: Fetch,
  signal: AbortSignal | undefined,
  mode: 'schema' | 'json' | 'plain',
): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature ?? 0.1,
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Teksti:\n"""\n${userText}\n"""` },
    ],
  }
  if (mode === 'schema')
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'prosessin_vaiheet', schema: STEP_SCHEMA, strict: true },
    }
  else if (mode === 'json') body.response_format = { type: 'json_object' }
  let res: Response
  try {
    res = await fetchImpl(`${trimBase(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LlmError('Peruttu', 'abort')
    throw new LlmError('Yhteys kielimalliin katkesi', 'network')
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as ChatResponse | null)?.error?.message
    const e = new LlmError(
      `Kielimalli vastasi virheellä ${res.status}${detail ? `: ${detail}` : ''}`,
      'http',
    )
    ;(e as LlmError & { status?: number }).status = res.status
    throw e
  }
  const json = (await res.json().catch(() => null)) as ChatResponse | null
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new LlmError('Kielimallin vastaus oli tyhjä', 'parse')
  return content
}

/** Pyytää mallilta vaiheet yhdelle palalle. Jos palvelin ei tue rakenteista vastausta, kokeillaan kevyempiä tapoja. */
async function stepsForChunk(
  config: LlmConfig,
  text: string,
  fetchImpl: Fetch,
  signal: AbortSignal | undefined,
  mode: { current: 'schema' | 'json' | 'plain' },
): Promise<RawStep[]> {
  for (;;) {
    try {
      return parseSteps(await chat(config, text, fetchImpl, signal, mode.current))
    } catch (e) {
      const status = (e as { status?: number }).status
      // 400/422: palvelin ei tunne response_format-kenttää tai skeemaa: kevennä ja yritä uudelleen
      if (
        e instanceof LlmError &&
        e.kind === 'http' &&
        (status === 400 || status === 422) &&
        mode.current !== 'plain'
      ) {
        mode.current = mode.current === 'schema' ? 'json' : 'plain'
        continue
      }
      throw e
    }
  }
}

export async function llmSuggest(
  project: Pick<Project, 'entities'>,
  sourceId: string,
  text: string,
  config: LlmConfig,
  opts: LlmRunOptions = {},
  fetchImpl: Fetch = fetch,
): Promise<LlmResult> {
  if (!config.model.trim()) throw new LlmError('Valitse ensin malli', 'config')
  const chunks = chunkText(text)
  const mode = { current: 'schema' as 'schema' | 'json' | 'plain' }
  const all: Suggestion[] = []
  let rejected = 0
  for (const [i, chunk] of chunks.entries()) {
    if (opts.signal?.aborted) throw new LlmError('Peruttu', 'abort')
    opts.onProgress?.(i, chunks.length)
    const steps = await stepsForChunk(config, chunk.text, fetchImpl, opts.signal, mode)
    const r = stepsToSuggestions(project, sourceId, text, chunk, steps)
    all.push(...r.suggestions)
    rejected += r.rejected
  }
  opts.onProgress?.(chunks.length, chunks.length)
  return { suggestions: dedupe(all), rejected, chunks: chunks.length }
}
