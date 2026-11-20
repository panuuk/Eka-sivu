import { edgesOf, nodesOf } from './selectors'
import type { ProcessNode, Project } from './types'

export interface FlowRow {
  node: ProcessNode
  /** Sisennys haarautumien mukaan. */
  depth: number
  /** Solmun seuraajat reunan nimikkeineen. */
  next: { id: string; label?: string }[]
  /** Solmuun ei pääse alkupisteestä. */
  orphan: boolean
}

/**
 * Prosessin solmut luettavassa järjestyksessä: syvyyshaku alkupisteistä niin, että haarat tulevat
 * peräkkäin ja yhdistyvät solmut näytetään vain kerran. Saavuttamattomat solmut tulevat loppuun.
 */
export function flowOrder(p: Project, processId: string): FlowRow[] {
  const nodes = nodesOf(p, processId)
  const edges = edgesOf(p, processId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, { id: string; label?: string }[]>()
  const hasIn = new Set<string>()
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, [])
    out.get(e.from)!.push({ id: e.to, label: e.label })
    hasIn.add(e.to)
  }
  const starts = nodes.filter((n) => n.kind === 'start' || !hasIn.has(n.id))
  starts.sort((a, b) => (a.kind === 'start' ? -1 : 0) - (b.kind === 'start' ? -1 : 0))
  const rows: FlowRow[] = []
  const seen = new Set<string>()
  const visit = (id: string, depth: number, orphan: boolean) => {
    if (seen.has(id)) return
    const node = byId.get(id)
    if (!node) return
    seen.add(id)
    const next = out.get(id) ?? []
    rows.push({ node, depth, next, orphan })
    next.forEach((nx) =>
      visit(nx.id, next.length > 1 && node.kind === 'decision' ? depth + 1 : depth, orphan),
    )
  }
  const trueStarts = starts.filter((n) => n.kind === 'start')
  for (const s of trueStarts) visit(s.id, 0, false)
  for (const s of starts.filter((n) => n.kind !== 'start')) visit(s.id, 0, trueStarts.length > 0)
  for (const n of nodes) visit(n.id, 0, true)
  return rows
}

/** Vakaa väri entiteetille sen tunnisteesta. */
export function entityHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 360
}

export function entityColor(id: string | undefined): string {
  if (!id) return 'var(--border-strong)'
  return `hsl(${entityHue(id)} 58% 46%)`
}
