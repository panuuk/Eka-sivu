import type { Project, Question } from '../model/types'
import { findGaps, indexGraph, type Gap } from './gaps'

export interface Readiness {
  /** 0–100 */
  percent: number
  /** Vaiheita ja päätöksiä (ilman alku- ja loppupisteitä). */
  nodes: number
  confirmed: number
  guesses: number
  /** Avoimet aukot ja omat kysymykset. */
  openQuestions: number
}

export interface Analysis {
  /** Kaikki löydetyt aukot. */
  gaps: Gap[]
  /** Aukot, joita ei ole ohitettu. */
  open: Gap[]
  dismissed: Gap[]
  /** Käyttäjän omat kysymykset (avoimet ja vastatut). */
  custom: Question[]
  /** Avoimien aukkojen ja kysymysten määrä solmua kohti. */
  perNode: Map<string, number>
  readiness: (processId: string, includeChildren?: boolean) => Readiness
}

const cache = new WeakMap<Project, Analysis>()

export function analyze(p: Project): Analysis {
  const hit = cache.get(p)
  if (hit) return hit

  const dismissedKeys = new Set(
    Object.values(p.questions)
      .filter((q) => q.rule !== 'custom' && q.status === 'dismissed')
      .map((q) => q.key),
  )
  const index = indexGraph(p)
  const gaps = findGaps(p, index)
  const open = gaps.filter((g) => !dismissedKeys.has(g.key))
  const dismissed = gaps.filter((g) => dismissedKeys.has(g.key))
  const custom = Object.values(p.questions)
    .filter((q) => q.rule === 'custom')
    .sort((a, b) => a.id.localeCompare(b.id))

  const perNode = new Map<string, number>()
  for (const g of open) if (g.targetId) perNode.set(g.targetId, (perNode.get(g.targetId) ?? 0) + 1)
  for (const q of custom) {
    if (q.status === 'open' && q.targetId)
      perNode.set(q.targetId, (perNode.get(q.targetId) ?? 0) + 1)
  }

  const readiness = (processId: string, includeChildren = true): Readiness => {
    const ids = new Set([processId])
    if (includeChildren) {
      // Alaprosessit kulkevat vaiheiden childProcessId-viitteiden kautta.
      const stack = [processId]
      while (stack.length) {
        for (const n of index.nodesByProcess.get(stack.pop()!) ?? []) {
          if (n.childProcessId && !ids.has(n.childProcessId)) {
            ids.add(n.childProcessId)
            stack.push(n.childProcessId)
          }
        }
      }
    }
    const nodes = [...ids]
      .flatMap((id) => index.nodesByProcess.get(id) ?? [])
      .filter((n) => n.kind !== 'start' && n.kind !== 'end')
    const gapNodes = new Set(
      open.filter((g) => g.targetId && ids.has(g.processId)).map((g) => g.targetId!),
    )
    const processLevel = open.filter((g) => !g.targetId && ids.has(g.processId)).length
    const openQuestions =
      open.filter((g) => ids.has(g.processId)).length +
      custom.filter((q) => q.status === 'open' && ids.has(q.processId)).length
    const total = nodes.length
    if (total === 0) return { percent: 0, nodes: 0, confirmed: 0, guesses: 0, openQuestions }
    const confirmed = nodes.filter((n) => n.confidence === 'confirmed').length
    const guesses = nodes.filter((n) => n.confidence === 'guess').length
    const clean = nodes.filter((n) => !gapNodes.has(n.id)).length
    const raw = 100 * (0.5 * (confirmed / total) + 0.5 * (clean / total)) - 5 * processLevel
    return {
      percent: Math.max(0, Math.min(100, Math.round(raw))),
      nodes: total,
      confirmed,
      guesses,
      openQuestions,
    }
  }

  const result: Analysis = { gaps, open, dismissed, custom, perNode, readiness }
  cache.set(p, result)
  return result
}
