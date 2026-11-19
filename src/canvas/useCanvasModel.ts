import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'
import { filterActive, matchNodes } from '../analysis/search'
import { useAnalysis } from '../analysis/useAnalysis'
import { computeLayout, type LayoutResult } from '../layout/elk'
import { layoutHierarchy, type HierarchyLayout } from '../layout/hierarchy'
import { layoutLanes, LANE } from '../layout/lanes'
import { workerRunner } from '../layout/runner'
import { entityColor } from '../model/flow'
import { descendantProcessIds } from '../model/operations'
import { edgesOf, nodesOf } from '../model/selectors'
import type { Point } from '../model/types'
import { useStore } from '../store/store'
import { useUi, type LayoutMode } from '../store/ui'
import { NODE_SIZE } from './geometry'
import type { LaneData } from './LaneView'
import type { NodeData } from './ProcessNodeView'
import type { RoutedEdgeData } from './RoutedEdge'

/** Palauttaa edellisen olion, jos se on sisällöltään sama: pitää viitteet vakaina, jolloin React Flow ei renderöi turhaan. */
function reuseStable<T extends { id: string }>(
  cache: Map<string, T>,
  next: T[],
  same: (a: T, b: T) => boolean,
): T[] {
  const out = next.map((n) => {
    const old = cache.get(n.id)
    return old && same(old, n) ? old : n
  })
  cache.clear()
  for (const o of out) cache.set(o.id, o)
  return out
}

const sameNode = (a: Node, b: Node) =>
  a.type === b.type &&
  a.parentId === b.parentId &&
  a.position.x === b.position.x &&
  a.position.y === b.position.y &&
  a.selected === b.selected &&
  a.width === b.width &&
  a.height === b.height &&
  a.draggable === b.draggable &&
  (a.data as NodeData).questions === (b.data as NodeData).questions &&
  (a.data as NodeData).dim === (b.data as NodeData).dim &&
  (a.data as LaneData).name === (b.data as LaneData).name

const sameEdge = (a: Edge, b: Edge) =>
  a.source === b.source &&
  a.target === b.target &&
  a.label === b.label &&
  a.selected === b.selected &&
  (a.data as RoutedEdgeData | undefined)?.points === (b.data as RoutedEdgeData | undefined)?.points

const MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const
const NO_LAYOUT: LayoutResult = { positions: new Map(), routes: new Map() }

export interface CanvasModel {
  nodes: Node[]
  edges: Edge[]
  /** Asettelu vastaa nykyistä rakennetta (vapaa ja kokonaiskuva lasketaan asynkronisesti). */
  ready: boolean
  structureKey: string
  /** Nykyisen prosessin solmut (vapaa ja uimaradat) tai kaikki avatut solmut (kokonaiskuva). */
  scopeCount: number
  mode: LayoutMode
  /** Prosessin omat solmut: tyhjän tilan tunnistukseen. */
  ownCount: number
}

/**
 * Kokoaa React Flow'n solmut ja reunat mallista valitun asettelutavan mukaan:
 * - free: ELK-asettelu, käsin siirretyt solmut lukittuna
 * - lanes: roolirivit, automaattinen
 * - overview: alaprosessit avattuina ryhmälaatikoiksi, automaattinen
 */
