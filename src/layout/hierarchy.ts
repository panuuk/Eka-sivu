import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import type { Direction } from '../store/ui'
import type { NodeKind, Point } from '../model/types'
import type { LayoutRunner } from './elk'
import { portIn, portOut } from './elk'

/**
 * Kokonaiskuvan asettelu: kaikki alaprosessit avataan vanhempiensa sisään ryhmälaatikoiksi, ja koko
 * hierarkia asetellaan yhdellä ELK-ajolla. Reunat kulkevat vain saman prosessin sisällä.
 */

export interface HierNodeInput {
  id: string
  kind: NodeKind
  width: number
  height: number
  childProcessId?: string
}
export interface HierEdgeInput {
  id: string
  from: string
  to: string
}

export interface HierarchyInput {
  rootProcessId: string
  nodesOf: (processId: string) => HierNodeInput[]
  edgesOf: (processId: string) => HierEdgeInput[]
  direction: Direction
  /** Alaprosessit avataan vain, kunnes solmuja on tämän verran, jotta valtavat mallit pysyvät käytettävinä. */
  maxNodes?: number
}

export interface HierarchyItem {
  id: string
  /** Ryhmän (alaprosessin) solmun tunniste. Puuttuu ylimmän tason solmuilta. */
  parentId?: string
  /** Sijainti suhteessa vanhempaan. */
  x: number
  y: number
  width: number
  height: number
  /** Alaprosessi, joka on avattu ryhmäksi. */
  group: boolean
  depth: number
}

export interface HierarchyLayout {
  /** Vanhemmat ennen lapsia (React Flow vaatii tämän järjestyksen). */
  items: HierarchyItem[]
  /** Reunojen reitit absoluuttisissa koordinaateissa. */
  routes: Map<string, Point[]>
  /** Avattujen ryhmien määrä. */
  groups: number
}

export const GROUP_PADDING = { top: 46, left: 20, bottom: 20, right: 20 }

function baseOptions(direction: Direction): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    'elk.separateConnectedComponents': 'true',
  }
}

export function buildHierarchyGraph(input: HierarchyInput): { graph: ElkNode; groups: number } {
  const vertical = input.direction === 'DOWN'
  const opened = new Set<string>()
  let budget = input.maxNodes ?? 800
  let groups = 0

  const leaf = (n: HierNodeInput): ElkNode => ({
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
  })

  const buildLevel = (
    processId: string,
    depth: number,
  ): { children: ElkNode[]; edges: ElkExtendedEdge[] } => {
    const nodes = input.nodesOf(processId)
    const ids = new Map(nodes.map((n) => [n.id, n]))
    const children: ElkNode[] = nodes.map((n) => {
      const childNodes =
        n.childProcessId && !opened.has(n.childProcessId) ? input.nodesOf(n.childProcessId) : []
      if (
        n.kind === 'subprocess' &&
        n.childProcessId &&
        childNodes.length > 0 &&
        budget - childNodes.length > 0 &&
        depth < 8
      ) {
        opened.add(n.childProcessId)
        budget -= childNodes.length
        groups++
        const inner = buildLevel(n.childProcessId, depth + 1)
        return {
          id: n.id,
          layoutOptions: {
            ...baseOptions(input.direction),
            'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`,
          },
          children: inner.children,
          edges: inner.edges,
        }
      }
      budget -= 1
      return leaf(n)
    })
    const isGroup = (id: string) => children.find((c) => c.id === id)?.children !== undefined
    const edges: ElkExtendedEdge[] = input
      .edgesOf(processId)
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        id: e.id,
        // Ryhmillä ei ole portteja: reuna liittyy ryhmän laitaan.
        sources: [isGroup(e.from) ? e.from : portOut(e.from)],
        targets: [isGroup(e.to) ? e.to : portIn(e.to)],
      }))
    return { children, edges }
  }

  const root = buildLevel(input.rootProcessId, 0)
  return {
    groups,
    graph: {
      id: 'root',
      layoutOptions: {
        ...baseOptions(input.direction),
        'elk.json.edgeCoords': 'ROOT',
        'elk.json.shapeCoords': 'PARENT',
      },
      children: root.children,
      edges: root.edges,
    },
  }
}

export async function layoutHierarchy(
  input: HierarchyInput,
  run: LayoutRunner,
): Promise<HierarchyLayout> {
  const { graph, groups } = buildHierarchyGraph(input)
  const items: HierarchyItem[] = []
  const routes = new Map<string, Point[]>()
  if ((graph.children ?? []).length === 0) return { items, routes, groups }
  const res = await run(graph)

  const walk = (node: ElkNode, parentId: string | undefined, depth: number) => {
    for (const c of node.children ?? []) {
      const group = (c.children?.length ?? 0) > 0
      items.push({
        id: c.id,
        parentId,
        x: c.x ?? 0,
        y: c.y ?? 0,
        width: c.width ?? 0,
        height: c.height ?? 0,
        group,
        depth,
      })
      if (group) walk(c, c.id, depth + 1)
    }
    for (const e of node.edges ?? []) {
      const sec = (e as ElkExtendedEdge).sections?.[0]
      if (sec)
        routes.set(
          e.id,
          [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({
            x: p.x,
            y: p.y,
          })),
        )
    }
  }
  walk(res, undefined, 0)
  return { items, routes, groups }
}
