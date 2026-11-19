import type { Confidence } from '../model/types'

/**
 * Pikasyötteen tekstisyntaksi.
 *
 *   # Prosessin nimi                      (valinnainen otsikko)
 *   - Vaihe @Rooli [Järjestelmä] < Syöte > Tuotos ~arvaus
 *   ? Päätöskysymys                       (haarat sisennettyinä)
 *     kyllä: - Vaihe
 *     ei: jatka                           (jatka | loppu | -> Vaiheen nimi)
 *   + Alaprosessi @Rooli                  (sisällä sisennetyt vaiheet)
 *   -> Vaiheen nimi                       (hyppy olemassa olevaan vaiheeseen)
 *   alku / loppu                          (alku- ja loppupiste; nimellä: "alku: Lasku saapuu")
 *   ---                                   (erotin: seuraava ketju ei jatka edellistä)
 *   // kommentti
 */

export interface Annotations {
  role?: string
  systems: string[]
  inputs: string[]
  outputs: string[]
  confidence?: Confidence
}

export type ItemKind = 'step' | 'decision' | 'subprocess' | 'start' | 'end' | 'goto' | 'break'

export type Jump = 'continue' | 'end' | { goto: string }

export interface ParsedBranch {
  label: string
  line: number
  start: number
  end: number
  jump?: Jump
  body: ParsedItem[]
}

export interface ParsedItem {
  kind: ItemKind
  line: number
  /** Rivin sijainti alkuperäisessä tekstissä (ilman sisennystä ja rivinvaihtoa). */
  start: number
  end: number
  /** Vaiheen nimi; hyppy-riveillä kohteen nimi. */
  label: string
  ann: Annotations
  branches: ParsedBranch[]
  children: ParsedItem[]
  notes: string[]
}

export interface Issue {
  line: number
  severity: 'error' | 'warning'
  message: string
}

export interface ParseResult {
  title?: string
  items: ParsedItem[]
  issues: Issue[]
}

export interface ParseOptions {
  /** Rivit (1-pohjaiset), jotka jätetään huomiotta alipuineen. */
  skipLines?: ReadonlySet<number>
}

interface RawLine {
  line: number
  start: number
  end: number
  indent: number
  text: string
  children: RawLine[]
}

const CONFIDENCE_WORDS: Record<string, Confidence> = {
  arvaus: 'guess',
  guess: 'guess',
  todennäköinen: 'likely',
  todennakoinen: 'likely',
  likely: 'likely',
  vahvistettu: 'confirmed',
  confirmed: 'confirmed',
}

const LIST_PREFIX = /^(?:[-*•–]|\d+[.)])\s+/
const BRANCH = /^([^:@[\]<>~?+]{1,40}?):\s*(.*)$/
const KEYWORD_CONTINUE = /^(?:jatka|jatkuu|jatketaan)[.!]?$/i
const KEYWORD_END = /^(?:loppu|lopeta|päättyy|paattyy)[.!]?$/i
const KEYWORD_START = /^(?:alku|aloita)[.!]?$/i

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const splitList = (s: string) => s.split(/[,;]/).map(clean).filter(Boolean)

/** Poimii merkinnät (@rooli, [järjestelmät], < syötteet, > tuotokset, ~varmuus) ja palauttaa jäljelle jäävän nimen. */
export function extractAnnotations(
  text: string,
  opts: { io: boolean } = { io: true },
): { label: string; ann: Annotations; warnings: string[] } {
  const ann: Annotations = { systems: [], inputs: [], outputs: [] }
  const warnings: string[] = []
  let rest = ` ${text} `

  rest = rest.replace(/\s~\s*([^\s]+)/g, (m, word: string) => {
    const c = CONFIDENCE_WORDS[word.toLocaleLowerCase('fi').replace(/[.,;:!]+$/, '')]
    if (!c) return m
    ann.confidence = c
    return ' '
  })

  rest = rest.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    ann.systems.push(...splitList(inner))
    return ' '
  })

  rest = rest.replace(
    /\s@(?:\(([^)]*)\)|"([^"]*)"|([^\s@[\]<>~,;]+))/g,
    (_m, a?: string, b?: string, c?: string) => {
      const name = clean((a ?? b ?? (c ?? '').replace(/_/g, ' ')) || '')
      if (!name) return ' '
      if (ann.role && ann.role !== name)
        warnings.push(`Useita rooleja, käytetään ensimmäistä (${ann.role})`)
      else ann.role = name
      return ' '
    },
  )

  let label = rest
  if (opts.io) {
    const parts = rest.split(/\s+(?=[<>]\s)/)
    label = parts[0]
    for (const part of parts.slice(1)) {
      const marker = part.trim()[0]
      const names = splitList(part.trim().slice(1))
      if (marker === '<') ann.inputs.push(...names)
      else ann.outputs.push(...names)
    }
  }
  return { label: clean(label), ann, warnings }
}

