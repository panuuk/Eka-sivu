import type { Entity, Process, ProcessEdge, ProcessNode, Project, Question, Source } from './types'

/**
 * Kaikki mallin muutokset ovat operaatioita. Käsin muokkaus, tekstisyöte, dokumenteista poiminta
 * ja kysymyksiin vastaaminen tuottavat samoja operaatioita, joten kumoaminen, muutoshistoria ja
 * esikatselu toimivat yhdellä mekanismilla.
 *
 * `update*`-operaatioiden patchissa `undefined`-arvo poistaa kentän.
 */
export type NodePatch = Partial<Omit<ProcessNode, 'id' | 'processId'>>

export type Operation =
  | { type: 'renameProject'; name: string }
  | { type: 'addProcess'; process: Process }
  | {
      type: 'updateProcess'
      id: string
      patch: Partial<Pick<Process, 'name' | 'description' | 'parentNodeId'>>
    }
  | { type: 'deleteProcess'; id: string }
  | { type: 'addNode'; node: ProcessNode }
  | { type: 'updateNode'; id: string; patch: NodePatch }
  | { type: 'deleteNode'; id: string }
  | { type: 'addEdge'; edge: ProcessEdge }
  | { type: 'updateEdge'; id: string; patch: Partial<Pick<ProcessEdge, 'label'>> }
  | { type: 'deleteEdge'; id: string }
  | { type: 'addEntity'; entity: Entity }
  | { type: 'updateEntity'; id: string; patch: Partial<Omit<Entity, 'id' | 'kind'>> }
  | { type: 'deleteEntity'; id: string }
  | { type: 'addSource'; source: Source }
  | { type: 'updateSource'; id: string; patch: Partial<Pick<Source, 'title' | 'text'>> }
  | { type: 'deleteSource'; id: string }
  | { type: 'addQuestion'; question: Question }
  | { type: 'updateQuestion'; id: string; patch: Partial<Omit<Question, 'id'>> }
  | { type: 'deleteQuestion'; id: string }
  | { type: 'batch'; ops: Operation[] }

export class OperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationError'
  }
}

function omit<T extends object>(rec: Record<string, T>, ...keys: string[]): Record<string, T> {
  const out = { ...rec }
  for (const k of keys) delete out[k]
  return out
}

function applyPatch<T extends object>(target: T, patch: object): T {
  const next = { ...target } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return next as T
}

function need<T>(rec: Record<string, T>, id: string, what: string): T {
  const v = rec[id]
  if (!v) throw new OperationError(`${what} ei löydy: ${id}`)
  return v
}

/** Kaikki prosessit, jotka kuuluvat annetun prosessin alle (mukaan lukien se itse). */
export function descendantProcessIds(p: Project, processId: string): string[] {
  const result = [processId]
  const stack = [processId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of Object.values(p.nodes)) {
      if (n.processId === cur && n.childProcessId && !result.includes(n.childProcessId)) {
        result.push(n.childProcessId)
        stack.push(n.childProcessId)
      }
    }
  }
  return result
}

function removeProcesses(p: Project, ids: string[]): Project {
  const idSet = new Set(ids)
  const nodes: Record<string, ProcessNode> = {}
  const removedNodes = new Set<string>()
  for (const n of Object.values(p.nodes)) {
    if (idSet.has(n.processId)) removedNodes.add(n.id)
    else nodes[n.id] = n
  }
  const edges: Record<string, ProcessEdge> = {}
  for (const e of Object.values(p.edges)) if (!idSet.has(e.processId)) edges[e.id] = e
  const questions: Record<string, Question> = {}
  for (const q of Object.values(p.questions)) {
    if (!idSet.has(q.processId) && !(q.targetId && removedNodes.has(q.targetId))) {
      questions[q.id] = q
    }
  }
  // Vapauta vanhempivaihe, jos sen alaprosessi poistuu.
  for (const n of Object.values(nodes)) {
    if (n.childProcessId && idSet.has(n.childProcessId)) {
      nodes[n.id] = applyPatch(n, { childProcessId: undefined, kind: 'step' })
    }
  }
  const processes: Record<string, Process> = {}
  for (const pr of Object.values(p.processes)) if (!idSet.has(pr.id)) processes[pr.id] = pr
  return { ...p, processes, nodes, edges, questions }
}

