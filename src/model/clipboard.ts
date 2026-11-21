import { createEdge, createNode } from './factory'
import type { Operation } from './operations'
import type { ProcessEdge, ProcessNode, Project } from './types'

/** Leikepöydälle kopioidut vaiheet ja niiden väliset yhteydet. */
export interface Clip {
  nodes: ProcessNode[]
  edges: ProcessEdge[]
}

/**
 * Kopioi valitut vaiheet ja niiden keskinäiset yhteydet. Alku- ja loppupisteitä ei kopioida
 * (prosessissa on yleensä vain yksi kumpaakin). Palauttaa null, jos mitään kopioitavaa ei ole.
 */
export function copyNodes(p: Project, nodeIds: string[]): Clip | null {
  const nodes = nodeIds
    .map((id) => p.nodes[id])
    .filter((n): n is ProcessNode => !!n && n.kind !== 'start' && n.kind !== 'end')
  if (nodes.length === 0) return null
  const ids = new Set(nodes.map((n) => n.id))
  const edges = Object.values(p.edges).filter((e) => ids.has(e.from) && ids.has(e.to))
  return { nodes: structuredClone(nodes), edges: structuredClone(edges) }
}

/**
 * Liittää kopion prosessiin uusina vaiheina. Jos `anchorId` on annettu (eikä se ole loppupiste),
 * kopion ensimmäinen vaihe liitetään siihen. Alaprosessit liitetään tavallisina vaiheina, koska
 * niiden sisältö jäisi muuten jaetuksi alkuperäisen kanssa.
 */
export function opsPaste(
  p: Project,
  clip: Clip,
  processId: string,
  anchorId?: string,
): { ops: Operation[]; nodeIds: string[] } {
  const ops: Operation[] = []
  const idMap = new Map<string, string>()
  const created: ProcessNode[] = []
  for (const n of clip.nodes) {
    const copy = createNode(processId, {
      kind: n.kind === 'subprocess' ? 'step' : n.kind,
      label: n.label,
      description: n.description,
      roleId: n.roleId && p.entities[n.roleId] ? n.roleId : undefined,
      systemIds: n.systemIds.filter((id) => p.entities[id]),
      inputIds: n.inputIds.filter((id) => p.entities[id]),
      outputIds: n.outputIds.filter((id) => p.entities[id]),
      confidence: n.confidence,
      sources: n.sources.filter((s) => p.sources[s.sourceId]),
      notes: n.notes,
    })
    idMap.set(n.id, copy.id)
    created.push(copy)
    ops.push({ type: 'addNode', node: copy })
  }
  const hasIncoming = new Set<string>()
  for (const e of clip.edges) {
    const from = idMap.get(e.from)
    const to = idMap.get(e.to)
    if (!from || !to) continue
    hasIncoming.add(to)
    ops.push({ type: 'addEdge', edge: createEdge(processId, from, to, e.label) })
  }
  const anchor = anchorId ? p.nodes[anchorId] : undefined
  if (anchor && anchor.processId === processId && anchor.kind !== 'end') {
    const root = created.find((n) => !hasIncoming.has(n.id))
    if (root) ops.push({ type: 'addEdge', edge: createEdge(processId, anchor.id, root.id) })
  }
  return { ops, nodeIds: created.map((n) => n.id) }
}
