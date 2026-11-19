import {
  Background,
  BackgroundVariant,
  Controls,
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
import { createEdge } from '../model/factory'
import { outgoing } from '../model/selectors'
import type { Point } from '../model/types'
import { FilterBar } from '../panels/FilterBar'
import {
  addNode,
  deleteSelection,
  groupSelection,
  releaseLayout,
  startProcessSkeleton,
} from '../store/actions'
import { useStore } from '../store/store'
import { useUi, type LayoutMode } from '../store/ui'
import { Icon } from '../ui/Icon'
import { LaneView } from './LaneView'
import { ProcessGroupView } from './ProcessGroupView'
import { ProcessNodeView } from './ProcessNodeView'
import { RoutedEdge } from './RoutedEdge'
import { useCanvasModel } from './useCanvasModel'

const nodeTypes = { process: ProcessNodeView, procgroup: ProcessGroupView, lane: LaneView }
const edgeTypes = { routed: RoutedEdge }
// Yläreunaan jätetään tilaa kelluvalle työkalupalkille.
const FIT_OPTIONS: FitViewOptions = {
  padding: { top: '84px', right: '32px', bottom: '32px', left: '32px' },
  maxZoom: 1.1,
}

const MODE_LABEL: Record<LayoutMode, string> = {
  free: 'Vapaa',
  lanes: 'Uimaradat',
  overview: 'Kokonaiskuva',
}

const MODE_HINT: Record<LayoutMode, string> = {
  free: '',
  lanes: 'Uimaradat: vaiheet roolin mukaan riveillä. Asettelu on automaattinen.',
  overview: 'Kokonaiskuva: kaikki alaprosessit auki. Asettelu on automaattinen.',
}

function CanvasInner() {
  const processId = useStore((s) => s.currentProcessId)
  const selection = useStore((s) => s.selection)
  const project = useStore((s) => s.project)!
  const { fitView } = useReactFlow()
  const model = useCanvasModel()
  const { mode } = model
  const editable = mode === 'free'

  const fitPending = useRef(true)
  const lastFitKey = useRef('')

  // Sovita näkymä uudelleen, kun prosessi tai asettelutapa vaihtuu.
  const fitKey = `${processId}|${mode}`
  useEffect(() => {
    if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey
      fitPending.current = true
    }
  }, [fitKey])

  // Täysin ohjattu malli: solmut tulevat mallista, ja vain vedon aikainen sijainti pidetään tässä. Näin React Flow
  // säilyttää solmujen mittaukset eikä reunoja piirretä uudelleen jokaisella muutoksella.
  const [dragPositions, setDragPositions] = useState<Map<string, Point>>(new Map())
  const nodes = useMemo(
    () =>
      dragPositions.size === 0
        ? model.nodes
        : model.nodes.map((n) => {
            const pos = dragPositions.get(n.id)
            return pos ? { ...n, position: pos } : n
          }),
    [model.nodes, dragPositions],
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
    if (fitPending.current && model.ready && model.scopeCount > 0) {
      fitPending.current = false
      requestAnimationFrame(() => fitView({ ...FIT_OPTIONS, duration: 250 }))
    }
  }, [model.ready, model.structureKey, model.scopeCount, fitView])

  // Keskitä kaavio pyydettyyn vaiheeseen, kun asettelu on valmis.
  const centerRequest = useUi((s) => s.centerRequest)
  useEffect(() => {
    if (!centerRequest || !model.ready) return
    if (!model.nodes.some((n) => n.id === centerRequest.nodeId)) return
    useUi.getState().clearCenterRequest()
    fitPending.current = false
    requestAnimationFrame(() =>
      fitView({
        nodes: [{ id: centerRequest.nodeId }],
        duration: 350,
        maxZoom: 1.1,
        padding: '45%',
      }),
    )
  }, [centerRequest, model.ready, model.nodes, fitView])

  const onConnect = useCallback((c: Connection) => {
    const { project, currentProcessId, dispatch } = useStore.getState()
    if (!c.source || !c.target) return
    const src = project?.nodes[c.source]
    let label: string | undefined
    if (src?.kind === 'decision' && project) {
      const used = new Set(outgoing(project, src.id).map((e) => e.label))
      label = ['Kyllä', 'Ei'].find((l) => !used.has(l))
    }
    // Kokonaiskuvassa solmut voivat olla alaprosessissa: reuna kuuluu lähtösolmun prosessiin.
    dispatch({
      type: 'addEdge',
      edge: createEdge(src?.processId ?? currentProcessId, c.source, c.target, label),
    })
  }, [])

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      const a = project.nodes[c.source]
      const b = project.nodes[c.target]
      // Reunat kulkevat vain saman prosessin sisällä.
      if (!a || !b || a.processId !== b.processId) return false
      return !model.edges.some((e) => e.source === c.source && e.target === c.target)
    },
    [model.edges, project.nodes],
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

  const hasLocked = useMemo(
    () => Object.values(project.nodes).some((n) => n.processId === processId && n.locked),
    [project.nodes, processId],
  )
  const empty = model.ownCount === 0

  return (
    <div className="canvas" data-testid="canvas" data-mode={mode}>
      <ReactFlow
        nodes={nodes}
        edges={model.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => useUi.getState().setEditNode(null)}
        nodesDraggable={editable}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements={model.scopeCount > 150}
        proOptions={{ hideAttribution: true }}
        aria-label="Prosessikaavio"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
        {model.scopeCount > 12 && <MiniMap pannable zoomable ariaLabel="Pienoiskartta" />}
      </ReactFlow>

      <FilterBar className="canvas__filter" />
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
          disabled={!hasLocked || !editable}
          title="Vapauta käsin siirretyt sijainnit ja järjestä automaattisesti"
        >
          <Icon name="layout" size={16} /> Järjestä
        </button>
      </div>

      <div className="canvas__mode" role="radiogroup" aria-label="Asettelu">
        {(Object.keys(MODE_LABEL) as LayoutMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? 'is-on' : ''}
            onClick={() => useUi.getState().setLayoutMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {MODE_HINT[mode] && <p className="canvas__hint">{MODE_HINT[mode]}</p>}

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
