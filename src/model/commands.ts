import { createEdge, createEntity, createNode, createProcess } from './factory'
import { newId } from './ids'
import { descendantProcessIds, type Operation } from './operations'
import { findEntity, incoming, normalizeName, outgoing } from './selectors'
import type { Entity, EntityKind, NodeKind, Process, Project } from './types'

/** Korkeamman tason komennot, jotka rakentavat operaatiolistoja mallin nykytilan perusteella. */

/** Lisää vaiheen annetun solmun jälkeen. Jos `afterId` on jo kytketty eteenpäin, uusi solmu lisätään väliin. */
export function opsInsertAfter(
  p: Project,
  processId: string,
  afterId: string | undefined,
  init: { label: string; kind?: NodeKind },
): { ops: Operation[]; nodeId: string } {
  const node = createNode(processId, { label: init.label, kind: init.kind ?? 'step' })
  const ops: Operation[] = [{ type: 'addNode', node }]
  if (afterId && p.nodes[afterId]) {
    const outs = outgoing(p, afterId)
    // Päätöksen perään lisätään haara, muille vaiheille uusi solmu lisätään väliin.
    const after = p.nodes[afterId]
    if (after.kind !== 'decision' && outs.length === 1) {
      const old = outs[0]
      ops.push({ type: 'deleteEdge', id: old.id })
      ops.push({ type: 'addEdge', edge: createEdge(processId, afterId, node.id, undefined) })
      ops.push({ type: 'addEdge', edge: createEdge(processId, node.id, old.to, old.label) })
    } else {
      // Päätöksen uudet haarat nimetään automaattisesti (Kyllä, Ei) niiltä osin kuin nimet ovat vapaina.
      let label: string | undefined
      if (after.kind === 'decision') {
        const used = new Set(outs.map((o) => o.label))
        label = ['Kyllä', 'Ei'].find((l) => !used.has(l))
      }
      ops.push({ type: 'addEdge', edge: createEdge(processId, afterId, node.id, label) })
    }
  }
  return { ops, nodeId: node.id }
}

/** Poistaa solmun ja yhdistää sen edeltäjät seuraajiin (jos selkeä), jottei prosessi katkea. */
export function opsDeleteNodeBridging(p: Project, nodeId: string): Operation[] {
  const node = p.nodes[nodeId]
  if (!node) return []
  const ins = incoming(p, nodeId)
  const outs = outgoing(p, nodeId)
  const ops: Operation[] = [{ type: 'deleteNode', id: nodeId }]
  // Siltaus vain kun solmulla on täsmälleen yksi seuraaja tai yksi edeltäjä, muuten tulos olisi arvausta.
  if (ins.length >= 1 && outs.length === 1) {
    const to = outs[0].to
    for (const i of ins) {
      const exists = Object.values(p.edges).some((e) => e.from === i.from && e.to === to)
      if (i.from !== to && !exists) {
        ops.push({ type: 'addEdge', edge: createEdge(node.processId, i.from, to, i.label) })
      }
    }
  } else if (ins.length === 1 && outs.length > 1) {
    for (const o of outs) {
      const exists = Object.values(p.edges).some((e) => e.from === ins[0].from && e.to === o.to)
      if (!exists)
        ops.push({ type: 'addEdge', edge: createEdge(node.processId, ins[0].from, o.to, o.label) })
    }
  }
  return ops
}

/** Avaa vaiheen omaksi alaprosessikseen. Alaprosessiin luodaan alku- ja loppupiste. */
export function opsExpandNode(p: Project, nodeId: string): { ops: Operation[]; processId: string } {
  const node = p.nodes[nodeId]
  if (!node) throw new Error('Solmua ei löydy')
  if (node.childProcessId) return { ops: [], processId: node.childProcessId }
  const child = createProcess(node.label, nodeId)
  const start = createNode(child.id, { label: 'Alku', kind: 'start', confidence: 'confirmed' })
  const end = createNode(child.id, { label: 'Loppu', kind: 'end', confidence: 'confirmed' })
  const ops: Operation[] = [
    { type: 'addProcess', process: child },
    { type: 'updateNode', id: nodeId, patch: { kind: 'subprocess', childProcessId: child.id } },
    { type: 'addNode', node: start },
    { type: 'addNode', node: end },
    { type: 'addEdge', edge: createEdge(child.id, start.id, end.id) },
  ]
  return { ops, processId: child.id }
}

