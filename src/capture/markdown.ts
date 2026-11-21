import { ensureEntity } from '../model/commands'
import { parseDuration } from '../model/duration'
import { applyOperations, type Operation } from '../model/operations'
import type { Project } from '../model/types'
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
  /** Taulukot soluina (otsikkorivi ensin, erotinrivi poistettu). */
  tables: string[][][]
  /** Ensimmäinen taso 1 -otsikko ennen muuta sisältöä. */
  title?: string
  loose: string[]
}

function parseBlocks(text: string): Parsed {
  const sections: Section[] = []
  const fences: { lang: string; body: string }[] = []
  const loose: string[] = []
  let tableRows = 0
  const tables: string[][][] = []
  let table: string[][] | undefined
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
      const cells = raw
        .replace(/^\s*(?:[-*+]\s+)?\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => stripInline(c))
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || !c)) {
        if (!table) tables.push((table = []))
        table.push(cells)
      }
      continue
    }
    table = undefined
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
  return { sections, fences, tableRows, tables, title, loose }
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

// ---------- Dokumentin rakenne: vaiheen kentät, prosessikortti, roolit ja RACI ----------

interface StepInfo {
  description: string[]
  inputs: string[]
  outputs: string[]
  role?: string
  duration?: string
  waiting?: string
  checklist: string[]
}

/** Pilkkuerotellut kohteet. Viimeinen kohde jaetaan sanalla "ja" vain, kun luettelossa on jo pilkkuja ("a, b ja c"). */
const splitItems = (s: string) => {
  const parts = s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    const last = parts.pop()!
    parts.push(...last.split(/\s+(?:ja|sekä)\s+/i))
  }
  return parts.map((x) => x.replace(/[.]+$/, '').trim()).filter(Boolean)
}

/** Vaiheen otsikon alla olevat rivit: nimetyt kentät (Tavoite, Syöte, Tuotos ...) ja muu teksti kuvaukseksi. */
export function readStepBody(body: string[]): StepInfo {
  const info: StepInfo = { description: [], inputs: [], outputs: [], checklist: [] }
  let mode: 'actions' | 'checklist' | undefined
  for (const line of body) {
    const m = /^([\p{L} ]{3,30}?)\s*:\s*(.*)$/u.exec(line)
    const key = m?.[1].toLowerCase()
    const val = m?.[2].trim() ?? ''
    if (key && /^(tavoite|tarkoitus)$/.test(key) && val) {
      info.description.push(`Tavoite: ${val}`)
      mode = undefined
    } else if (key && /^(syöte|syötteet|lähtötiedot)$/.test(key) && val) {
      info.inputs.push(...splitItems(val))
      mode = undefined
    } else if (key && /^(tuotos|tuotokset|lopputulos|tulos)$/.test(key) && val) {
      info.outputs.push(...splitItems(val))
      mode = undefined
    } else if (key && /^(vastuu|vastuuhenkilö|vastuuhenkilo|rooli|suorittaja)$/.test(key) && val) {
      info.role ??= val
        .replace(/[.]+$/, '')
        .split(/[,;]| ja /)[0]
        .trim()
      mode = undefined
    } else if (key && /^(työaika|kesto|aika)$/.test(key) && parseDuration(val)) {
      info.duration = val
      mode = undefined
    } else if (key && /^(odotus|odotusaika|läpimenoaika)$/.test(key) && parseDuration(val)) {
      info.waiting = val
      mode = undefined
    } else if (key && /^(toimenpiteet|tehtävät|vaiheet|tyypillinen rakenne)$/.test(key) && !val) {
      mode = 'actions'
      info.description.push(`${m![1]}:`)
    } else if (key && /^(tarkistuslista|tarkista|tarkistukset)$/.test(key) && !val) {
      mode = 'checklist'
    } else if (mode === 'checklist') info.checklist.push(line)
    else info.description.push(line)
  }
  return info
}

type SectionKind = 'step' | 'purpose' | 'checklist' | 'metrics' | 'risks' | 'roles' | 'owner'

