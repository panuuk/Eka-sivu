import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FitViewOptions,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeLayout, type LayoutResult } from '../layout/elk'
import { workerRunner } from '../layout/runner'
import { createEdge } from '../model/factory'
import { edgesOf, nodesOf, outgoing } from '../model/selectors'
import type { Point } from '../model/types'
import {
  addNode,
  deleteSelection,
  groupSelection,
  releaseLayout,
  startProcessSkeleton,
} from '../store/actions'
import { useStore } from '../store/store'
import { useUi } from '../store/ui'
import { Icon } from '../ui/Icon'
import { NODE_SIZE } from './geometry'
import { ProcessNodeView, type NodeData } from './ProcessNodeView'
import { useAnalysis } from '../analysis/useAnalysis'
import { RoutedEdge, type RoutedEdgeData } from './RoutedEdge'

const nodeTypes = { process: ProcessNodeView }
const edgeTypes = { routed: RoutedEdge }
// Yläreunaan jätetään tilaa kelluvalle työkalupalkille.
const FIT_OPTIONS: FitViewOptions = {
  padding: { top: '84px', right: '32px', bottom: '32px', left: '32px' },
  maxZoom: 1.1,
}
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
  a.position.x === b.position.x &&
  a.position.y === b.position.y &&
  a.selected === b.selected &&
  a.width === b.width &&
  a.height === b.height &&
  (a.data as NodeData).questions === (b.data as NodeData).questions

const sameEdge = (a: Edge, b: Edge) =>
  a.source === b.source &&
  a.target === b.target &&
  a.label === b.label &&
  a.selected === b.selected &&
  (a.data as RoutedEdgeData | undefined)?.points === (b.data as RoutedEdgeData | undefined)?.points

const MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const
const NO_LAYOUT: LayoutResult = { positions: new Map(), routes: new Map() }

