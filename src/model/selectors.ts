import type { Entity, EntityKind, Process, ProcessEdge, ProcessNode, Project } from './types'

export function nodesOf(p: Project, processId: string): ProcessNode[] {
  return Object.values(p.nodes).filter((n) => n.processId === processId)
}

export function edgesOf(p: Project, processId: string): ProcessEdge[] {
  return Object.values(p.edges).filter((e) => e.processId === processId)
}

export function outgoing(p: Project, nodeId: string): ProcessEdge[] {
  return Object.values(p.edges).filter((e) => e.from === nodeId)
}

export function incoming(p: Project, nodeId: string): ProcessEdge[] {
  return Object.values(p.edges).filter((e) => e.to === nodeId)
}

/** Murupolku juuresta annettuun prosessiin: [{process, viaNode}] */
export function processPath(p: Project, processId: string): Process[] {
  const path: Process[] = []
  let cur: Process | undefined = p.processes[processId]
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift(cur)
    const parentNode: ProcessNode | undefined = cur.parentNodeId
      ? p.nodes[cur.parentNodeId]
      : undefined
    cur = parentNode ? p.processes[parentNode.processId] : undefined
  }
  return path
}

/** Prosessit puumaisessa järjestyksessä (juuri ensin, alaprosessit sisennettyinä). */
export function processTree(p: Project): { process: Process; depth: number }[] {
  const out: { process: Process; depth: number }[] = []
  const childrenOf = (pid: string) =>
    nodesOf(p, pid)
      .filter((n) => n.childProcessId && p.processes[n.childProcessId])
      .map((n) => p.processes[n.childProcessId!])
  const roots = Object.values(p.processes).filter((pr) => !pr.parentNodeId)
  roots.sort((a, b) =>
    a.id === p.rootProcessId
      ? -1
      : b.id === p.rootProcessId
        ? 1
        : a.name.localeCompare(b.name, 'fi'),
  )
  const visit = (pr: Process, depth: number, seen: Set<string>) => {
    if (seen.has(pr.id)) return
    seen.add(pr.id)
    out.push({ process: pr, depth })
    for (const c of childrenOf(pr.id)) visit(c, depth + 1, seen)
  }
  const seen = new Set<string>()
  for (const r of roots) visit(r, 0, seen)
  return out
}

export function entitiesOfKind(p: Project, kind: EntityKind): Entity[] {
  return Object.values(p.entities)
    .filter((e) => e.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'))
}

export function normalizeName(s: string): string {
  return s.trim().toLocaleLowerCase('fi').replace(/\s+/g, ' ')
}

/** Etsii entiteetin nimen tai aliaksen perusteella (isoilla kirjaimilla ei väliä). */
export function findEntity(p: Project, kind: EntityKind, name: string): Entity | undefined {
  const target = normalizeName(name)
  return Object.values(p.entities).find(
    (e) =>
      e.kind === kind &&
      (normalizeName(e.name) === target || e.aliases.some((a) => normalizeName(a) === target)),
  )
}

/** Montako solmua käyttää entiteettiä. */
export function entityUsage(p: Project, entityId: string): number {
  let n = 0
  for (const node of Object.values(p.nodes)) {
    if (
      node.roleId === entityId ||
      node.systemIds.includes(entityId) ||
      node.inputIds.includes(entityId) ||
      node.outputIds.includes(entityId)
    )
      n++
  }
  return n
}

/** Solmut, joihin alkupisteistä pääsee seuraamalla reunoja. */
export function reachableFrom(p: Project, startIds: string[], forward = true): Set<string> {
  const adj = new Map<string, string[]>()
  for (const e of Object.values(p.edges)) {
    const [a, b] = forward ? [e.from, e.to] : [e.to, e.from]
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push(b)
  }
  const seen = new Set<string>(startIds)
  const stack = [...startIds]
  while (stack.length) {
    const cur = stack.pop()!
    for (const nxt of adj.get(cur) ?? []) {
      if (!seen.has(nxt)) {
        seen.add(nxt)
        stack.push(nxt)
      }
    }
  }
  return seen
}

/** Vaiheet, jotka käyttävät entiteettiä (roolina, järjestelmänä, syötteenä tai tuotoksena), prosessin ja nimen mukaan järjestettynä. */
export function entityUsages(
  p: Project,
  entityId: string,
): { node: ProcessNode; as: ('rooli' | 'järjestelmä' | 'syöte' | 'tuotos')[] }[] {
  const out: { node: ProcessNode; as: ('rooli' | 'järjestelmä' | 'syöte' | 'tuotos')[] }[] = []
  for (const node of Object.values(p.nodes)) {
    const as: ('rooli' | 'järjestelmä' | 'syöte' | 'tuotos')[] = []
    if (node.roleId === entityId) as.push('rooli')
    if (node.systemIds.includes(entityId)) as.push('järjestelmä')
    if (node.inputIds.includes(entityId)) as.push('syöte')
    if (node.outputIds.includes(entityId)) as.push('tuotos')
    if (as.length) out.push({ node, as })
  }
  const procName = (id: string) => p.processes[id]?.name ?? ''
  return out.sort(
    (a, b) =>
      procName(a.node.processId).localeCompare(procName(b.node.processId), 'fi') ||
      a.node.label.localeCompare(b.node.label, 'fi'),
  )
}
