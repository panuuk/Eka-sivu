import { createEdge, createNode, createProcess } from '../model/factory'
import {
  opsDeleteNodeBridging,
  opsDuplicateProcess,
  opsExpandNode,
  opsGroupIntoSubprocess,
  opsInsertAfter,
} from '../model/commands'
import type { NodePatch, Operation } from '../model/operations'
import { copyNodes, opsPaste, type Clip } from '../model/clipboard'
import { flowOrder } from '../model/flow'
import { incoming, nodesOf, outgoing } from '../model/selectors'
import type { NodeKind, Project } from '../model/types'
import { useStore } from './store'
import { useUi } from './ui'

/** Käyttöliittymän yhteiset toiminnot: kaavio, lista, työkalupalkki ja pikanäppäimet käyttävät samoja. */

const st = () => useStore.getState()

export interface InsertOptions {
  kind?: NodeKind
  label: string
  afterId?: string
  /** Uuden yhteyden nimi, jos liitoskohta on päätös. */
  edgeLabel?: string
  patch?: NodePatch
  /** Avaa nimen muokkauksen heti lisäyksen jälkeen. */
  edit?: boolean
  /** Ei siirrä valintaa eikä avaa ominaisuuspaneelia. */
  quiet?: boolean
}

/** Liitoskohta uudelle solmulle: annettu tai valittu solmu. Loppupisteen perään ei lisätä, vaan sen edelle. */
export function resolveAnchor(
  project: Project,
  processId: string,
  selection: { nodeIds: string[] },
  afterId?: string,
): string | undefined {
  let anchor = afterId ?? (selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined)
  if (anchor && project.nodes[anchor]?.processId !== processId) anchor = undefined
  if (anchor && project.nodes[anchor].kind === 'end') {
    const ins = incoming(project, anchor)
    anchor = ins.length === 1 ? ins[0].from : undefined
  }
  return anchor
}

/** Lisää solmun liitoskohdan jälkeen ja valitsee sen. Palauttaa uuden solmun tunnisteen. */
export function insertNode(opts: InsertOptions): string | undefined {
  const { project, currentProcessId, selection } = st()
  if (!project) return undefined
  // Kokonaiskuvassa valittu vaihe voi olla alaprosessissa: lisää sen omaan prosessiin.
  const picked = opts.afterId ?? (selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined)
  const pickedNode = picked ? project.nodes[picked] : undefined
  const processId =
    useUi.getState().layoutMode === 'overview' && pickedNode
      ? pickedNode.processId
      : currentProcessId
  const anchor = resolveAnchor(project, processId, selection, opts.afterId)
  const { ops, nodeId } = opsInsertAfter(project, processId, anchor, {
    label: opts.label,
    kind: opts.kind ?? 'step',
    edgeLabel: opts.edgeLabel,
  })
  if (opts.patch && Object.keys(opts.patch).length)
    ops.push({ type: 'updateNode', id: nodeId, patch: opts.patch })
  if (!st().dispatch(ops)) return undefined
  if (!opts.quiet) {
    st().select({ nodeIds: [nodeId], edgeIds: [] })
    useUi.getState().setRightOpen(true)
  }
  if (opts.edit) useUi.getState().setEditNode(nodeId)
  return nodeId
}

/** Lisää solmun valitun solmun jälkeen (tai itsenäisenä, jos mitään ei ole valittu) ja valitsee sen. */
export function addNode(
  kind: NodeKind = 'step',
  afterId?: string,
  label?: string,
): string | undefined {
  const defaults: Record<NodeKind, string> = {
    step: 'Uusi vaihe',
    decision: 'Uusi päätös?',
    start: 'Alku',
    end: 'Loppu',
    subprocess: 'Uusi alaprosessi',
  }
  return insertNode({ kind, afterId, label: label ?? defaults[kind], edit: !label })
}