function emptyAnn(): Annotations {
  return { systems: [], inputs: [], outputs: [] }
}

export function parseSyntax(text: string, options: ParseOptions = {}): ParseResult {
  const issues: Issue[] = []
  const skip = options.skipLines ?? new Set<number>()
  const result: ParseResult = { items: [], issues }

  // 1. Rivit ja sisennykset
  const raws: RawLine[] = []
  let offset = 0
  const lines = text.split('\n')
  lines.forEach((rawLine, i) => {
    const lineStart = offset
    offset += rawLine.length + 1
    const noCr = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const trimmedEnd = noCr.replace(/\s+$/, '')
    const body = trimmedEnd.replace(/^\s+/, '')
    if (!body || body.startsWith('//')) return
    const indentStr = trimmedEnd.slice(0, trimmedEnd.length - body.length)
    const indent = [...indentStr].reduce((n, ch) => n + (ch === '\t' ? 2 : 1), 0)
    raws.push({
      line: i + 1,
      start: lineStart + indentStr.length,
      end: lineStart + trimmedEnd.length,
      indent,
      text: body,
      children: [],
    })
  })

  // 2. Otsikko
  if (raws.length && raws[0].text.startsWith('#')) {
    const first = raws.shift()!
    const t = clean(first.text.replace(/^#+\s*/, ''))
    if (t) result.title = t
  }

  // 3. Puu sisennysten mukaan
  const roots: RawLine[] = []
  const stack: RawLine[] = []
  for (const r of raws) {
    if (r.text.startsWith('#')) {
      issues.push({
        line: r.line,
        severity: 'warning',
        message: 'Otsikko sallitaan vain ensimmäisellä rivillä, rivi ohitettiin',
      })
      continue
    }
    while (stack.length && stack[stack.length - 1].indent >= r.indent) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(r)
    else roots.push(r)
    stack.push(r)
  }

  const pruned = (list: RawLine[]): RawLine[] =>
    list.filter((r) => !skip.has(r.line)).map((r) => ({ ...r, children: pruned(r.children) }))

  // 4. Rivit kohteiksi
  const warn = (line: number, message: string) =>
    issues.push({ line, severity: 'warning', message })
  const err = (line: number, message: string) => issues.push({ line, severity: 'error', message })

  const parseItem = (text: string, raw: RawLine, children: RawLine[]): ParsedItem => {
    const base = {
      line: raw.line,
      start: raw.start,
      end: raw.end,
      branches: [],
      children: [],
      notes: [] as string[],
    }
    let body = text.replace(LIST_PREFIX, '').trim()

    if (/^-{3,}$/.test(body)) {
      return { ...base, kind: 'break', label: '', ann: emptyAnn() }
    }

    // Hyppy
    const goto = /^(?:->|→)\s*(.*)$/.exec(body)
    if (goto) {
      const target = clean(goto[1])
      if (!target) err(raw.line, 'Hypyn kohde puuttuu (esim. "-> Vaiheen nimi")')
      if (children.length)
        warn(children[0].line, 'Hyppyrivin alle ei voi lisätä sisältöä, rivit ohitettiin')
      return { ...base, kind: 'goto', label: target, ann: emptyAnn() }
    }

    let kind: ItemKind = 'step'
    if (body.startsWith('?')) {
      kind = 'decision'
      body = body.slice(1).trim()
    } else if (body.startsWith('+')) {
      kind = 'subprocess'
      body = body.slice(1).trim()
    }

    const { label, ann, warnings } = extractAnnotations(body, { io: kind !== 'decision' })
    for (const w of warnings) warn(raw.line, w)
    if (kind === 'decision' && (ann.inputs.length || ann.outputs.length))
      ann.inputs = ann.outputs = []

    if (kind === 'step' && !ann.role && !ann.systems.length) {
      const named = /^(alku|loppu)\s*:\s*(.+)$/i.exec(label)
      if (named) {
        return {
          ...base,
          kind: named[1].toLowerCase() === 'alku' ? 'start' : 'end',
          label: clean(named[2]),
          ann,
        }
      }
      if (KEYWORD_START.test(label)) return { ...base, kind: 'start', label: 'Alku', ann }
      if (KEYWORD_END.test(label)) return { ...base, kind: 'end', label: 'Loppu', ann }
    }
    if (!label) {
      err(raw.line, 'Nimi puuttuu')
    }

    const item: ParsedItem = { ...base, kind, label, ann }
    if (kind === 'decision') {
      item.branches = children.map((c) => parseBranch(c))
      if (children.length === 0) warn(raw.line, 'Päätöksellä ei ole haaroja')
      else if (children.length === 1) warn(raw.line, 'Päätöksellä on vain yksi haara')
    } else if (kind === 'subprocess') {
      item.children = parseSequence(children)
    } else if (children.length) {
      item.notes = flattenText(children)
      warn(children[0].line, 'Vaiheen alle sisennetyt rivit tallennetaan vaiheen kuvaukseksi')
    }
    return item
  }

  const flattenText = (list: RawLine[]): string[] =>
    list.flatMap((r) => [r.text.replace(LIST_PREFIX, '').trim(), ...flattenText(r.children)])

  const parseBranch = (raw: RawLine): ParsedBranch => {
    const stripped = raw.text.replace(LIST_PREFIX, '')
    const m = BRANCH.exec(stripped)
    const common = { line: raw.line, start: raw.start, end: raw.end }
    if (!m) {
      // Haaran nimi puuttuu: koko rivi on haaran ensimmäinen vaihe.
      warn(raw.line, 'Haaran nimi puuttuu (esim. "kyllä:"), haara jäi nimettömäksi')
      return { ...common, label: '', body: [parseItem(raw.text, raw, raw.children)] }
    }
    const label = clean(m[1])
    const rest = m[2].trim()
    if (!rest) return { ...common, label, body: parseSequence(raw.children) }
    if (KEYWORD_CONTINUE.test(rest)) {
      if (raw.children.length)
        warn(raw.children[0].line, '"jatka"-haaran alle ei voi lisätä sisältöä, rivit ohitettiin')
      return { ...common, label, jump: 'continue', body: [] }
    }
    if (KEYWORD_END.test(rest)) {
      if (raw.children.length)
        warn(raw.children[0].line, '"loppu"-haaran alle ei voi lisätä sisältöä, rivit ohitettiin')
      return { ...common, label, jump: 'end', body: [] }
    }
    const goto = /^(?:->|→)\s*(.*)$/.exec(rest)
    if (goto) {
      const target = clean(goto[1])
      if (!target) err(raw.line, 'Hypyn kohde puuttuu (esim. "-> Vaiheen nimi")')
      if (raw.children.length)
        warn(raw.children[0].line, 'Hyppyhaaran alle ei voi lisätä sisältöä, rivit ohitettiin')
      return { ...common, label, jump: { goto: target }, body: [] }
    }
    // Inline-vaihe: sisennetyt rivit kuuluvat vaiheelle (päätös/alaprosessi) tai jatkavat haaran runkoa (vaihe).
    const probe = rest.replace(LIST_PREFIX, '').trim()
    const itemIsContainer = probe.startsWith('?') || probe.startsWith('+')
    if (itemIsContainer) return { ...common, label, body: [parseItem(rest, raw, raw.children)] }
    return { ...common, label, body: [parseItem(rest, raw, []), ...parseSequence(raw.children)] }
  }

  function parseSequence(list: RawLine[]): ParsedItem[] {
    return list.map((r) => parseItem(r.text, r, r.children))
  }

  result.items = parseSequence(pruned(roots))
  return result
}

/** Kaikki jäsennetyt kohteet (myös sisäkkäiset) litteänä listana, rivijärjestyksessä. */
export function walkItems(items: ParsedItem[], visit: (item: ParsedItem) => void): void {
  for (const it of items) {
    visit(it)
    for (const b of it.branches) walkItems(b.body, visit)
    walkItems(it.children, visit)
  }
}
