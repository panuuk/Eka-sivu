import type { Operation } from '../model/operations'
import type { ProcessNode, Project, Source, SourceRef } from '../model/types'

/** Lähdeviitteiden apufunktiot: vanhentuminen, uudelleenankkurointi ja viitteiden haku. */

export function refIsStale(source: Source, ref: SourceRef): boolean {
  return source.text.slice(ref.start, ref.end) !== ref.quote
}

/** Etsii viitteen lainauksen uudesta tekstistä; useasta osumasta valitaan lähin alkuperäiseen kohtaan. */
export function reanchorRef(newText: string, ref: SourceRef): SourceRef | null {
  if (!ref.quote) return null
  let best = -1
  let from = 0
  while (true) {
    const i = newText.indexOf(ref.quote, from)
    if (i < 0) break
    if (best < 0 || Math.abs(i - ref.start) < Math.abs(best - ref.start)) best = i
    from = i + 1
  }
  if (best < 0) return null
  return { ...ref, start: best, end: best + ref.quote.length }
}

/** Päivittää lähteen tekstin ja siirtää viitteet uuteen paikkaan. Viite, jota ei löydy, jää vanhentuneeksi. */
export function opsUpdateSourceText(p: Project, sourceId: string, newText: string): Operation[] {
  const ops: Operation[] = [{ type: 'updateSource', id: sourceId, patch: { text: newText } }]
  for (const n of Object.values(p.nodes)) {
    if (!n.sources.some((r) => r.sourceId === sourceId)) continue
    let changed = false
    const sources = n.sources.map((r) => {
      if (r.sourceId !== sourceId) return r
      if (newText.slice(r.start, r.end) === r.quote) return r
      const moved = reanchorRef(newText, r)
      if (!moved) return r
      changed = true
      return moved
    })
    if (changed) ops.push({ type: 'updateNode', id: n.id, patch: { sources } })
  }
  return ops
}

export interface LinkedRef {
  node: ProcessNode
  ref: SourceRef
  stale: boolean
}

/** Kaikki lähteeseen liittyvät viitteet sijainnin mukaan järjestettynä. */
export function refsOfSource(p: Project, sourceId: string): LinkedRef[] {
  const source = p.sources[sourceId]
  if (!source) return []
  const out: LinkedRef[] = []
  for (const node of Object.values(p.nodes)) {
    for (const ref of node.sources) {
      if (ref.sourceId === sourceId) out.push({ node, ref, stale: refIsStale(source, ref) })
    }
  }
  return out.sort((a, b) => a.ref.start - b.ref.start || a.ref.end - b.ref.end)
}

/** Operaatio, joka lisää viitteen solmulle. Täsmälleen sama viite ei lisäänny kahdesti. */
export function opsAddRef(p: Project, nodeId: string, ref: SourceRef): Operation[] {
  const node = p.nodes[nodeId]
  if (!node) return []
  if (
    node.sources.some(
      (r) => r.sourceId === ref.sourceId && r.start === ref.start && r.end === ref.end,
    )
  )
    return []
  return [{ type: 'updateNode', id: nodeId, patch: { sources: [...node.sources, ref] } }]
}

export function opsRemoveRef(p: Project, nodeId: string, ref: SourceRef): Operation[] {
  const node = p.nodes[nodeId]
  if (!node) return []
  const sources = node.sources.filter(
    (r) => !(r.sourceId === ref.sourceId && r.start === ref.start && r.end === ref.end),
  )
  return sources.length === node.sources.length
    ? []
    : [{ type: 'updateNode', id: nodeId, patch: { sources } }]
}
