import type { Operation } from '../model/operations'
import type { Project } from '../model/types'

export type ReplaceField = 'label' | 'description' | 'notes'

export interface ReplaceOptions {
  find: string
  replace: string
  caseSensitive: boolean
  fields: ReplaceField[]
  /** Rajaa prosessiin (alaprosessit mukaan lukien eivät); puuttuessa koko projekti. */
  processId?: string
}

export interface ReplaceChange {
  nodeId: string
  field: ReplaceField
  before: string
  after: string
  count: number
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Laskee muutokset ilman tallennusta: esikatselua ja operaatioiden muodostusta varten. */
export function planReplace(p: Project, opts: ReplaceOptions): ReplaceChange[] {
  if (!opts.find) return []
  const re = new RegExp(escape(opts.find), opts.caseSensitive ? 'gu' : 'giu')
  const out: ReplaceChange[] = []
  for (const n of Object.values(p.nodes)) {
    if (opts.processId && n.processId !== opts.processId) continue
    for (const field of opts.fields) {
      const before = n[field]
      if (!before) continue
      let count = 0
      // Funktio välttää korvausmerkkijonon erikoismerkkien ($&) tulkinnan
      const after = before.replace(re, () => {
        count++
        return opts.replace
      })
      if (count > 0 && after !== before) out.push({ nodeId: n.id, field, before, after, count })
    }
  }
  return out
}

/** Muuttaa korvaukset operaatioiksi. Tyhjäksi jäävää nimeä ei sallita: sitä ei muuteta. */
export function opsReplace(changes: ReplaceChange[]): Operation[] {
  const byNode = new Map<string, Record<string, string | undefined>>()
  for (const c of changes) {
    if (c.field === 'label' && c.after.trim() === '') continue
    const patch = byNode.get(c.nodeId) ?? {}
    patch[c.field] = c.field === 'label' ? c.after : c.after.trim() === '' ? undefined : c.after
    byNode.set(c.nodeId, patch)
  }
  return [...byNode.entries()].map(([id, patch]) => ({ type: 'updateNode', id, patch }))
}
