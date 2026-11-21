import { graphToProject, type ImportedGraph, type ImportedNode } from './diagram'
import { MermaidImportError, parseMermaid } from './mermaidImport'
import { processToText } from './serialize'

/**
 * Markdown-dokumentin käsittely.
 *
 * Tekoälyn ja wikien tuottamat prosessikuvaukset ovat usein Markdownia: otsikoita, lihavointeja,
 * taulukoita ja Mermaid-koodilohkoja. Pikasyöte tulkitsee jokaisen rivin vaiheeksi, joten ne
 * muunnetaan ensin pikasyötteen tekstiksi (`markdownToDsl`). Lähdeluku käyttää pituuden säilyttävää
 * `maskMarkdown`ia, jotta ehdotusten sijainnit pysyvät oikeina.
 */

/** Rivin alussa oleva luettelomerkki. Pikasyötteestä viedyssä tekstissä se voi olla myös koodilohkon edessä. */
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/
const FENCE = /^\s*(?:[-*+]\s+)?```/
const TABLE_ROW = /^\s*(?:[-*+]\s+)?\|.*\|\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const MAIL_HEADER = /^(?:Lähettäjä|Vastaanottaja|Kopio|Päivä|Aihe):\s/
const RULE = /^\s*(?:[-*_]\s*){3,}$/

/** Näyttääkö teksti Markdown-dokumentilta eikä pikasyötteen tekstiltä? */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n')
  let score = 0
  if (lines.some((l) => FENCE.test(l))) score += 2
  const tableRows = lines.filter((l) => TABLE_ROW.test(l)).length
  if (tableRows >= 2) score += 2
  if (lines.some((l) => /^\s*(?:[-*+]\s+)?\|\s*:?-{2,}/.test(l))) score += 1
  if (/\*\*[^*\n]+\*\*/.test(text)) score += 1
  if (lines.filter((l) => /^\s{0,3}#{2,6}\s+\S/.test(l)).length >= 2) score += 2
  return score >= 2
}

/** Poistaa rivinsisäiset Markdown-merkinnät: lihavoinnin, kursiivin, koodimerkit ja linkkien osoitteet. */
export function stripInline(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pituuden säilyttävä versio: koodilohkot, taulukot ja vaakaviivat korvataan välilyönneillä ja
 * lihavoinnin merkit poistetaan. Rivinvaihdot ja kaikki muiden merkkien paikat pysyvät ennallaan.
 */
export function maskMarkdown(text: string): string {
  const lines = text.split('\n')
  let inFence = false
  const out = lines.map((line, i) => {
    // Sähköpostin otsikkorivit (lähettäjä, aihe jne.) eivät ole prosessin sisältöä
    if (i < 8 && MAIL_HEADER.test(line)) return ' '.repeat(line.length)
    if (FENCE.test(line)) {
      inFence = !inFence
      return ' '.repeat(line.length)
    }
    if (inFence || TABLE_ROW.test(line) || RULE.test(line)) return ' '.repeat(line.length)
    return line
      .replace(/(\*\*|__)/g, '  ')
      .replace(/^(\s{0,3})(#{1,6})(?=\s)/, (_m, a: string, b: string) => a + ' '.repeat(b.length))
      .replace(/`/g, ' ')
  })
  return out.join('\n')
}

// ---------- Muunnos pikasyötteeksi ----------

export interface MarkdownConversion {
  /** Pikasyötteen teksti. */
  dsl: string
  /** Vaiheiden ja päätösten määrä. */
  steps: number
  /** Kulku luettiin Mermaid-kaaviosta (muuten otsikoista tai luettelosta). */
  fromDiagram: boolean
  /** Mitä jätettiin pois tai tulkittiin, käyttäjälle kerrottavaksi. */
  notes: string[]
}

interface Section {
  title: string
  level: number
  body: string[]
}

/** Numerointi pois: "3. Suunnittelu", "Vaihe 3: Suunnittelu", "3.1 Suunnittelu". */
export function stripNumbering(s: string): string {
  return s
    .replace(/^(?:vaihe|step)\s+\d+\s*[.:)-]\s*/i, '')
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
    .trim()
}

