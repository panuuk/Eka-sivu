import { createEdge, createNode } from '../model/factory'
import { newId } from '../model/ids'
import type { Operation } from '../model/operations'
import { incoming, nodesOf, outgoing } from '../model/selectors'
import type { Project, ProcessNode } from '../model/types'
import type { Gap } from './gaps'

/** Operaatiot, joilla aukkoja korjataan. Ne ovat tavallisia malliin kohdistuvia operaatioita (kumottavissa). */

export function opsConnect(p: Project, fromId: string, toId: string, label?: string): Operation[] {
  const from = p.nodes[fromId]
  const to = p.nodes[toId]
  if (!from || !to || fromId === toId || from.processId !== to.processId) return []
  if (Object.values(p.edges).some((e) => e.from === fromId && e.to === toId)) return []
  return [{ type: 'addEdge', edge: createEdge(from.processId, fromId, toId, label) }]
}

/** Lisää prosessille alkupisteen ja yhdistää sen solmuihin, joihin ei tule yhteyttä. */
export function opsAddStart(p: Project, processId: string): Operation[] {
  const nodes = nodesOf(p, processId).filter((n) => n.kind !== 'start')
  if (nodesOf(p, processId).some((n) => n.kind === 'start') || nodes.length === 0) return []
  const start = createNode(processId, { kind: 'start', label: 'Alku', confidence: 'confirmed' })
  let roots = nodes.filter((n) => incoming(p, n.id).length === 0)
  if (roots.length === 0) roots = [nodes[0]] // pelkkää sykliä: aloita ensimmäisestä
  return [
    { type: 'addNode', node: start },
    ...roots.map((r): Operation => ({
      type: 'addEdge',
      edge: createEdge(processId, start.id, r.id),
    })),
  ]
}

/** Lisää prosessille loppupisteen ja yhdistää siihen solmut, joista ei lähde yhteyttä. */
export function opsAddEnd(p: Project, processId: string): Operation[] {
  const nodes = nodesOf(p, processId).filter((n) => n.kind !== 'end')
  if (nodesOf(p, processId).some((n) => n.kind === 'end') || nodes.length === 0) return []
  const end = createNode(processId, { kind: 'end', label: 'Loppu', confidence: 'confirmed' })
  const tails = nodes.filter((n) => outgoing(p, n.id).length === 0)
  return [
    { type: 'addNode', node: end },
    ...tails.map((t): Operation => ({
      type: 'addEdge',
      edge: createEdge(processId, t.id, end.id),
    })),
  ]
}

/** Yhdistää umpikujan vaiheen prosessin loppuun (luo loppupisteen tarvittaessa). */
export function opsConnectToEnd(p: Project, nodeId: string): Operation[] {
  const node = p.nodes[nodeId]
  if (!node) return []
  const end = nodesOf(p, node.processId).find((n) => n.kind === 'end')
  if (end) return opsConnect(p, nodeId, end.id)
  const created = createNode(node.processId, {
    kind: 'end',
    label: 'Loppu',
    confidence: 'confirmed',
  })
  return [
    { type: 'addNode', node: created },
    { type: 'addEdge', edge: createEdge(node.processId, nodeId, created.id) },
  ]
}

/** Lisää päätökselle uuden haaran, jonka päässä on uusi vaihe. */
export function opsAddBranch(
  p: Project,
  decisionId: string,
  stepLabel: string,
  edgeLabel?: string,
): { ops: Operation[]; nodeId: string } | null {
  const d = p.nodes[decisionId]
  if (!d) return null
  const used = new Set(outgoing(p, decisionId).map((e) => e.label))
  const label = edgeLabel?.trim() || ['Kyllä', 'Ei'].find((l) => !used.has(l)) || undefined
  const node = createNode(d.processId, { label: stepLabel.trim() || 'Uusi vaihe' })
  return {
    nodeId: node.id,
    ops: [
      { type: 'addNode', node },
      { type: 'addEdge', edge: createEdge(d.processId, decisionId, node.id, label) },
    ],
  }
}

