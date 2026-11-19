import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import type { Direction } from '../store/ui'
import type { Point } from '../model/types'

export interface LayoutNode {
  id: string
  width: number
  height: number
}
export interface LayoutEdge {
  id: string
  from: string
  to: string
}
export interface LayoutInput {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  direction: Direction
}

export type LayoutRunner = (graph: ElkNode) => Promise<ElkNode>

export const portIn = (id: string) => `${id}:in`
export const portOut = (id: string) => `${id}:out`

export function buildElkGraph(input: LayoutInput): ElkNode {
  const ids = new Set(input.nodes.map((n) => n.id))
  const vertical = input.direction === 'DOWN'
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': input.direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // Syklit katkaistaan syöttöjärjestyksen mukaan: myöhempään solmuun osoittava paluureuna käännetään.
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '72',
    },
    // Jokaisella solmulla on yksi sisään- ja yksi ulosmenoportti sivujen keskellä,
    // jotta reitit alkavat ja päättyvät täsmälleen kaavion kahvojen kohdalle.
    children: input.nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        {
          id: portIn(n.id),
          x: vertical ? n.width / 2 : 0,
          y: vertical ? 0 : n.height / 2,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': vertical ? 'NORTH' : 'WEST' },
        },
        {
          id: portOut(n.id),
          x: vertical ? n.width / 2 : n.width,
          y: vertical ? n.height : n.height / 2,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': vertical ? 'SOUTH' : 'EAST' },
        },
      ],
    })),
    edges: input.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ id: e.id, sources: [portOut(e.from)], targets: [portIn(e.to)] })),
  }
}

export interface LayoutResult {
  positions: Map<string, Point>
  /** Reunojen reitit pisteinä lähdöstä kohteeseen (kaavion koordinaateissa). */
  routes: Map<string, Point[]>
}

export async function computeLayout(input: LayoutInput, run: LayoutRunner): Promise<LayoutResult> {
  const positions = new Map<string, Point>()
  const routes = new Map<string, Point[]>()
  if (input.nodes.length === 0) return { positions, routes }
  const res = await run(buildElkGraph(input))
  for (const c of res.children ?? []) positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 })
  for (const e of res.edges ?? []) {
    const sec = (e as ElkExtendedEdge).sections?.[0]
    if (!sec) continue
    routes.set(
      e.id,
      [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((pt) => ({ x: pt.x, y: pt.y })),
    )
  }
  return { positions, routes }
}