/** Otsikon tyyppi: prosessin yleisosiot eivät ole vaiheita. */
export function classifySection(title: string): SectionKind {
  const t = norm(title)
  const has = (words: string) => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, 'u').test(t)
  if (has('tarkistuslista|laadunvarmistus|laatukriteerit?|checklist|valmiuden kriteerit'))
    return 'checklist'
  if (has('mittarit?|tunnusluvut?|kpi|seuranta')) return 'metrics'
  if (has('riskit?')) return 'risks'
  if (has('roolit|rooli|vastuut|vastuunjako|raci|raci matriisi|vastuumatriisi')) return 'roles'
  if (has('tarkoitus|yleiskuvaus|johdanto|tausta')) return 'purpose'
  if (has('prosessin omistaja|omistaja')) return 'owner'
  return 'step'
}

const roleRef = (name: string) =>
  /[\s@[\]<>~,;()"]/.test(name) ? `@(${name.replace(/[()]/g, '')})` : `@${name}`

interface RaciRow {
  step: string
  r: string[]
  a: string[]
  c: string[]
  i: string[]
}

/** Roolitaulukko ja RACI-taulukko dokumentin taulukoista. */
function readTables(tables: string[][][]): {
  roles: { name: string; description: string }[]
  raci: RaciRow[]
} {
  const roles: { name: string; description: string }[] = []
  const raci: RaciRow[] = []
  for (const t of tables) {
    const head = t[0]?.map((c) => c.toLowerCase().trim()) ?? []
    if (head.length < 2 || t.length < 2) continue
    const raciCols = { r: -1, a: -1, c: -1, i: -1 }
    head.forEach((h, idx) => {
      if (idx === 0) return
      const k = /^(r|vastuullinen|suorittaja)$/.test(h)
        ? 'r'
        : /^(a|hyväksyjä|vastuuhenkilö)$/.test(h)
          ? 'a'
          : /^(c|konsultoitava|konsultoitavat)$/.test(h)
            ? 'c'
            : /^(i|informoitava|informoitavat)$/.test(h)
              ? 'i'
              : undefined
      if (k && raciCols[k] < 0) raciCols[k] = idx
    })
    if (Object.values(raciCols).filter((x) => x >= 0).length >= 3) {
      for (const row of t.slice(1)) {
        const cell = (k: keyof typeof raciCols) =>
          raciCols[k] >= 0 ? splitItems(row[raciCols[k]] ?? '') : []
        if (row[0])
          raci.push({ step: row[0], r: cell('r'), a: cell('a'), c: cell('c'), i: cell('i') })
      }
      continue
    }
    if (/^(rooli|toimija|vastuutaho|henkilö|titteli)/.test(head[0])) {
      for (const row of t.slice(1)) {
        const name = row[0]?.trim()
        const description = row.slice(1).filter(Boolean).join('; ').trim()
        if (name && description) roles.push({ name, description })
      }
    }
  }
  return { roles, raci }
}

/** Prosessikortin ja roolien direktiivirivit osioista, taulukoista ja johdantokappaleesta. */
function metaLines(
  parsed: Parsed,
  tables: ReturnType<typeof readTables>,
): { lines: string[]; used: Set<Section> } {
  const lines: string[] = []
  const used = new Set<Section>()
  const one = (s: string) => s.replace(/\s+/g, ' ').trim()
  const intro = parsed.loose
    .filter((l) => !BULLET.test(l))
    .map((l) => stripInline(l))
    .find((l) => l.length >= 20)
  let purpose = intro
  for (const sec of parsed.sections) {
    const kind = classifySection(sec.title)
    if (kind === 'step') continue
    used.add(sec)
    if (!sec.body.length) continue
    if (kind === 'purpose') purpose ??= sec.body[0]
    else if (kind === 'owner') lines.push(`:omistaja ${one(sec.body[0])}`)
    else if (kind === 'checklist') for (const l of sec.body) lines.push(`:tarkistus ${one(l)}`)
    else if (kind === 'metrics') for (const l of sec.body) lines.push(`:mittari ${one(l)}`)
    else if (kind === 'risks') for (const l of sec.body) lines.push(`:riski ${one(l)}`)
  }
  if (purpose) lines.unshift(`:tarkoitus ${one(purpose)}`)
  for (const r of tables.roles)
    lines.push(`:rooli ${one(r.name).replace(/:/g, ' ')}: ${one(r.description)}`)
  return { lines, used }
}

/** Lisää vaiheen tiedot (syötteet, tuotokset, rooli, ajat, tarkistuslista) malliin. */
function applyStepInfo(p: Project, nodeId: string, info: StepInfo): Project {
  const ops: Operation[] = []
  let cur = p
  const entity = (kind: 'role' | 'artifact', name: string) => {
    const r = ensureEntity(cur, kind, name)
    cur = applyOperations(cur, r.ops)
    ops.push(...r.ops)
    return r.id
  }
  const node = cur.nodes[nodeId]
  const patch: Record<string, unknown> = {}
  if (info.role && !node.roleId) patch.roleId = entity('role', info.role)
  if (info.inputs.length)
    patch.inputIds = [
      ...new Set([...node.inputIds, ...info.inputs.map((x) => entity('artifact', x))]),
    ]
  if (info.outputs.length)
    patch.outputIds = [
      ...new Set([...node.outputIds, ...info.outputs.map((x) => entity('artifact', x))]),
    ]
  const d = info.duration ? parseDuration(info.duration) : undefined
  if (d && !node.duration) patch.duration = d
  const w = info.waiting ? parseDuration(info.waiting) : undefined
  if (w && !node.waiting) patch.waiting = w
  if (info.checklist.length) patch.checklist = info.checklist
  return applyOperations(cur, [{ type: 'updateNode', id: nodeId, patch }])
}

function applyRaci(p: Project, rows: RaciRow[]): Project {
  let cur = p
  for (const row of rows) {
    const key = norm(row.step)
    const node = Object.values(cur.nodes).find(
      (n) => (n.kind === 'step' || n.kind === 'subprocess') && norm(n.label) === key,
    )
    if (!node) continue
    const role = (name: string) => {
      const r = ensureEntity(cur, 'role', name)
      cur = applyOperations(cur, r.ops)
      return r.id
    }
    const patch: Record<string, unknown> = {}
    if (row.r.length && !cur.nodes[node.id].roleId) patch.roleId = role(row.r[0])
    const raci = { ...(cur.nodes[node.id].raci ?? {}) }
    const sets = [
      ['a', 'accountableIds'],
      ['c', 'consultedIds'],
      ['i', 'informedIds'],
    ] as const
    for (const [letter, k] of sets) {
      if (!row[letter].length) continue
      raci[k] = [...new Set([...(raci[k] ?? []), ...row[letter].map(role)])]
    }
    if (Object.keys(raci).length) patch.raci = raci
    cur = applyOperations(cur, [{ type: 'updateNode', id: node.id, patch }])
  }
  return cur
}

/** Vaiheen rivi pikasyötteessä: nimi, rooli, järjestelmätön, syötteet, tuotokset, ajat ja RACI. */
function stepLine(title: string, info: StepInfo, raci?: RaciRow): string {
  const parts = [`- ${labelOfLine(stripNumbering(title))}`]
  const role = info.role ?? raci?.r[0]
  if (role) parts.push(roleRef(role))
  if (info.inputs.length) parts.push(`< ${info.inputs.join(', ')}`)
  if (info.outputs.length) parts.push(`> ${info.outputs.join(', ')}`)
  const dur = info.duration && parseDuration(info.duration) ? info.duration : undefined
  const wait = info.waiting && parseDuration(info.waiting) ? info.waiting : undefined
  if (dur) parts.push(`=${dur}`)
  if (wait) parts.push(`^${wait}`)
  if (raci) {
    for (const [letter, key] of [
      ['A', 'a'],
      ['C', 'c'],
      ['I', 'i'],
    ] as const)
      for (const n of raci[key]) parts.push(`${letter}${roleRef(n)}`)
  }
  return parts.join(' ')
}

export function markdownToDsl(text: string): MarkdownConversion {
  const parsed = parseBlocks(text)
  const notes: string[] = []
  const graph = findDiagram(parsed)

  const tables = readTables(parsed.tables)
  const meta = metaLines(parsed, tables)

  if (graph) {
    cleanGraph(graph)
    const used = new Set<Section>(meta.used)
    const infos = new Map<string, StepInfo>()
    const attach = (nodes: ImportedNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'step' || n.kind === 'decision') {
          const s = sectionFor(parsed.sections, n.label, used)
          if (s && s.body.length) {
            used.add(s)
            const info = readStepBody(s.body)
            infos.set(n.key, info)
            n.description = describe(info.description).join('\n')
            if (n.kind === 'step' && info.role) n.role = info.role
          }
        }
        if (n.child) attach(n.child.nodes)
      }
    }
    for (const proc of graph.processes) attach(proc.nodes)
    const name = parsed.title || graph.processes[0]?.name || 'Prosessi'
    let project = graphToProject(graph, name)
    // Kenttien liittäminen malliin: sama järjestys kuin kaaviossa, nimi tunnistaa solmun
    const taken = new Set<string>()
    const walk = (nodes: ImportedNode[]) => {
      for (const n of nodes) {
        const info = infos.get(n.key)
        if (info && n.kind === 'step') {
          const node = Object.values(project.nodes).find(
            (x) => x.label === n.label && !taken.has(x.id),
          )
          if (node) {
            taken.add(node.id)
            project = applyStepInfo(project, node.id, info)
          }
        }
        if (n.child) walk(n.child.nodes)
      }
    }
    for (const proc of graph.processes) walk(proc.nodes)
    project = applyRaci(project, tables.raci)
    const body = processToText(project, project.rootProcessId)
    const dsl = [`# ${name.replace(/\s+/g, ' ')}`, ...meta.lines, body].join('\n')
    const steps = Object.values(project.nodes).filter(
      (n) => n.kind === 'step' || n.kind === 'decision' || n.kind === 'subprocess',
    ).length
    const unmatched = parsed.sections.filter((s) => !used.has(s) && s.body.length).length
    if (unmatched > 0)
      notes.push(
        `${unmatched} otsikkoa ei vastannut mitään kaavion vaihetta, joten niiden sisältö jätettiin pois.`,
      )
    const handled = tables.roles.length + tables.raci.length
    if (parsed.tables.length > handled && parsed.tableRows > 0)
      notes.push('Osa taulukoista jätettiin pois (vain rooli- ja RACI-taulukot luetaan).')
    return { dsl, steps, fromDiagram: true, notes }
  }

  // Ei kaaviota: otsikot vaiheiksi, sisältö kuvaukseksi. Jos otsikoita ei ole, ylimmän tason luettelo.
  const lines: string[] = []
  let steps = 0
  if (parsed.title) lines.push(`# ${parsed.title}`)
  lines.push(...meta.lines)
  const stepSections = parsed.sections.filter((s) => !meta.used.has(s))
  if (stepSections.length >= 2) {
    // Vaiheiksi vain matalimman tason otsikot, jotta alaotsikot eivät hajota vaihetta osiin.
    const top = Math.min(...stepSections.map((s) => s.level))
    let step: { title: string; body: string[] } | undefined
    const raciOf = (title: string) => tables.raci.find((r) => norm(r.step) === norm(title))
    const flush = () => {
      if (!step) return
      const info = readStepBody(step.body)
      lines.push(stepLine(step.title, info, raciOf(step.title)))
      for (const b of describe(info.description)) lines.push(`  ${b}`)
      for (const c of info.checklist) lines.push(`  :tarkistus ${c}`)
      steps++
    }
    for (const s of stepSections) {
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
  if (parsed.tables.length > tables.roles.length + tables.raci.length && parsed.tableRows > 0)
    notes.push('Osa taulukoista jätettiin pois (vain rooli- ja RACI-taulukot luetaan).')
  notes.push(
    'Vaiheiden järjestys on dokumentin järjestys. Päätökset ja haarat pitää lisätä itse, jos dokumentissa ei ole Mermaid-kaaviota.',
  )
  return { dsl: lines.join('\n'), steps, fromDiagram: false, notes }
}