/** Yhdistää kaksi vaihetta yhdeksi: reunat ja tiedot siirretään säilytettävälle, poistettava poistuu. */
export function opsMergeNodes(p: Project, keepId: string, dropId: string): Operation[] {
  const keep = p.nodes[keepId]
  const drop = p.nodes[dropId]
  if (!keep || !drop || keepId === dropId || keep.processId !== drop.processId) return []
  const ops: Operation[] = []
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])]
  const patch: Partial<ProcessNode> = {}
  if (!keep.roleId && drop.roleId) patch.roleId = drop.roleId
  const systems = union(keep.systemIds, drop.systemIds)
  if (systems.length !== keep.systemIds.length) patch.systemIds = systems
  const inputs = union(keep.inputIds, drop.inputIds)
  if (inputs.length !== keep.inputIds.length) patch.inputIds = inputs
  const outputs = union(keep.outputIds, drop.outputIds)
  if (outputs.length !== keep.outputIds.length) patch.outputIds = outputs
  const rank = { guess: 0, likely: 1, confirmed: 2 } as const
  if (rank[drop.confidence] > rank[keep.confidence]) patch.confidence = drop.confidence
  const refs = [...keep.sources]
  for (const r of drop.sources) {
    if (!refs.some((x) => x.sourceId === r.sourceId && x.start === r.start && x.end === r.end))
      refs.push(r)
  }
  if (refs.length !== keep.sources.length) patch.sources = refs
  if (drop.description && !keep.description?.includes(drop.description)) {
    patch.description = keep.description
      ? `${keep.description}\n${drop.description}`
      : drop.description
  }
  if (!keep.childProcessId && drop.childProcessId) {
    // Alaprosessi siirtyy säilytettävälle.
    ops.push({ type: 'updateNode', id: dropId, patch: { childProcessId: undefined, kind: 'step' } })
    patch.childProcessId = drop.childProcessId
    patch.kind = 'subprocess'
    ops.push({ type: 'updateProcess', id: drop.childProcessId, patch: { parentNodeId: keepId } })
  }
  if (Object.keys(patch).length) ops.push({ type: 'updateNode', id: keepId, patch })

  // Reunat: ohjaa poistettavan reunat säilytettävälle, ohita itsesilmukat ja kaksoiskappaleet.
  const has = (from: string, to: string) =>
    Object.values(p.edges).some((e) => e.from === from && e.to === to) ||
    ops.some((o) => o.type === 'addEdge' && o.edge.from === from && o.edge.to === to)
  for (const e of Object.values(p.edges)) {
    if (e.from === dropId && e.to !== keepId && !has(keepId, e.to)) {
      ops.push({ type: 'addEdge', edge: { ...e, id: newId('e'), from: keepId } })
    } else if (e.to === dropId && e.from !== keepId && !has(e.from, keepId)) {
      ops.push({ type: 'addEdge', edge: { ...e, id: newId('e'), to: keepId } })
    }
  }
  ops.push({ type: 'deleteNode', id: dropId })
  return ops
}

/** Tallentaa päätöksen ohittaa aukko. Ohitus perustuu aukon avaimeen. */
export function opsDismissGap(gap: Gap): Operation[] {
  return [
    {
      type: 'addQuestion',
      question: {
        id: newId('q'),
        processId: gap.processId,
        ...(gap.targetId ? { targetId: gap.targetId } : {}),
        rule: gap.rule,
        text: gap.text,
        status: 'dismissed',
        key: gap.key,
      },
    },
  ]
}

export function opsRestoreGap(p: Project, key: string): Operation[] {
  return Object.values(p.questions)
    .filter((q) => q.rule !== 'custom' && q.key === key)
    .map((q): Operation => ({ type: 'deleteQuestion', id: q.id }))
}
