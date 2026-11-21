import type { NodeKind } from '../model/types'
import type { ImportedEdge, ImportedGraph, ImportedNode, ImportedProcess } from './diagram'
import { MAX_IMPORT_NODES } from './diagram'

/**
 * Mermaid-flowchart-tuonti (osajoukko): solmut eri muodoin, nuolet nimikkeineen ja subgraph-lohkot
 * alaprosesseina. Tyylit, linkit ja muut ohjeet ohitetaan.
 */

export class MermaidImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MermaidImportError'
  }
}

interface RawNode {
  id: string
  label: string
  shape: 'rect' | 'round' | 'stadium' | 'subroutine' | 'decision' | 'circle' | 'other'
}

const SHAPES: { open: string; close: string; shape: RawNode['shape'] }[] = [
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'decision' },
  { open: '[(', close: ')]', shape: 'other' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'decision' },
  { open: '>', close: ']', shape: 'other' },
]

/** Poistaa Mermaidin koodauksen: #quot; ja <br/> sekä yksinkertainen kursiivi (rooli). */
function cleanLabel(raw: string): { label: string; role?: string } {
  let s = raw.trim()
  if (/^".*"$/s.test(s)) s = s.slice(1, -1)
  s = s
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, '&')
    .replace(/#lt;/g, '<')
    .replace(/#gt;/g, '>')
  // Oma vientimme: "Nimi<br/><i>Rooli</i>"
  const m = /^(.*?)<br\s*\/?>\s*<i>(.*?)<\/i>\s*$/is.exec(s)
  const role = m ? m[2].replace(/<[^>]+>/g, '').trim() : undefined
  const label = (m ? m[1] : s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { label, role: role || undefined }
}

/** Lukee solmun määrittelyn kohdasta `i`. Palauttaa solmun ja seuraavan paikan. */
function readNode(src: string, start: number): { node: RawNode; end: number } | null {
  const id = /^[A-Za-z0-9_\-.åäöÅÄÖ]+/.exec(src.slice(start))?.[0]
  if (!id) return null
  let i = start + id.length
  const rest = src.slice(i)
  for (const sh of SHAPES) {
    if (!rest.startsWith(sh.open)) continue
    // Lainausmerkeillä suojattu teksti voi sisältää sulkumerkkejä
    let j = i + sh.open.length
    let inQuote = false
    let found = -1
    for (; j < src.length; j++) {
      if (src[j] === '"') inQuote = !inQuote
      else if (!inQuote && src.startsWith(sh.close, j)) {
        found = j
        break
      }
    }
    if (found < 0) return null
    const text = src.slice(i + sh.open.length, found)
    i = found + sh.close.length
    return { node: { id, label: text, shape: sh.shape }, end: i }
  }
  return { node: { id, label: '', shape: 'rect' }, end: i }
}

const ARROW = /^\s*(?:-\.+->|-\.-|={2,}>|={3,}|-{2,}>|-{3,}|--[ox]|~~~)/

interface Statement {
  nodes: RawNode[]
  links: { from: number; to: number; label?: string }[]
}

/** Jäsentää yhden rivin: ketju `A --> B -->|x| C` tai pelkkä solmumäärittely. */
function parseStatement(line: string): Statement | null {
  const nodes: RawNode[] = []
  const links: Statement['links'] = []
  let i = 0
  const skipWs = () => {
    while (line[i] === ' ' || line[i] === '\t') i++
  }
  skipWs()
  const first = readNode(line, i)
  if (!first) return null
  nodes.push(first.node)
  i = first.end
  while (i < line.length) {
    skipWs()
    if (i >= line.length) break
    // Nuolen nimike: -- teksti --> tai -->|teksti|
    let label: string | undefined
    const textArrow = /^(--|==|-\.)\s+([^>|=-][^>]*?)\s+(-{2,}>|={2,}>|\.->|-{2,}|-\.-)/.exec(
      line.slice(i),
    )
    let m: RegExpExecArray | null
    if (textArrow) {
      label = textArrow[2]
      i += textArrow[0].length
    } else if ((m = ARROW.exec(line.slice(i)))) {
      i += m[0].length
      const pipe = /^\s*\|([^|]*)\|/.exec(line.slice(i))
      if (pipe) {
        label = pipe[1]
        i += pipe[0].length
      }
    } else break
    skipWs()
    const next = readNode(line, i)
    if (!next) return null
    nodes.push(next.node)
    links.push({ from: nodes.length - 2, to: nodes.length - 1, label })
    i = next.end
  }
  return { nodes, links }
}

interface Group {
  id: string
  title: string
  nodes: string[]
  parent?: string
}

export function parseMermaid(text: string): ImportedGraph {
  // Markdown-koodilohko (```mermaid) otetaan sisältä
  const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(text)
  const src = (fenced ? fenced[1] : text).replace(/^\uFEFF/, '')
  const lines = src
    .split(/\r?\n|;(?![^"]*"[^"]*(?:"[^"]*"[^"]*)*$)/)
    .map((l) => l.replace(/%%.*$/, '').trim())
    .filter(Boolean)
  const headIdx = lines.findIndex((l) => /^(flowchart|graph)\b/i.test(l))
  if (headIdx < 0)
    throw new MermaidImportError(
      'Tiedosto ei ole Mermaid-vuokaavio (rivi “flowchart TD” tai “graph LR” puuttuu)',
    )

  const raw = new Map<string, RawNode>()
  const order: string[] = []
  const links: ImportedEdge[] = []
  const groups = new Map<string, Group>()
  const stack: string[] = []
  const memberOf = new Map<string, string>() // solmu -> ryhmä

  const touch = (n: RawNode) => {
    const cur = raw.get(n.id)
    if (!cur) {
      raw.set(n.id, n)
      order.push(n.id)
    } else if (n.label && !cur.label) {
      cur.label = n.label
      cur.shape = n.shape
    }
    const g = stack[stack.length - 1]
    if (g && !memberOf.has(n.id) && !groups.has(n.id)) {
      memberOf.set(n.id, g)
      groups.get(g)!.nodes.push(n.id)
    }
  }

  for (const line of lines.slice(headIdx + 1)) {
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/i.test(line))
      continue
    const sg = /^subgraph\s+(.+)$/i.exec(line)
    if (sg) {
      // subgraph id["Otsikko"] tai subgraph Otsikko
      const m = /^([A-Za-z0-9_\-.åäöÅÄÖ]+)\s*\[(.*)\]\s*$/s.exec(sg[1].trim())
      const id = m ? m[1] : `sg_${groups.size + 1}`
      const title = cleanLabel(m ? m[2] : sg[1]).label || 'Alaprosessi'
      groups.set(id, { id, title, nodes: [], parent: stack[stack.length - 1] })
      stack.push(id)
      continue
    }
    if (/^end$/i.test(line)) {
      stack.pop()
      continue
    }
    const st = parseStatement(line)
    if (!st) continue
    st.nodes.forEach(touch)
    for (const l of st.links)
      links.push({
        from: st.nodes[l.from].id,
        to: st.nodes[l.to].id,
        label: l.label ? cleanLabel(l.label).label : undefined,
      })
  }
  if (raw.size === 0) throw new MermaidImportError('Kaaviosta ei löytynyt solmuja')
  if (raw.size > MAX_IMPORT_NODES)
    throw new MermaidImportError(
      `Kaavio on liian suuri (${raw.size} solmua, enintään ${MAX_IMPORT_NODES})`,
    )

  const outDeg = new Map<string, number>()
  const inDeg = new Map<string, number>()
  for (const l of links) {
    outDeg.set(l.from, (outDeg.get(l.from) ?? 0) + 1)
    inDeg.set(l.to, (inDeg.get(l.to) ?? 0) + 1)
  }
  const toNode = (id: string): ImportedNode => {
    const r = raw.get(id)!
    const { label, role } = cleanLabel(r.label || id)
    let kind: NodeKind = 'step'
    if (r.shape === 'decision') kind = 'decision'
    else if (r.shape === 'subroutine') kind = 'subprocess'
    else if (r.shape === 'stadium' || r.shape === 'circle') {
      // Alku ja loppu tunnistetaan kaaren suunnasta
      if (!inDeg.get(id) && outDeg.get(id)) kind = 'start'
      else if (!outDeg.get(id) && inDeg.get(id)) kind = 'end'
    }
    return { key: id, kind, label: label || id, role }
  }

  // Ryhmät alaprosesseina: ryhmän tunniste on solmu, johon ryhmän ulkopuoliset yhteydet kytketään
  const build = (parent: string | undefined): ImportedProcess => {
    const nodes: ImportedNode[] = []
    const keys = new Set<string>()
    for (const id of order) {
      if ((memberOf.get(id) ?? undefined) === parent && !groups.has(id)) {
        nodes.push(toNode(id))
        keys.add(id)
      }
    }
    for (const g of groups.values()) {
      if (g.parent !== parent) continue
      nodes.push({ key: g.id, kind: 'subprocess', label: g.title, child: build(g.id) })
      keys.add(g.id)
    }
    // Yhteyden päätepiste nostetaan tämän tason solmuun (ryhmän sisäinen solmu -> ryhmä)
    const lift = (id: string): string | undefined => {
      let cur: string | undefined = id
      while (cur) {
        if (keys.has(cur)) return cur
        cur = memberOf.get(cur) ?? groups.get(cur)?.parent
      }
      return undefined
    }
    const edges: ImportedEdge[] = []
    const seen = new Set<string>()
    for (const l of links) {
      const from = lift(l.from)
      const to = lift(l.to)
      if (!from || !to || from === to) continue
      const k = `${from}>${to}`
      if (seen.has(k)) continue
      seen.add(k)
      edges.push({ from, to, label: l.label })
    }
    return {
      name: parent ? (groups.get(parent)?.title ?? 'Alaprosessi') : 'Tuotu kaavio',
      nodes,
      edges,
    }
  }
  const top = build(undefined)
  return { processes: [top], skipped: [] }
}
