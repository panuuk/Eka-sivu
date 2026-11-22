import { ensureEntity } from '../model/commands'
import { createEdge, createNode, createProcess, createProject } from '../model/factory'
import { applyOperations, type Operation } from '../model/operations'
import type { NodeKind, Project } from '../model/types'

/**
 * Kaaviotuonnin yhteinen väliesitys. BPMN- ja Mermaid-jäsentimet tuottavat `ImportedGraph`in,
 * josta rakennetaan mallin operaatiot (`graphToOps`) tai kokonainen uusi projekti.
 */

export interface ImportedNode {
  key: string
  kind: NodeKind
  label: string
  role?: string
  description?: string
  /** Alaprosessin sisältö (BPMN subProcess, Mermaid subgraph). */
  child?: ImportedProcess
}

export interface ImportedEdge {
  from: string
  to: string
  label?: string
}

export interface ImportedProcess {
  name: string
  nodes: ImportedNode[]
  edges: ImportedEdge[]
}

export interface ImportedGraph {
  /** Päätason prosessit. Yksi prosessi on päätaso; useampi tuodaan alaprosesseina. */
  processes: ImportedProcess[]
  /** Mitä jätettiin huomioimatta (viestivirrat, dataobjektit jne.). */
  skipped: string[]
}

interface GraphSummary {
  steps: number
  decisions: number
  subprocesses: number
  roles: number
  edges: number
}

export function summarize(g: ImportedGraph): GraphSummary {
  const roles = new Set<string>()
  const s = { steps: 0, decisions: 0, subprocesses: 0, roles: 0, edges: 0 }
  const visit = (p: ImportedProcess) => {
    s.edges += p.edges.length
    for (const n of p.nodes) {
      if (n.role) roles.add(n.role)
      if (n.kind === 'step') s.steps++
      else if (n.kind === 'decision') s.decisions++
      else if (n.kind === 'subprocess') s.subprocesses++
      if (n.child) visit(n.child)
    }
  }
  g.processes.forEach(visit)
  return { ...s, roles: roles.size }
}

export const MAX_IMPORT_NODES = 5000

/** Poistaa nimettömät yhdistävät yhdyskäytävät (yksi lähtevä yhteys) ja kytkee yhteydet niiden yli. */
export function bridgeMerges(p: ImportedProcess): ImportedProcess {
  let nodes = [...p.nodes]
  let edges = [...p.edges]
  for (const n of p.nodes) {
    if (n.kind !== 'decision' || n.label.trim()) continue
    const out = edges.filter((e) => e.from === n.key)
    const inc = edges.filter((e) => e.to === n.key)
    if (out.length !== 1 || inc.length < 1) continue
    const target = out[0].to
    edges = edges.filter((e) => e.from !== n.key && e.to !== n.key)
    for (const i of inc)
      if (i.from !== target) edges.push({ from: i.from, to: target, label: i.label })
    nodes = nodes.filter((x) => x.key !== n.key)
  }
  // Kaksoisyhteydet pois
  const seen = new Set<string>()
  edges = edges.filter((e) => {
    const k = `${e.from}>${e.to}`
    if (seen.has(k) || e.from === e.to) return false
    seen.add(k)
    return true
  })
  return { ...p, nodes, edges }
}

/** Rakentaa operaatiot, jotka lisäävät prosessin annettuun prosessiin. Palauttaa myös lisätyt vaihtoehtoiset tunnisteet. */
function processOps(
  project: Project,
  proc: ImportedProcess,
  processId: string,
  pending: Operation[],
  parentDepth = 0,
): Operation[] {
  const ops: Operation[] = []
  const ids = new Map<string, string>()
  const p = bridgeMerges(proc)
  for (const n of p.nodes) {
    const roleOp = n.role ? ensureEntity(project, 'role', n.role, [...pending, ...ops]) : undefined
    if (roleOp) ops.push(...roleOp.ops)
    const kind: NodeKind = n.kind === 'subprocess' && !n.child ? 'step' : n.kind
    const node = createNode(processId, {
      label: n.label.trim() || (kind === 'decision' ? 'Päätös?' : 'Vaihe'),
      kind,
      roleId: roleOp?.id,
      description: n.description,
      confidence: kind === 'start' || kind === 'end' ? 'confirmed' : 'likely',
    })
    ids.set(n.key, node.id)
    ops.push({ type: 'addNode', node })
    if (n.kind === 'subprocess' && n.child && parentDepth < 6) {
      const child = createProcess(node.label, node.id)
      ops.push({ type: 'addProcess', process: child })
      ops.push({
        type: 'updateNode',
        id: node.id,
        patch: { childProcessId: child.id, kind: 'subprocess' },
      })
      ops.push(...processOps(project, n.child, child.id, [...pending, ...ops], parentDepth + 1))
    }
  }
  for (const e of p.edges) {
    const from = ids.get(e.from)
    const to = ids.get(e.to)
    if (from && to && from !== to)
      ops.push({ type: 'addEdge', edge: createEdge(processId, from, to, e.label) })
  }
  return ops
}

/** Operaatiot, jotka lisäävät tuodun kaavion annettuun prosessiin (yhdistämättöminä lohkoina). */
export function graphToOps(project: Project, g: ImportedGraph, processId: string): Operation[] {
  const ops: Operation[] = []
  if (g.processes.length === 1) return processOps(project, g.processes[0], processId, ops)
  // Useampi prosessi: kukin omana alaprosessinaan
  for (const proc of g.processes) {
    const wrapper = createNode(processId, { label: proc.name || 'Prosessi', kind: 'subprocess' })
    ops.push({ type: 'addNode', node: wrapper })
    const child = createProcess(wrapper.label, wrapper.id)
    ops.push({ type: 'addProcess', process: child })
    ops.push({
      type: 'updateNode',
      id: wrapper.id,
      patch: { childProcessId: child.id, kind: 'subprocess' },
    })
    ops.push(...processOps(project, proc, child.id, ops, 1))
  }
  return ops
}

/** Uusi projekti tuodusta kaaviosta. */
export function graphToProject(g: ImportedGraph, name: string): Project {
  const base = createProject(name, g.processes.length === 1 ? g.processes[0].name || name : name)
  const ops = graphToOps(base, g, base.rootProcessId)
  return applyOperations(base, ops)
}