/**
 * Siirtää valitut vaiheet uudeksi alaprosessiksi. Valinnan on oltava yhtenäinen niin,
 * että siihen tulee sisään ja siitä lähtee vähintään yksi reuna (tai se alkaa/loppuu prosessin reunalle).
 */
export function opsGroupIntoSubprocess(
  p: Project,
  nodeIds: string[],
  name: string,
): { ops: Operation[]; processId: string; nodeId: string } {
  const ids = new Set(nodeIds)
  const members = nodeIds.map((id) => p.nodes[id]).filter(Boolean)
  if (members.length < 2) throw new Error('Valitse vähintään kaksi vaihetta')
  const processId = members[0].processId
  if (members.some((m) => m.processId !== processId))
    throw new Error('Valinnan on oltava samasta prosessista')
  if (members.some((m) => m.kind === 'start' || m.kind === 'end')) {
    throw new Error('Alku- ja loppupistettä ei voi siirtää alaprosessiin')
  }
  const edges = Object.values(p.edges).filter((e) => e.processId === processId)
  const inner = edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  const inbound = edges.filter((e) => !ids.has(e.from) && ids.has(e.to))
  const outbound = edges.filter((e) => ids.has(e.from) && !ids.has(e.to))

  const parent = createNode(processId, { label: name, kind: 'subprocess', confidence: 'likely' })
  const child = createProcess(name, parent.id)
  const start = createNode(child.id, { label: 'Alku', kind: 'start', confidence: 'confirmed' })
  const end = createNode(child.id, { label: 'Loppu', kind: 'end', confidence: 'confirmed' })

  const ops: Operation[] = [
    { type: 'addNode', node: parent },
    { type: 'addProcess', process: child },
    { type: 'updateNode', id: parent.id, patch: { childProcessId: child.id } },
    { type: 'addNode', node: start },
    { type: 'addNode', node: end },
  ]
  // Siirrä solmut: luo kopiot uuteen prosessiin ja poista vanhat (alaprosessit siirtyvät mukana).
  const idMap = new Map<string, string>()
  for (const m of members) {
    const copy = { ...m, id: newId('n'), processId: child.id, childProcessId: undefined }
    delete copy.childProcessId
    idMap.set(m.id, copy.id)
    ops.push({ type: 'addNode', node: copy })
  }
  for (const m of members) {
    if (m.childProcessId) {
      // Alaprosessi ei saa poistua solmun mukana: irrota ennen poistoa ja liitä kopioon.
      ops.push({ type: 'updateNode', id: m.id, patch: { childProcessId: undefined, kind: 'step' } })
      ops.push({
        type: 'updateNode',
        id: idMap.get(m.id)!,
        patch: { childProcessId: m.childProcessId },
      })
      ops.push({
        type: 'updateProcess',
        id: m.childProcessId,
        patch: { parentNodeId: idMap.get(m.id)! },
      })
    }
  }
  for (const m of members) ops.push({ type: 'deleteNode', id: m.id })
  for (const e of inner) {
    ops.push({
      type: 'addEdge',
      edge: createEdge(child.id, idMap.get(e.from)!, idMap.get(e.to)!, e.label),
    })
  }
  // Alaprosessin sisäinen alku/loppu: alkuun solmut, joihin ei tule reunaa sisältä, loppuun joista ei lähde.
  const hasIn = new Set(inner.map((e) => e.to))
  const hasOut = new Set(inner.map((e) => e.from))
  for (const m of members) {
    if (!hasIn.has(m.id))
      ops.push({ type: 'addEdge', edge: createEdge(child.id, start.id, idMap.get(m.id)!) })
    if (!hasOut.has(m.id))
      ops.push({ type: 'addEdge', edge: createEdge(child.id, idMap.get(m.id)!, end.id) })
  }
  // Ulkoiset reunat yhdistetään uuteen alaprosessisolmuun.
  const seenIn = new Set<string>()
  for (const e of inbound) {
    if (seenIn.has(e.from)) continue
    seenIn.add(e.from)
    ops.push({ type: 'addEdge', edge: createEdge(processId, e.from, parent.id, e.label) })
  }
  const seenOut = new Set<string>()
  for (const e of outbound) {
    if (seenOut.has(e.to)) continue
    seenOut.add(e.to)
    ops.push({ type: 'addEdge', edge: createEdge(processId, parent.id, e.to, e.label) })
  }
  return { ops, processId: child.id, nodeId: parent.id }
}