function CanvasInner() {
  const project = useStore((s) => s.project)!
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const direction = useUi((s) => s.direction)
  const { fitView } = useReactFlow()
  const analysis = useAnalysis()
  // Edellisten renderöintien oliot, joiden viitteet pidetään vakaina (kasvattaa vain muistia solmujen määrän verran).
  const [nodeCache] = useState(() => new Map<string, Node>())
  const [edgeCache] = useState(() => new Map<string, Edge>())

  const procNodes = useMemo(() => nodesOf(project, processId), [project, processId])
  const procEdges = useMemo(() => edgesOf(project, processId), [project, processId])

  // Asettelu lasketaan uudelleen vain rakenteen muuttuessa, ei tekstin tai metatietojen muokkauksessa.
  const structureKey = useMemo(
    () =>
      JSON.stringify([
        direction,
        procNodes.map((n) => [n.id, n.kind]),
        procEdges.map((e) => [e.from, e.to]),
      ]),
    [procNodes, procEdges, direction],
  )

  const [layout, setLayout] = useState<LayoutResult>(NO_LAYOUT)
  const [layoutKey, setLayoutKey] = useState('')
  const fitPending = useRef(true)
  const lastProcess = useRef(processId)

  useEffect(() => {
    if (lastProcess.current !== processId) {
      lastProcess.current = processId
      fitPending.current = true
    }
  }, [processId])

  useEffect(() => {
    let cancelled = false
    computeLayout(
      {
        direction,
        nodes: procNodes.map((n) => ({ id: n.id, ...NODE_SIZE[n.kind] })),
        edges: procEdges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
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

  const selectedNodeSet = useMemo(() => new Set(selection.nodeIds), [selection.nodeIds])
  const derivedNodes = useMemo<Node[]>(() => {
    const preds = new Map<string, string>()
    for (const e of procEdges) if (!preds.has(e.to)) preds.set(e.to, e.from)
    const built = procNodes.map((n): Node => {
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
        selected: selectedNodeSet.has(n.id),
        width: NODE_SIZE[n.kind].width,
        height: NODE_SIZE[n.kind].height,
        data: { questions: analysis.perNode.get(n.id) ?? 0 } satisfies NodeData,
      }
    })
    return reuseStable(nodeCache, built, sameNode)
  }, [procNodes, procEdges, layout, selectedNodeSet, project.nodes, analysis.perNode, nodeCache])

  // Täysin ohjattu malli: solmut tulevat mallista, ja vain vedon aikainen sijainti pidetään tässä. Näin React Flow
  // säilyttää solmujen mittaukset eikä reunoja piirretä uudelleen jokaisella muutoksella.
  const [dragPositions, setDragPositions] = useState<Map<string, Point>>(new Map())
  const nodes = useMemo(
    () =>
      dragPositions.size === 0
        ? derivedNodes
        : derivedNodes.map((n) => {
            const pos = dragPositions.get(n.id)
            return pos ? { ...n, position: pos } : n
          }),
    [derivedNodes, dragPositions],
  )
  const onNodesChange = useCallback<OnNodesChange<Node>>((changes) => {
    const moved = new Map<string, Point>()
    let selected: Set<string> | null = null
    for (const c of changes) {
      if (c.type === 'position' && c.position) moved.set(c.id, c.position)
      else if (c.type === 'select') {
        selected ??= new Set(useStore.getState().selection.nodeIds)
        if (c.selected) selected.add(c.id)
        else selected.delete(c.id)
      }
    }
    if (selected) useStore.getState().select({ nodeIds: [...selected] })
    if (moved.size) setDragPositions((prev) => new Map([...prev, ...moved]))
  }, [])

  const onEdgesChange = useCallback<OnEdgesChange<Edge>>((changes) => {
    let selected: Set<string> | null = null
    for (const c of changes) {
      if (c.type !== 'select') continue
      selected ??= new Set(useStore.getState().selection.edgeIds)
      if (c.selected) selected.add(c.id)
      else selected.delete(c.id)
    }
    if (selected) useStore.getState().select({ edgeIds: [...selected] })
  }, [])

  useEffect(() => {
    if (fitPending.current && layoutKey === structureKey && procNodes.length > 0) {
      fitPending.current = false
      requestAnimationFrame(() => fitView({ ...FIT_OPTIONS, duration: 250 }))
    }
  }, [layoutKey, structureKey, procNodes.length, fitView])

  const lockedKey = useMemo(
    () =>
      procNodes
        .filter((n) => n.locked)
        .map((n) => n.id)
        .join(','),
    [procNodes],
  )
  const selectedEdgeSet = useMemo(() => new Set(selection.edgeIds), [selection.edgeIds])
  const edges = useMemo<Edge[]>(() => {
    const routesValid = layoutKey === structureKey
    const locked = new Set(lockedKey ? lockedKey.split(',') : [])
    const built = procEdges.map((e): Edge => {
      // ELK:n reitti on voimassa vain, jos asettelu on ajan tasalla eikä päätesolmuja ole siirretty käsin.
      const moved = locked.has(e.from) || locked.has(e.to)
      const points = routesValid && !moved ? layout.routes.get(e.id) : undefined
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.label,
        type: 'routed',
        data: { points },
        selected: selectedEdgeSet.has(e.id),
        markerEnd: MARKER,
        interactionWidth: 24,
      }
    })
    return reuseStable(edgeCache, built, sameEdge)
  }, [procEdges, selectedEdgeSet, layout, layoutKey, structureKey, lockedKey, edgeCache])

  const onConnect = useCallback((c: Connection) => {
    const { project, currentProcessId, dispatch } = useStore.getState()
    if (!c.source || !c.target) return
    const src = project?.nodes[c.source]
    let label: string | undefined
    if (src?.kind === 'decision' && project) {
      const used = new Set(outgoing(project, src.id).map((e) => e.label))
      label = ['Kyllä', 'Ei'].find((l) => !used.has(l))
    }
    dispatch({ type: 'addEdge', edge: createEdge(currentProcessId, c.source, c.target, label) })
  }, [])

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      return !procEdges.some((e) => e.from === c.source && e.to === c.target)
    },
    [procEdges],
  )

  const onNodeDragStop = useCallback((_: unknown, __: Node, dragged: Node[]) => {
    const { dispatch } = useStore.getState()
    setDragPositions(new Map())
    dispatch(
      dragged.map((n) => ({
        type: 'updateNode' as const,
        id: n.id,
        patch: {
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
          locked: true,
        },
      })),
    )
  }, [])

  const hasLocked = procNodes.some((n) => n.locked)
  const empty = procNodes.length === 0

  return (
    <div className="canvas" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => useUi.getState().setEditNode(null)}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements={procNodes.length > 150}
        proOptions={{ hideAttribution: true }}
        aria-label="Prosessikaavio"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
        {procNodes.length > 12 && <MiniMap pannable zoomable ariaLabel="Pienoiskartta" />}
      </ReactFlow>

      <div className="canvas__toolbar" role="toolbar" aria-label="Kaavion työkalut">
        <button type="button" onClick={() => addNode('step')} title="Lisää vaihe (Enter)">
          <Icon name="plus" size={16} /> Vaihe
        </button>
        <button type="button" onClick={() => addNode('decision')} title="Lisää päätös">
          <Icon name="plus" size={16} /> Päätös
        </button>
        <button type="button" onClick={() => addNode('subprocess')} title="Lisää alaprosessi">
          <Icon name="plus" size={16} /> Alaprosessi
        </button>
        <span className="toolbar__sep" />
        <button
          type="button"
          onClick={groupSelection}
          disabled={selection.nodeIds.length < 2}
          title="Siirrä valitut vaiheet uudeksi alaprosessiksi"
        >
          <Icon name="group" size={16} /> Ryhmitä
        </button>
        <button
          type="button"
          onClick={() => void deleteSelection()}
          disabled={selection.nodeIds.length + selection.edgeIds.length === 0}
          title="Poista valinta (Delete)"
        >
          <Icon name="trash" size={16} /> Poista
        </button>
        <span className="toolbar__sep" />
        <button
          type="button"
          onClick={() => releaseLayout(processId)}
          disabled={!hasLocked}
          title="Vapauta käsin siirretyt sijainnit ja järjestä automaattisesti"
        >
          <Icon name="layout" size={16} /> Järjestä
        </button>
      </div>

      {empty && (
        <div className="canvas__empty">
          <h2>Tämä prosessi on vielä tyhjä</h2>
          <p>Aloita lisäämällä vaiheita, tai luo valmis runko alusta loppuun ja muokkaa sitä.</p>
          <div className="canvas__empty-actions">
            <button type="button" className="btn-primary" onClick={startProcessSkeleton}>
              Luo alku, vaihe ja loppu
            </button>
            <button type="button" onClick={() => addNode('step')}>
              Lisää yksi vaihe
            </button>
            <button type="button" onClick={() => useUi.getState().openQuick('add')}>
              Kirjoita tekstinä
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
