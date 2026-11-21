import { newId } from './ids'
import type { ProcessEdge, ProcessNode, Project, SavedView, Scenario } from './types'

export interface ScenarioPath {
  /** Vaiheet kulkujärjestyksessä (alku mukaan lukien). */
  nodeIds: string[]
  edgeIds: Set<string>
  /** Vaiheen järjestysnumero polulla (1-pohjainen, ilman alku- ja loppupisteitä). */
  order: Map<string, number>
  /** Polku päättyi loppupisteeseen tai umpikujaan (ei silmukkaan). */
  complete: boolean
  /** Polku palasi jo käytyyn vaiheeseen ja katkaistiin. */
  looped: boolean
}

/**
 * Laskee skenaariopolun prosessissa. Päätöksessä seurataan valittua lähtevää yhteyttä, ja muissa
 * päätöksissä ensimmäistä. Jo käyty vaihe katkaisee polun, jotta silmukka ei jää ikuiseksi.
 */
export function scenarioPath(
  p: Project,
  processId: string,
  choices: Record<string, string> = {},
): ScenarioPath {
  const nodes = Object.values(p.nodes).filter((n) => n.processId === processId)
  const edges = Object.values(p.edges).filter((e) => e.processId === processId)
  const out = new Map<string, ProcessEdge[]>()
  const hasIn = new Set<string>()
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, [])
    out.get(e.from)!.push(e)
    hasIn.add(e.to)
  }
  const start =
    nodes.find((n) => n.kind === 'start') ?? nodes.find((n) => !hasIn.has(n.id)) ?? nodes[0]
  const result: ScenarioPath = {
    nodeIds: [],
    edgeIds: new Set(),
    order: new Map(),
    complete: false,
    looped: false,
  }
  if (!start) return result
  const seen = new Set<string>()
  let cur: ProcessNode | undefined = start
  let n = 0
  while (cur) {
    if (seen.has(cur.id)) {
      result.looped = true
      break
    }
    seen.add(cur.id)
    result.nodeIds.push(cur.id)
    if (cur.kind !== 'start' && cur.kind !== 'end') result.order.set(cur.id, ++n)
    const next: ProcessEdge[] = out.get(cur.id) ?? []
    if (next.length === 0) {
      result.complete = true
      break
    }
    const chosen: ProcessEdge | undefined =
      cur.kind === 'decision' ? next.find((e) => e.id === choices[cur!.id]) : undefined
    const edge: ProcessEdge = chosen ?? next[0]
    result.edgeIds.add(edge.id)
    cur = p.nodes[edge.to]
  }
  return result
}

/** Päätökset prosessin kulussa, joissa on valittavia haaroja. */
export function decisionsOf(
  p: Project,
  processId: string,
): { node: ProcessNode; edges: ProcessEdge[] }[] {
  const out = new Map<string, ProcessEdge[]>()
  for (const e of Object.values(p.edges)) {
    if (e.processId !== processId) continue
    if (!out.has(e.from)) out.set(e.from, [])
    out.get(e.from)!.push(e)
  }
  return Object.values(p.nodes)
    .filter(
      (n) => n.processId === processId && n.kind === 'decision' && (out.get(n.id)?.length ?? 0) > 1,
    )
    .map((node) => ({ node, edges: out.get(node.id)! }))
}

export function createScenario(
  processId: string,
  name: string,
  choices: Record<string, string>,
  description?: string,
): Scenario {
  return {
    id: newId('scn'),
    name: name.trim() || 'Skenaario',
    ...(description?.trim() ? { description: description.trim() } : {}),
    processId,
    choices,
  }
}

export function createView(init: Omit<SavedView, 'id'>): SavedView {
  return { id: newId('view'), ...init }
}