const norm = (s: string) =>
  stripNumbering(stripInline(s))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

interface Parsed {
  sections: Section[]
  fences: { lang: string; body: string }[]
  tableRows: number
  /** Ensimmäinen taso 1 -otsikko ennen muuta sisältöä. */
  title?: string
  loose: string[]
}

function parseBlocks(text: string): Parsed {
  const sections: Section[] = []
  const fences: { lang: string; body: string }[] = []
  const loose: string[] = []
  let tableRows = 0
  let title: string | undefined
  let cur: Section | undefined
  let fence: { lang: string; lines: string[] } | undefined

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (FENCE.test(raw)) {
      if (fence) {
        fences.push({ lang: fence.lang, body: fence.lines.join('\n') })
        fence = undefined
      } else {
        fence = { lang: /```\s*([\w-]*)/.exec(raw)?.[1]?.toLowerCase() ?? '', lines: [] }
      }
      continue
    }
    if (fence) {
      // Pikasyötteestä viedyssä tekstissä koodirivien edessä voi olla luettelomerkki.
      fence.lines.push(raw.replace(BULLET_BEFORE_CODE, ''))
      continue
    }
    if (TABLE_ROW.test(raw)) {
      tableRows++
      continue
    }
    if (RULE.test(raw) || !raw.trim()) continue
    const h = HEADING.exec(raw)
    if (h) {
      const level = h[1].length
      const t = stripInline(h[2])
      if (level === 1 && !title && sections.length === 0 && !cur) {
        title = t
        continue
      }
      cur = { title: t, level, body: [] }
      sections.push(cur)
      continue
    }
    const line = stripInline(raw.replace(BULLET, ''))
    if (!line) continue
    if (cur) cur.body.push(line)
    else loose.push(raw)
  }
  return { sections, fences, tableRows, title, loose }
}

/** Mermaid-lohkon rivit voivat alkaa luettelomerkillä ("- A --> B"), jos teksti on viety pikasyötteestä. */
const BULLET_BEFORE_CODE = /^-\s+(?=(?:flowchart|graph)\b)/i

/** Suoraviivaiset otsikon alla olevat rivit kuvaukseksi. Ylimääräiset karsitaan. */
const MAX_DESCRIPTION_LINES = 14

function describe(body: string[]): string[] {
  return body.slice(0, MAX_DESCRIPTION_LINES)
}

function labelOfLine(s: string): string {
  return stripInline(s).replace(/[.:;]+$/, '')
}

/** Päättelee Mermaid-lohkon: ensimmäinen lohko, jossa on flowchart tai graph. */
function findDiagram(p: Parsed): ImportedGraph | undefined {
  for (const f of p.fences) {
    if (f.lang && f.lang !== 'mermaid') continue
    if (!/^\s*(?:flowchart|graph)\b/im.test(f.body)) continue
    try {
      return parseMermaid('```mermaid\n' + f.body + '\n```')
    } catch (e) {
      if (!(e instanceof MermaidImportError)) throw e
    }
  }
  return undefined
}

/**
 * Numerointi pois nimistä. Vaihe, josta lähtee useita nimettyjä tai muutoin eri haaroja, on
 * päätös, vaikka se olisi piirretty suorakulmiona (Mermaid ei vaadi rombia).
 */
function cleanGraph(g: ImportedGraph): void {
  const visit = (proc: { nodes: ImportedNode[]; edges: { from: string }[] }) => {
    const out = new Map<string, number>()
    for (const e of proc.edges) out.set(e.from, (out.get(e.from) ?? 0) + 1)
    for (const n of proc.nodes) {
      n.label = stripNumbering(n.label) || n.label
      if (n.kind === 'step' && (out.get(n.key) ?? 0) >= 2) n.kind = 'decision'
      if (n.child) visit(n.child)
    }
  }
  for (const proc of g.processes) visit(proc)
}

/** Etsii otsikon, joka vastaa solmun nimeä: täsmäosuma ensin, sitten toisen sisältävä nimi. */
function sectionFor(sections: Section[], label: string, used: Set<Section>): Section | undefined {
  const key = norm(label)
  if (!key) return undefined
  const free = sections.filter((s) => !used.has(s))
  const exact = free.find((s) => norm(s.title) === key)
  if (exact) return exact
  if (key.length < 6) return undefined
  return free.find((s) => {
    const t = norm(s.title)
    return t.length >= 6 && (t.includes(key) || key.includes(t))
  })
}

export function markdownToDsl(text: string): MarkdownConversion {
  const parsed = parseBlocks(text)
  const notes: string[] = []
  const graph = findDiagram(parsed)

  if (graph) {
    cleanGraph(graph)
    const used = new Set<Section>()
    const attach = (nodes: ImportedNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'step' || n.kind === 'decision') {
          const s = sectionFor(parsed.sections, n.label, used)
          if (s && s.body.length) {
            used.add(s)
            n.description = describe(s.body).join('\n')
          }
        }
        if (n.child) attach(n.child.nodes)
      }
    }
    for (const proc of graph.processes) attach(proc.nodes)
    const name = parsed.title || graph.processes[0]?.name || 'Prosessi'
    const project = graphToProject(graph, name)
    const dsl = `# ${name.replace(/\s+/g, ' ')}\n${processToText(project, project.rootProcessId)}`
    const steps = Object.values(project.nodes).filter(
      (n) => n.kind === 'step' || n.kind === 'decision' || n.kind === 'subprocess',
    ).length
    const unmatched = parsed.sections.filter((s) => !used.has(s) && s.body.length).length
    if (unmatched > 0)
      notes.push(
        `${unmatched} otsikkoa ei vastannut mitään kaavion vaihetta, joten niiden sisältö jätettiin pois.`,
      )
    if (parsed.tableRows > 0)
      notes.push(
        'Taulukot (esim. roolit ja vastuut) jätettiin pois. Tuo dokumentti Lähteet-näkymään, niin roolit löytyvät sieltä.',
      )
    return { dsl, steps, fromDiagram: true, notes }
  }

  // Ei kaaviota: otsikot vaiheiksi, sisältö kuvaukseksi. Jos otsikoita ei ole, ylimmän tason luettelo.
  const lines: string[] = []
  let steps = 0
  if (parsed.title) lines.push(`# ${parsed.title}`)
  if (parsed.sections.length >= 2) {
    // Vaiheiksi vain matalimman tason otsikot, jotta alaotsikot eivät hajota vaihetta osiin.
    const top = Math.min(...parsed.sections.map((s) => s.level))
    let step: { title: string; body: string[] } | undefined
    const flush = () => {
      if (!step) return
      lines.push(`- ${labelOfLine(stripNumbering(step.title))}`)
      for (const b of describe(step.body)) lines.push(`  ${b}`)
      steps++
    }
    for (const s of parsed.sections) {
      if (s.level === top) {
        flush()
        step = { title: s.title, body: [...s.body] }
      } else if (step) {
        step.body.push(`${labelOfLine(s.title)}:`, ...s.body)
      }
    }
    flush()
  } else {
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      if (FENCE.test(raw) || TABLE_ROW.test(raw) || RULE.test(raw) || HEADING.test(raw)) continue
      const m = BULLET.exec(raw)
      const indent = (/^\s*/.exec(raw)?.[0].length ?? 0) > 1
      const body = stripInline(raw.replace(BULLET, ''))
      if (!body) continue
      if (m && !indent) {
        lines.push(`- ${body}`)
        steps++
      } else if (lines.length && lines[lines.length - 1].startsWith('-')) lines.push(`  ${body}`)
      else {
        lines.push(`- ${body}`)
        steps++
      }
    }
  }
  if (parsed.fences.length > 0) notes.push('Koodilohkot (ei Mermaid-vuokaaviota) jätettiin pois.')
  if (parsed.tableRows > 0)
    notes.push(
      'Taulukot jätettiin pois. Tuo dokumentti Lähteet-näkymään, niin roolit löytyvät sieltä.',
    )
  notes.push(
    'Vaiheiden järjestys on dokumentin järjestys. Päätökset ja haarat pitää lisätä itse, jos dokumentissa ei ole Mermaid-kaaviota.',
  )
  return { dsl: lines.join('\n'), steps, fromDiagram: false, notes }
}