function stripEntityRefs(n: ProcessNode, entityId: string): ProcessNode {
  if (
    n.roleId !== entityId &&
    !n.systemIds.includes(entityId) &&
    !n.inputIds.includes(entityId) &&
    !n.outputIds.includes(entityId) &&
    !n.raci?.accountableIds?.includes(entityId) &&
    !n.raci?.consultedIds?.includes(entityId) &&
    !n.raci?.informedIds?.includes(entityId)
  ) {
    return n
  }
  const raci = n.raci
    ? {
        accountableIds: n.raci.accountableIds?.filter((x) => x !== entityId),
        consultedIds: n.raci.consultedIds?.filter((x) => x !== entityId),
        informedIds: n.raci.informedIds?.filter((x) => x !== entityId),
      }
    : undefined
  return {
    ...n,
    raci,
    roleId: n.roleId === entityId ? undefined : n.roleId,
    systemIds: n.systemIds.filter((x) => x !== entityId),
    inputIds: n.inputIds.filter((x) => x !== entityId),
    outputIds: n.outputIds.filter((x) => x !== entityId),
  }
}

export function applyOperation(p: Project, op: Operation): Project {
  switch (op.type) {
    case 'renameProject':
      return { ...p, name: op.name }

    case 'addProcess': {
      if (p.processes[op.process.id])
        throw new OperationError(`Prosessi on jo olemassa: ${op.process.id}`)
      if (op.process.parentNodeId) need(p.nodes, op.process.parentNodeId, 'Vanhempivaihe')
      return { ...p, processes: { ...p.processes, [op.process.id]: op.process } }
    }
    case 'updateProcess': {
      const cur = need(p.processes, op.id, 'Prosessi')
      const next: Project = {
        ...p,
        processes: { ...p.processes, [op.id]: applyPatch(cur, op.patch) },
      }
      // Alaprosessin nimi ja sen vanhempivaiheen nimi pidetään samana.
      const parent = next.processes[op.id].parentNodeId
        ? next.nodes[next.processes[op.id].parentNodeId!]
        : undefined
      if (op.patch.name !== undefined && parent && parent.label !== op.patch.name) {
        return {
          ...next,
          nodes: { ...next.nodes, [parent.id]: { ...parent, label: op.patch.name } },
        }
      }
      return next
    }
    case 'deleteProcess': {
      need(p.processes, op.id, 'Prosessi')
      if (op.id === p.rootProcessId) throw new OperationError('Päätason prosessia ei voi poistaa')
      const ids = descendantProcessIds(p, op.id)
      return removeProcesses(p, ids)
    }

    case 'addNode': {
      const n = op.node
      if (p.nodes[n.id]) throw new OperationError(`Solmu on jo olemassa: ${n.id}`)
      need(p.processes, n.processId, 'Prosessi')
      return { ...p, nodes: { ...p.nodes, [n.id]: n } }
    }
    case 'updateNode': {
      const cur = need(p.nodes, op.id, 'Solmu')
      const next = applyPatch(cur, op.patch)
      if (next.childProcessId) need(p.processes, next.childProcessId, 'Alaprosessi')
      const result: Project = { ...p, nodes: { ...p.nodes, [op.id]: next } }
      const child = next.childProcessId ? p.processes[next.childProcessId] : undefined
      if (op.patch.label !== undefined && child && child.name !== next.label) {
        return {
          ...result,
          processes: { ...result.processes, [child.id]: { ...child, name: next.label } },
        }
      }
      return result
    }
    case 'deleteNode': {
      const n = need(p.nodes, op.id, 'Solmu')
      let next: Project = p
      if (n.childProcessId && p.processes[n.childProcessId]) {
        // Poista alaprosessi ensin, sen jälkeen itse solmu.
        next = removeProcesses(next, descendantProcessIds(p, n.childProcessId))
      }
      const nodes = omit(next.nodes, op.id)
      const edges: Record<string, ProcessEdge> = {}
      for (const e of Object.values(next.edges)) {
        if (e.from !== op.id && e.to !== op.id) edges[e.id] = e
      }
      const questions: Record<string, Question> = {}
      for (const q of Object.values(next.questions)) if (q.targetId !== op.id) questions[q.id] = q
      return { ...next, nodes, edges, questions }
    }

    case 'addEdge': {
      const e = op.edge
      if (p.edges[e.id]) throw new OperationError(`Reuna on jo olemassa: ${e.id}`)
      const from = need(p.nodes, e.from, 'Lähtösolmu')
      const to = need(p.nodes, e.to, 'Kohdesolmu')
      if (from.processId !== to.processId || from.processId !== e.processId) {
        throw new OperationError('Reuna voi yhdistää vain saman prosessin solmuja')
      }
      if (e.from === e.to) throw new OperationError('Solmua ei voi yhdistää itseensä')
      for (const x of Object.values(p.edges)) {
        if (x.from === e.from && x.to === e.to) throw new OperationError('Solmut on jo yhdistetty')
      }
      return { ...p, edges: { ...p.edges, [e.id]: e } }
    }
    case 'updateEdge': {
      const cur = need(p.edges, op.id, 'Reuna')
      return { ...p, edges: { ...p.edges, [op.id]: applyPatch(cur, op.patch) } }
    }
    case 'deleteEdge': {
      need(p.edges, op.id, 'Reuna')
      return { ...p, edges: omit(p.edges, op.id) }
    }

    case 'addEntity': {
      if (p.entities[op.entity.id])
        throw new OperationError(`Entiteetti on jo olemassa: ${op.entity.id}`)
      return { ...p, entities: { ...p.entities, [op.entity.id]: op.entity } }
    }
    case 'updateEntity': {
      const cur = need(p.entities, op.id, 'Entiteetti')
      return { ...p, entities: { ...p.entities, [op.id]: applyPatch(cur, op.patch) } }
    }
    case 'deleteEntity': {
      need(p.entities, op.id, 'Entiteetti')
      const nodes: Record<string, ProcessNode> = {}
      for (const n of Object.values(p.nodes)) nodes[n.id] = stripEntityRefs(n, op.id)
      return { ...p, entities: omit(p.entities, op.id), nodes }
    }

    case 'addSource': {
      if (p.sources[op.source.id]) throw new OperationError(`Lähde on jo olemassa: ${op.source.id}`)
      return { ...p, sources: { ...p.sources, [op.source.id]: op.source } }
    }
    case 'updateSource': {
      const cur = need(p.sources, op.id, 'Lähde')
      return { ...p, sources: { ...p.sources, [op.id]: applyPatch(cur, op.patch) } }
    }
    case 'deleteSource': {
      need(p.sources, op.id, 'Lähde')
      const nodes: Record<string, ProcessNode> = {}
      for (const n of Object.values(p.nodes)) {
        nodes[n.id] = n.sources.some((s) => s.sourceId === op.id)
          ? { ...n, sources: n.sources.filter((s) => s.sourceId !== op.id) }
          : n
      }
      return { ...p, sources: omit(p.sources, op.id), nodes }
    }

    case 'addQuestion': {
      if (p.questions[op.question.id])
        throw new OperationError(`Kysymys on jo olemassa: ${op.question.id}`)
      need(p.processes, op.question.processId, 'Prosessi')
      return { ...p, questions: { ...p.questions, [op.question.id]: op.question } }
    }
    case 'updateQuestion': {
      const cur = need(p.questions, op.id, 'Kysymys')
      return { ...p, questions: { ...p.questions, [op.id]: applyPatch(cur, op.patch) } }
    }
    case 'deleteQuestion': {
      need(p.questions, op.id, 'Kysymys')
      return { ...p, questions: omit(p.questions, op.id) }
    }
    case 'batch':
      return op.ops.reduce(applyOperation, p)
  }
}

export function applyOperations(p: Project, ops: Operation[]): Project {
  return ops.reduce(applyOperation, p)
}