/** Luo tyhjään prosessiin alun, ensimmäisen vaiheen ja lopun. */
export function startProcessSkeleton() {
  const { project, currentProcessId } = st()
  if (!project) return
  const start = createNode(currentProcessId, {
    kind: 'start',
    label: 'Alku',
    confidence: 'confirmed',
  })
  const step = createNode(currentProcessId, { label: 'Ensimmäinen vaihe' })
  const end = createNode(currentProcessId, { kind: 'end', label: 'Loppu', confidence: 'confirmed' })
  st().dispatch([
    { type: 'addNode', node: start },
    { type: 'addNode', node: step },
    { type: 'addNode', node: end },
    { type: 'addEdge', edge: createEdge(currentProcessId, start.id, step.id) },
    { type: 'addEdge', edge: createEdge(currentProcessId, step.id, end.id) },
  ])
  st().select({ nodeIds: [step.id], edgeIds: [] })
  useUi.getState().setEditNode(step.id)
}

export async function deleteSelection() {
  const { project, selection } = st()
  if (!project) return
  const ops: Operation[] = []
  const nodeIds = new Set(selection.nodeIds)
  const withChildren = selection.nodeIds.filter((id) => project.nodes[id]?.childProcessId)
  if (withChildren.length) {
    const names = withChildren.map((id) => `“${project.nodes[id].label}”`).join(', ')
    const ok = await useUi.getState().ask({
      title: 'Poistetaanko alaprosessi?',
      message: `${names} sisältää alaprosessin, joka poistetaan kaikkine vaiheineen. Voit kumota poiston (Ctrl+Z).`,
      confirmLabel: 'Poista',
      danger: true,
    })
    if (!ok) return
  }
  for (const id of selection.nodeIds) {
    // Siltaus lasketaan alkuperäisestä mallista; poistettavien naapureihin ei siltata.
    const bridged = opsDeleteNodeBridging(project, id).filter(
      (op) => op.type !== 'addEdge' || (!nodeIds.has(op.edge.from) && !nodeIds.has(op.edge.to)),
    )
    ops.push(...bridged)
  }
  for (const id of selection.edgeIds) {
    const e = project.edges[id]
    if (e && !nodeIds.has(e.from) && !nodeIds.has(e.to)) ops.push({ type: 'deleteEdge', id })
  }
  if (ops.length) st().dispatch(ops)
}

export function enterSubprocess(nodeId: string) {
  const { project } = st()
  const node = project?.nodes[nodeId]
  if (!node) return
  if (node.childProcessId) return st().setCurrentProcess(node.childProcessId)
  const { ops, processId } = opsExpandNode(project!, nodeId)
  if (st().dispatch(ops)) st().setCurrentProcess(processId)
}

export function groupSelection() {
  const { project, selection } = st()
  if (!project || selection.nodeIds.length < 2) return
  try {
    const { ops, processId } = opsGroupIntoSubprocess(
      project,
      selection.nodeIds,
      'Uusi alaprosessi',
    )
    if (st().dispatch(ops)) st().setCurrentProcess(processId)
  } catch (e) {
    st().setError((e as Error).message)
  }
}

export function addProcess(name = 'Uusi prosessi') {
  const { project } = st()
  if (!project) return
  const process = createProcess(name)
  if (st().dispatch({ type: 'addProcess', process })) st().setCurrentProcess(process.id)
}

export function duplicateProcess(processId: string) {
  const { project } = st()
  if (!project) return
  const { ops, processId: id } = opsDuplicateProcess(project, processId)
  if (st().dispatch(ops)) st().setCurrentProcess(id)
}

export async function deleteProcess(processId: string) {
  const { project } = st()
  const proc = project?.processes[processId]
  if (!project || !proc) return
  if (processId === project.rootProcessId) {
    st().setError('Päätason prosessia ei voi poistaa')
    return
  }
  const count = nodesOf(project, processId).length
  const ok = await useUi.getState().ask({
    title: `Poistetaanko “${proc.name}”?`,
    message: `Prosessi ja sen ${count} vaihetta (alaprosessit mukaan lukien) poistetaan. Voit kumota poiston (Ctrl+Z).`,
    confirmLabel: 'Poista',
    danger: true,
  })
  if (ok) st().dispatch({ type: 'deleteProcess', id: processId })
}