/** Kopioi prosessin (ja sen alaprosessit) uudeksi päätason prosessiksi. */
export function opsDuplicateProcess(
  p: Project,
  processId: string,
): { ops: Operation[]; processId: string } {
  const src = p.processes[processId]
  if (!src) throw new Error('Prosessia ei löydy')
  const ops: Operation[] = []
  const copyProcess = (srcId: string, name: string, parentNodeId?: string): string => {
    const proc: Process = { ...p.processes[srcId], id: newId('p'), name }
    delete proc.parentNodeId
    if (parentNodeId) proc.parentNodeId = parentNodeId
    ops.push({ type: 'addProcess', process: proc })
    const idMap = new Map<string, string>()
    const nodes = Object.values(p.nodes).filter((n) => n.processId === srcId)
    for (const n of nodes) idMap.set(n.id, newId('n'))
    for (const n of nodes) {
      const copy = {
        ...n,
        id: idMap.get(n.id)!,
        processId: proc.id,
        childProcessId: undefined as string | undefined,
      }
      delete copy.childProcessId
      ops.push({ type: 'addNode', node: copy })
    }
    for (const n of nodes) {
      if (n.childProcessId && p.processes[n.childProcessId]) {
        const childId = copyProcess(
          n.childProcessId,
          p.processes[n.childProcessId].name,
          idMap.get(n.id),
        )
        ops.push({ type: 'updateNode', id: idMap.get(n.id)!, patch: { childProcessId: childId } })
      }
    }
    for (const e of Object.values(p.edges).filter((x) => x.processId === srcId)) {
      ops.push({
        type: 'addEdge',
        edge: {
          ...e,
          id: newId('e'),
          processId: proc.id,
          from: idMap.get(e.from)!,
          to: idMap.get(e.to)!,
        },
      })
    }
    return proc.id
  }
  const id = copyProcess(processId, `${src.name} (kopio)`)
  return { ops, processId: id }
}

/** Palauttaa operaatiot, jotka varmistavat entiteetin olemassaolon. Tulos: entiteetin tunniste. */
export function ensureEntity(
  p: Project,
  kind: EntityKind,
  name: string,
  pending: Operation[] = [],
): { id: string; ops: Operation[] } {
  const clean = name.trim()
  const existing = findEntity(p, kind, clean)
  if (existing) return { id: existing.id, ops: [] }
  // Entiteetti on voitu luoda jo samassa operaatioerässä.
  for (const op of pending) {
    if (op.type === 'addEntity' && op.entity.kind === kind) {
      const e = op.entity
      if (
        normalizeName(e.name) === normalizeName(clean) ||
        e.aliases.some((a) => normalizeName(a) === normalizeName(clean))
      ) {
        return { id: e.id, ops: [] }
      }
    }
  }
  const entity: Entity = createEntity(kind, clean)
  return { id: entity.id, ops: [{ type: 'addEntity', entity }] }
}

/** Yhdistää entiteetin `fromId` entiteettiin `intoId`: viittaukset siirretään ja nimi jää aliakseksi. */
export function opsMergeEntities(p: Project, fromId: string, intoId: string): Operation[] {
  const from = p.entities[fromId]
  const into = p.entities[intoId]
  if (!from || !into || fromId === intoId) return []
  if (from.kind !== into.kind) throw new Error('Vain samantyyppiset entiteetit voi yhdistää')
  const ops: Operation[] = []
  const swap = (ids: string[]) => Array.from(new Set(ids.map((x) => (x === fromId ? intoId : x))))
  for (const n of Object.values(p.nodes)) {
    const patch: Record<string, unknown> = {}
    if (n.roleId === fromId) patch.roleId = intoId
    if (n.systemIds.includes(fromId)) patch.systemIds = swap(n.systemIds)
    if (n.inputIds.includes(fromId)) patch.inputIds = swap(n.inputIds)
    if (n.outputIds.includes(fromId)) patch.outputIds = swap(n.outputIds)
    if (Object.keys(patch).length) ops.push({ type: 'updateNode', id: n.id, patch })
  }
  const aliases = Array.from(new Set([...into.aliases, from.name, ...from.aliases]))
  ops.push({ type: 'updateEntity', id: intoId, patch: { aliases } })
  ops.push({ type: 'deleteEntity', id: fromId })
  return ops
}

export { descendantProcessIds }
