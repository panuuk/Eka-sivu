import { NODE_SIZE } from '../canvas/geometry'
import { layoutHierarchy, type HierarchyLayout } from '../layout/hierarchy'
import type { LayoutRunner } from '../layout/elk'
import { descendantProcessIds } from '../model/operations'
import { edgesOf, nodesOf } from '../model/selectors'
import type { Confidence, NodeKind, Point, Project } from '../model/types'
import type { Direction } from '../store/ui'

/**
 * Renderöintigraafi: malli suodatettuna ja asetteluineen. Esitystila ja kaikki viennit käyttävät samaa,
 * joten "mitä näet on mitä viet".
 */

export interface RenderOptions {
  processId: string
  /** Avaa alaprosessit ryhmiksi samaan kuvaan. */
  expand: boolean
  /** Näytä vain vahvistetut vaiheet (alku ja loppu aina). Piilotettujen yli yhdistetään. */
  onlyConfirmed: boolean
  direction: Direction
}

export const DEFAULT_RENDER: Omit<RenderOptions, 'processId'> = {
  expand: false,
  onlyConfirmed: false,
  direction: 'DOWN',
}

export interface RNode {
  id: string
  processId: string
  kind: NodeKind
  label: string
  roleId?: string
  roleName?: string
  systems: string[]
  inputs: string[]
  outputs: string[]
  description?: string
  confidence: Confidence
  /** Alaprosessi, joka on avattu ryhmäksi. */
  group: boolean
  parentId?: string
  /** Absoluuttinen sijainti ja koko. */
  x: number
  y: number
  w: number
  h: number
  /** Tämä vaihe on alaprosessi, jolla on sisältöä (avattavissa). */
  hasChild: boolean
}

export interface REdge {
  id: string
  from: string
  to: string
  label?: string
  points: Point[]
}

export interface RenderGraph {
  nodes: RNode[]
  edges: REdge[]
  width: number
  height: number
}

interface VNode {
  id: string
  kind: NodeKind
  childProcessId?: string
  w: number
  h: number
}
interface VEdge {
  id: string
  from: string
  to: string
  label?: string
}

/** Suodattaa prosessin solmut ja yhdistää piilotettujen yli, jottei virta katkea. */
export function filterProcess(
  p: Project,
  processId: string,
  onlyConfirmed: boolean,
): { nodes: VNode[]; edges: VEdge[] } {
  const all = nodesOf(p, processId)
  const keep = (id: string) => {
    const n = p.nodes[id]
    return !onlyConfirmed || n.kind === 'start' || n.kind === 'end' || n.confidence === 'confirmed'
  }
  const nodes: VNode[] = all
    .filter((n) => keep(n.id))
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      childProcessId: n.childProcessId,
      w: NODE_SIZE[n.kind].width,
      h: NODE_SIZE[n.kind].height,
    }))
  const edges = edgesOf(p, processId)
  if (!onlyConfirmed)
    return {
      nodes,
      edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label })),
    }

  const out = new Map<string, { to: string; label?: string }[]>()
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, [])
    out.get(e.from)!.push({ to: e.to, label: e.label })
  }
  const visible = new Set(nodes.map((n) => n.id))
  const result: VEdge[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    for (const first of out.get(n.id) ?? []) {
      // Seuraa piilotettuja solmuja kunnes löytyy näkyvä
      const stack = [first.to]
      const visited = new Set<string>()
      while (stack.length) {
        const cur = stack.pop()!
        if (visited.has(cur)) continue
        visited.add(cur)
        if (visible.has(cur)) {
          const key = `${n.id}>${cur}`
          if (cur !== n.id && !seen.has(key)) {
            seen.add(key)
            result.push({ id: `bridge:${key}`, from: n.id, to: cur, label: first.label })
          }
        } else {
          for (const nx of out.get(cur) ?? []) stack.push(nx.to)
        }
      }
    }
  }
  return { nodes, edges: result }
}

export async function buildRenderGraph(
  p: Project,
  opts: RenderOptions,
  run: LayoutRunner,
): Promise<RenderGraph> {
  const filtered = new Map<string, { nodes: VNode[]; edges: VEdge[] }>()
  const level = (id: string) => {
    let f = filtered.get(id)
    if (!f) {
      f = filterProcess(p, id, opts.onlyConfirmed)
      filtered.set(id, f)
    }
    return f
  }

  const layout: HierarchyLayout = await layoutHierarchy(
    {
      rootProcessId: opts.processId,
      direction: opts.direction,
      expand: opts.expand,
      nodesOf: (id) =>
        level(id).nodes.map((n) => ({
          id: n.id,
          kind: n.kind,
          width: n.w,
          height: n.h,
          childProcessId: n.childProcessId,
        })),
      edgesOf: (id) => level(id).edges,
    },
    run,
  )

  // Vanhempien offsetit → absoluuttiset sijainnit
  const byId = new Map(layout.items.map((i) => [i.id, i]))
  const abs = new Map<string, Point>()
  const resolve = (id: string): Point => {
    const cached = abs.get(id)
    if (cached) return cached
    const it = byId.get(id)!
    const base = it.parentId ? resolve(it.parentId) : { x: 0, y: 0 }
    const v = { x: base.x + it.x, y: base.y + it.y }
    abs.set(id, v)
    return v
  }

  const scope = new Set(opts.expand ? descendantProcessIds(p, opts.processId) : [opts.processId])
  const nodes: RNode[] = []
  for (const item of layout.items) {
    const n = p.nodes[item.id]
    if (!n || !scope.has(n.processId)) continue
    const pos = resolve(item.id)
    const name = (id?: string) => (id ? p.entities[id]?.name : undefined)
    nodes.push({
      id: n.id,
      processId: n.processId,
      kind: n.kind,
      label: n.label,
      roleId: n.roleId,
      roleName: name(n.roleId),
      systems: n.systemIds.map((i) => name(i)).filter(Boolean) as string[],
      inputs: n.inputIds.map((i) => name(i)).filter(Boolean) as string[],
      outputs: n.outputIds.map((i) => name(i)).filter(Boolean) as string[],
      description: n.description,
      confidence: n.confidence,
      group: item.group,
      parentId: item.parentId,
      x: pos.x,
      y: pos.y,
      w: item.width,
      h: item.height,
      hasChild: !!n.childProcessId && nodesOf(p, n.childProcessId).length > 0,
    })
  }

  const edges: REdge[] = []
  const edgeMeta = new Map<string, VEdge>()
  for (const id of scope) for (const e of level(id).edges) edgeMeta.set(e.id, e)
  for (const [id, points] of layout.routes) {
    const e = edgeMeta.get(id)
    if (e && points.length >= 2) edges.push({ id, from: e.from, to: e.to, label: e.label, points })
  }

  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  for (const e of edges)
    for (const pt of e.points) {
      maxX = Math.max(maxX, pt.x)
      maxY = Math.max(maxY, pt.y)
    }
  return { nodes, edges, width: maxX, height: maxY }
}
