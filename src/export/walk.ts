import { flowOrder } from '../model/flow'
import type { ProcessNode, Project } from '../model/types'

interface WalkStep {
  node: ProcessNode
  /** Seuraavat vaiheet haaran nimen kanssa (vain esityksessä näkyvät vaiheet). */
  next: { id: string; label?: string }[]
}

/**
 * Läpikäynnin vaiheet esityksen järjestyksessä: prosessin kulku syvyyshaulla (haarat peräkkäin).
 * Kun alaprosessit on avattu kuvaan, alaprosessin vaiheet tulevat heti alaprosessin kohdalle.
 * `visible` rajaa vaiheet niihin, jotka kuvassa näkyvät (esim. vain vahvistetut).
 */
export function walkSteps(
  p: Project,
  processId: string,
  visible: ReadonlySet<string>,
  expand: boolean,
): WalkStep[] {
  const out: WalkStep[] = []
  const seenProcesses = new Set<string>()
  const visit = (pid: string, depth: number) => {
    if (seenProcesses.has(pid) || depth > 8) return
    seenProcesses.add(pid)
    for (const row of flowOrder(p, pid)) {
      const n = row.node
      if (visible.has(n.id)) {
        out.push({
          node: n,
          next: row.next.filter((x) => visible.has(x.id)),
        })
      }
      if (expand && n.kind === 'subprocess' && n.childProcessId) visit(n.childProcessId, depth + 1)
    }
  }
  visit(processId, 0)
  return out
}