/** Vapauttaa käsin asetetut sijainnit, jolloin automaattinen asettelu ottaa vallan. */
export function releaseLayout(processId: string) {
  const { project } = st()
  if (!project) return
  const ops: Operation[] = nodesOf(project, processId)
    .filter((n) => n.locked)
    .map((n) => ({
      type: 'updateNode' as const,
      id: n.id,
      patch: { locked: undefined, position: undefined },
    }))
  st().dispatch(ops)
}

/** Siirtyy vaiheeseen: avaa sen prosessin, valitsee vaiheen ja keskittää kaavion siihen. */
export function goToNode(nodeId: string, view: 'canvas' | 'list' = 'canvas') {
  const { project } = st()
  const node = project?.nodes[nodeId]
  if (!node) return
  st().setCurrentProcess(node.processId)
  st().select({ nodeIds: [nodeId], edgeIds: [] })
  const ui = useUi.getState()
  if (ui.view === 'sources' || view === 'canvas') ui.setView(ui.view === 'list' ? 'list' : 'canvas')
  ui.setRightTab('props')
  ui.requestCenter(nodeId)
}

// --- Leikepöytä ---

let clip: Clip | null = null

export const hasClip = () => clip !== null

/** Kopioi valitut vaiheet (ei järjestelmän leikepöydälle, jottei tekstin kopiointi häiriinny). */
export function copySelection(): boolean {
  const { project, selection } = st()
  if (!project) return false
  const next = copyNodes(project, selection.nodeIds)
  if (!next) return false
  clip = next
  useUi.getState().setClipSize(next.nodes.length)
  return true
}

/** Liittää kopion nykyiseen prosessiin. Yksi valittu vaihe on liitoskohta. */
export function pasteSelection(): boolean {
  const { project, currentProcessId, selection } = st()
  if (!project || !clip) return false
  const picked = selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined
  const anchor = picked ? resolveAnchor(project, currentProcessId, selection, picked) : undefined
  const { ops, nodeIds } = opsPaste(project, clip, currentProcessId, anchor)
  if (!st().dispatch(ops)) return false
  st().select({ nodeIds, edgeIds: [] })
  nodeIds.forEach((id) => useUi.getState().requestReveal(id))
  return true
}

// --- Nuolinäppäinnavigointi ---

export type MoveDirection = 'next' | 'prev' | 'sibling-next' | 'sibling-prev'

/** Siirtää valinnan prosessin kulussa: eteen, taakse tai vaihtoehtoiseen haaraan. */
export function moveSelection(dir: MoveDirection): string | undefined {
  const { project, currentProcessId, selection } = st()
  if (!project) return undefined
  const current = selection.nodeIds.length === 1 ? project.nodes[selection.nodeIds[0]] : undefined
  let target: string | undefined
  if (!current) {
    // Ei valintaa: aloita prosessin alusta
    target = flowOrder(project, currentProcessId)[0]?.node.id
  } else if (dir === 'next') {
    target = outgoing(project, current.id)[0]?.to
  } else if (dir === 'prev') {
    target = incoming(project, current.id)[0]?.from
  } else {
    const parent = incoming(project, current.id)[0]?.from
    const siblings = parent
      ? outgoing(project, parent).map((e) => e.to)
      : nodesOf(project, current.processId)
          .filter((n) => incoming(project, n.id).length === 0)
          .map((n) => n.id)
    const i = siblings.indexOf(current.id)
    const step = dir === 'sibling-next' ? 1 : -1
    if (i >= 0 && siblings.length > 1)
      target = siblings[(i + step + siblings.length) % siblings.length]
  }
  if (!target || !project.nodes[target] || project.nodes[target].processId !== currentProcessId)
    return undefined
  st().select({ nodeIds: [target], edgeIds: [] })
  useUi.getState().requestReveal(target)
  return target
}