export function useCanvasModel(): CanvasModel {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const direction = useUi((s) => s.direction)
  const mode = useUi((s) => s.layoutMode)
  const filter = useUi((s) => s.filter)
  const analysis = useAnalysis()

  const [nodeCache] = useState(() => new Map<string, Node>())
  const [edgeCache] = useState(() => new Map<string, Edge>())

  // Käsiteltävät prosessit: kokonaiskuvassa kaikki alaprosessit mukana.
  const scopeIds = useMemo(
    () => (mode === 'overview' ? descendantProcessIds(project, processId) : [processId]),
    // Alaprosessien rakenne riippuu vaiheista, joten seurataan koko projektin solmuja.
    [mode, project, processId],
  )
  const scopeNodes = useMemo(
    () => scopeIds.flatMap((id) => nodesOf(project, id)),
    [scopeIds, project],
  )
  const scopeEdges = useMemo(
    () => scopeIds.flatMap((id) => edgesOf(project, id)),
    [scopeIds, project],
  )
  const ownCount = useMemo(() => nodesOf(project, processId).length, [project, processId])

  // Asettelu lasketaan uudelleen vain rakenteen muuttuessa, ei tekstin tai metatietojen muokkauksessa.
  const structureKey = useMemo(
    () =>
      JSON.stringify([
        mode,
        direction,
        scopeNodes.map((n) => [n.id, n.kind, mode === 'lanes' ? n.roleId : 0]),
        scopeEdges.map((e) => [e.from, e.to]),
      ]),
    [mode, direction, scopeNodes, scopeEdges],
  )

  // ---- Vapaa asettelu (ELK, worker) ----
  const [layout, setLayout] = useState<LayoutResult>(NO_LAYOUT)
  const [layoutKey, setLayoutKey] = useState('')
  useEffect(() => {
    if (mode !== 'free') return
    let cancelled = false
    computeLayout(
      {
        direction,
        nodes: scopeNodes.map((n) => ({ id: n.id, ...NODE_SIZE[n.kind] })),
        edges: scopeEdges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
      },
      workerRunner,
    )
      .then((res) => {
        if (cancelled) return
        setLayout(res)
        setLayoutKey(structureKey)
      })
      .catch((e: Error) => useStore.getState().setError(`Asettelu epäonnistui: ${e.message}`))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey])

  // ---- Kokonaiskuva (hierarkkinen ELK) ----
  const [hier, setHier] = useState<HierarchyLayout | null>(null)
  const [hierKey, setHierKey] = useState('')
  useEffect(() => {
    if (mode !== 'overview') return
    let cancelled = false
    layoutHierarchy(
      {
        rootProcessId: processId,
        direction,
        nodesOf: (id) =>
          nodesOf(project, id).map((n) => ({
            id: n.id,
            kind: n.kind,
            ...NODE_SIZE[n.kind],
            childProcessId: n.childProcessId,
          })),
        edgesOf: (id) => edgesOf(project, id).map((e) => ({ id: e.id, from: e.from, to: e.to })),
      },
      workerRunner,
    )
      .then((res) => {
        if (cancelled) return
        setHier(res)
        setHierKey(structureKey)
      })
      .catch((e: Error) => useStore.getState().setError(`Asettelu epäonnistui: ${e.message}`))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey])

  // ---- Uimaradat (suora laskenta) ----
  const lanes = useMemo(
    () =>
      mode === 'lanes'
        ? layoutLanes(
            scopeNodes.map((n) => ({ id: n.id, kind: n.kind, roleId: n.roleId })),
            scopeEdges.map((e) => ({ from: e.from, to: e.to })),
          )
        : null,
    [mode, scopeNodes, scopeEdges],
  )

  const dimmed = useMemo(() => {
    if (!filterActive(filter)) return null
    const match = new Set(
      matchNodes(project, filter, new Set(analysis.perNode.keys())).map((n) => n.id),
    )
    return new Set(scopeNodes.filter((n) => !match.has(n.id)).map((n) => n.id))
  }, [filter, project, analysis.perNode, scopeNodes])

  const selectedNodes = useMemo(() => new Set(selection.nodeIds), [selection.nodeIds])
  const selectedEdges = useMemo(() => new Set(selection.edgeIds), [selection.edgeIds])
  const lockedKey = useMemo(
    () =>
      scopeNodes
        .filter((n) => n.locked)
        .map((n) => n.id)
        .join(','),
    [scopeNodes],
  )

  const ready =
    mode === 'lanes'
      ? true
      : mode === 'overview'
        ? hierKey === structureKey
        : layoutKey === structureKey

  const nodes = useMemo<Node[]>(() => {
    const data = (id: string): NodeData => ({
      questions: analysis.perNode.get(id) ?? 0,
      dim: dimmed?.has(id) ?? false,
    })
    let built: Node[] = []

    if (mode === 'overview') {
      const byId = new Map(scopeNodes.map((n) => [n.id, n]))
      for (const item of hier?.items ?? []) {
        const n = byId.get(item.id)
        if (!n) continue
        built.push({
          id: item.id,
          type: item.group ? 'procgroup' : 'process',
          position: { x: item.x, y: item.y },
          parentId: item.parentId,
          selected: selectedNodes.has(item.id),
          width: item.width,
          height: item.height,
          draggable: false,
          data: data(item.id),
        })
      }
    } else if (mode === 'lanes' && lanes) {
      lanes.lanes.forEach((l) => {
        const role = l.roleId ? project.entities[l.roleId] : undefined
        built.push({
          id: `lane:${l.roleId ?? 'none'}`,
          type: 'lane',
          position: { x: 0, y: l.y },
          width: lanes.width,
          height: l.height,
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: -1,
          data: {
            name: role?.name ?? 'Ei roolia',
            color: entityColor(l.roleId ?? undefined),
            missing: l.roleId === null,
          } satisfies LaneData,
        })
      })
      for (const n of scopeNodes) {
        built.push({
          id: n.id,
          type: 'process',
          position: lanes.positions.get(n.id) ?? { x: LANE.labelWidth, y: 0 },
          selected: selectedNodes.has(n.id),
          width: NODE_SIZE[n.kind].width,
          height: NODE_SIZE[n.kind].height,
          draggable: false,
          data: data(n.id),
        })
      }
    } else {
      const preds = new Map<string, string>()
      for (const e of scopeEdges) if (!preds.has(e.to)) preds.set(e.to, e.from)
      built = scopeNodes.map((n): Node => {
        let pos: Point | undefined = n.locked ? n.position : undefined
        pos ??= layout.positions.get(n.id)
        if (!pos) {
          // Uusi solmu, jolle asettelua ei ole vielä laskettu: sijoita edeltäjän viereen.
          const pre = preds.get(n.id)
          const pp = pre
            ? project.nodes[pre]?.locked
              ? project.nodes[pre].position
              : layout.positions.get(pre)
            : undefined
          pos = pp ? { x: pp.x, y: pp.y + 120 } : { x: 0, y: 0 }
        }
        return {
          id: n.id,
          type: 'process',
          position: pos,
          selected: selectedNodes.has(n.id),
          width: NODE_SIZE[n.kind].width,
          height: NODE_SIZE[n.kind].height,
          data: data(n.id),
        }
      })
    }
    return reuseStable(nodeCache, built, sameNode)
  }, [
    mode,
    hier,
    lanes,
    layout,
    scopeNodes,
    scopeEdges,
    selectedNodes,
    project,
    analysis.perNode,
    dimmed,
    nodeCache,
  ])

  const edges = useMemo<Edge[]>(() => {
    const routes = mode === 'overview' ? hier?.routes : mode === 'free' ? layout.routes : undefined
    const routesValid =
      mode === 'overview'
        ? hierKey === structureKey
        : mode === 'free'
          ? layoutKey === structureKey
          : false
    const locked = new Set(lockedKey ? lockedKey.split(',') : [])
    const built = scopeEdges.map((e): Edge => {
      // Reitti on voimassa vain, jos asettelu on ajan tasalla eikä päätesolmuja ole siirretty käsin.
      const moved = mode === 'free' && (locked.has(e.from) || locked.has(e.to))
      const points = routesValid && !moved ? routes?.get(e.id) : undefined
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.label,
        type: 'routed',
        data: { points },
        selected: selectedEdges.has(e.id),
        markerEnd: MARKER,
        interactionWidth: 24,
      }
    })
    return reuseStable(edgeCache, built, sameEdge)
  }, [
    mode,
    hier,
    hierKey,
    layout,
    layoutKey,
    structureKey,
    scopeEdges,
    selectedEdges,
    lockedKey,
    edgeCache,
  ])

  return { nodes, edges, ready, structureKey, scopeCount: scopeNodes.length, mode, ownCount }
}
