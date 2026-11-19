import { flowOrder } from '../model/flow'
import { edgesOf, nodesOf } from '../model/selectors'
import type { NodeKind, Project } from '../model/types'

/**
 * Mermaid-vienti (flowchart): sopii wikeihin ja GitHubiin. Avatut alaprosessit viedään `subgraph`-lohkoina,
 * ja roolit näkyvät vaiheen nimen alla.
 */

const q = (s: string) =>
  s
    .replace(/"/g, '#quot;')
    .replace(/[\r\n]+/g, ' ')
    .trim()

function shape(kind: NodeKind, text: string): string {
  switch (kind) {
    case 'decision':
      return `{"${text}"}`
    case 'start':
    case 'end':
      return `(["${text}"])`
    case 'subprocess':
      return `[["${text}"]]`
    default:
      return `["${text}"]`
  }
}

export function toMermaid(
  p: Project,
  processId: string,
  opts: { direction?: 'TD' | 'LR'; expand?: boolean } = {},
): string {
  const ids = new Map<string, string>()
  const idOf = (nodeId: string) => {
    let v = ids.get(nodeId)
    if (!v) {
      v = `n${ids.size + 1}`
      ids.set(nodeId, v)
    }
    return v
  }

  // Avattavat alaprosessit (syvyysraja suojaa silmukoilta)
  const expanded = new Set<string>()
  const collect = (pid: string, depth: number) => {
    for (const n of nodesOf(p, pid)) {
      if (
        opts.expand &&
        n.kind === 'subprocess' &&
        n.childProcessId &&
        depth < 6 &&
        nodesOf(p, n.childProcessId).length > 0
      ) {
        expanded.add(n.id)
        collect(n.childProcessId, depth + 1)
      }
    }
  }
  collect(processId, 0)
  /** Reunan päätepiste: avattu alaprosessi on ryhmä, jonka tunnisteeseen reunat kytketään. */
  const ref = (nodeId: string) => (expanded.has(nodeId) ? `${idOf(nodeId)}_g` : idOf(nodeId))

  const label = (id: string) => {
    const n = p.nodes[id]
    const role = n.roleId ? p.entities[n.roleId]?.name : undefined
    const base = q(n.label) || 'Nimetön'
    const showRole = role && n.kind !== 'start' && n.kind !== 'end' && n.kind !== 'decision'
    return showRole ? `${base}<br/><i>${q(role)}</i>` : base
  }

  const body: string[] = []
  let hasGuess = false
  const emit = (pid: string, indent: string) => {
    for (const { node } of flowOrder(p, pid)) {
      if (expanded.has(node.id)) {
        body.push(`${indent}subgraph ${idOf(node.id)}_g["${q(node.label)}"]`)
        emit(node.childProcessId!, `${indent}  `)
        body.push(`${indent}end`)
        continue
      }
      body.push(`${indent}${idOf(node.id)}${shape(node.kind, label(node.id))}`)
      if (node.confidence === 'guess' && node.kind !== 'start' && node.kind !== 'end') {
        hasGuess = true
        body.push(`${indent}class ${idOf(node.id)} guess`)
      }
    }
    for (const e of edgesOf(p, pid)) {
      body.push(`${indent}${ref(e.from)} -->${e.label ? `|"${q(e.label)}"|` : ''} ${ref(e.to)}`)
    }
  }
  emit(processId, '  ')

  const out = [`flowchart ${opts.direction ?? 'TD'}`, ...body]
  if (hasGuess) out.push('  classDef guess stroke-dasharray: 5 5,fill:#fff8e1')
  return out.join('\n')
}
