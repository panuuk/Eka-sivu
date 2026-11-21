import { normalizeName } from '../model/selectors'
import type { Project } from '../model/types'

export interface NodeChange {
  id: string
  label: string
  fields: string[]
}

export interface ProjectDiff {
  newNodes: { id: string; label: string; kind: string }[]
  changedNodes: NodeChange[]
  newEdges: { id: string; from: string; to: string; label?: string }[]
  removedEdges: { id: string; from: string; to: string }[]
  removedNodes: { id: string; label: string; kind: string }[]
  newEntities: { id: string; name: string; kind: string }[]
  newProcesses: { id: string; name: string }[]
  newSources: { id: string; title: string }[]
  /** Prosessikorttien ja roolien kuvausten muutokset (lukumäärä). */
  cardChanges: number
  entityNotes: number
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** Laskee, mitä `after` lisää tai muuttaa verrattuna tilaan `before`. Tunnisteet ovat vakaat, joten vertailu on suora. */
export function diffProjects(before: Project, after: Project): ProjectDiff {
  const d: ProjectDiff = {
    newNodes: [],
    changedNodes: [],
    newEdges: [],
    removedEdges: [],
    removedNodes: [],
    newEntities: [],
    newProcesses: [],
    newSources: [],
    cardChanges: 0,
    entityNotes: 0,
  }
  for (const n of Object.values(after.nodes)) {
    const old = before.nodes[n.id]
    if (!old) {
      d.newNodes.push({ id: n.id, label: n.label, kind: n.kind })
      continue
    }
    const fields: string[] = []
    const name = (id?: string) => (id ? (after.entities[id]?.name ?? '?') : '–')
    if (normalizeName(old.label) !== normalizeName(n.label))
      fields.push(`nimi: ${old.label} → ${n.label}`)
    if (old.kind !== n.kind) fields.push(`tyyppi: ${old.kind} → ${n.kind}`)
    if (old.roleId !== n.roleId) fields.push(`rooli: ${name(old.roleId)} → ${name(n.roleId)}`)
    if (!sameList(old.systemIds, n.systemIds)) {
      const added = n.systemIds.filter((x) => !old.systemIds.includes(x)).map(name)
      if (added.length) fields.push(`järjestelmät: +${added.join(', ')}`)
    }
    if (!sameList(old.inputIds, n.inputIds)) {
      const added = n.inputIds.filter((x) => !old.inputIds.includes(x)).map(name)
      if (added.length) fields.push(`syötteet: +${added.join(', ')}`)
    }
    if (!sameList(old.outputIds, n.outputIds)) {
      const added = n.outputIds.filter((x) => !old.outputIds.includes(x)).map(name)
      if (added.length) fields.push(`tuotokset: +${added.join(', ')}`)
    }
    if (old.confidence !== n.confidence) fields.push(`varmuus: ${old.confidence} → ${n.confidence}`)
    if (old.description !== n.description) fields.push('kuvaus')
    if (JSON.stringify(old.checklist ?? []) !== JSON.stringify(n.checklist ?? []))
      fields.push('tarkistuslista')
    if (fields.length) d.changedNodes.push({ id: n.id, label: n.label, fields })
  }
  for (const e of Object.values(after.edges)) {
    if (!before.edges[e.id]) d.newEdges.push({ id: e.id, from: e.from, to: e.to, label: e.label })
  }
  for (const e of Object.values(before.edges)) {
    if (!after.edges[e.id]) d.removedEdges.push({ id: e.id, from: e.from, to: e.to })
  }
  for (const n of Object.values(before.nodes)) {
    if (!after.nodes[n.id]) d.removedNodes.push({ id: n.id, label: n.label, kind: n.kind })
  }
  for (const e of Object.values(after.entities)) {
    if (!before.entities[e.id]) d.newEntities.push({ id: e.id, name: e.name, kind: e.kind })
  }
  for (const p of Object.values(after.processes)) {
    if (!before.processes[p.id]) d.newProcesses.push({ id: p.id, name: p.name })
  }
  for (const pr of Object.values(after.processes)) {
    const old = before.processes[pr.id]
    if (old && JSON.stringify(old.card ?? null) !== JSON.stringify(pr.card ?? null)) d.cardChanges++
    if (!old && pr.card) d.cardChanges++
  }
  for (const e of Object.values(after.entities)) {
    const old = before.entities[e.id]
    if (old && old.description !== e.description) d.entityNotes++
    if (!old && e.description) d.entityNotes++
  }
  for (const s of Object.values(after.sources)) {
    if (!before.sources[s.id]) d.newSources.push({ id: s.id, title: s.title })
  }
  return d
}

export function isEmptyDiff(d: ProjectDiff): boolean {
  return (
    d.newNodes.length === 0 &&
    d.changedNodes.length === 0 &&
    d.newEdges.length === 0 &&
    d.removedEdges.length === 0 &&
    d.removedNodes.length === 0 &&
    d.newEntities.length === 0 &&
    d.newProcesses.length === 0 &&
    d.cardChanges === 0 &&
    d.entityNotes === 0
  )
}
