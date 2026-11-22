import type { NodeKind, Point } from '../model/types'

/**
 * Uimaratasettelu: vaiheet ryhmitellään vastuuroolin mukaan riveille (uimaradat) ja kerrokset etenevät
 * vasemmalta oikealle. Kerrokset lasketaan pisimmän polun mukaan, takaisinpäin menevät reunat (silmukat)
 * ohitetaan, jotta ne eivät sotke järjestystä.
 */

export interface LaneNode {
  id: string
  kind: NodeKind
  roleId?: string
}
export interface LaneEdge {
  from: string
  to: string
}

export interface Lane {
  /** null = vaiheet, joilla ei ole roolia. */
  roleId: string | null
  y: number
  height: number
}

interface LaneLayout {
  lanes: Lane[]
  positions: Map<string, Point>
  /** Kerros, johon kukin solmu kuuluu (0 = ensimmäinen). */
  layers: Map<string, number>
  width: number
  height: number
}

export const LANE = {
  labelWidth: 150,
  colWidth: 260,
  rowHeight: 124,
  nodeWidth: 200,
  padX: 36,
  padY: 20,
} as const

/** Jakaa solmut kerroksiin: pisin polku alusta, silmukoiden paluureunat ohitetaan. */
export function assignLayers(nodes: LaneNode[], edges: LaneEdge[]): Map<string, number> {
  const out = new Map<string, string[]>()
  const hasIn = new Set<string>()
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, [])
    out.get(e.from)!.push(e.to)
    hasIn.add(e.to)
  }
  const ids = new Set(nodes.map((n) => n.id))
  // DFS: etsi paluureunat (reuna solmuun, joka on parhaillaan pinossa)
  const back = new Set<string>()
  const state = new Map<string, 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const to of out.get(id) ?? []) {
      if (!ids.has(to)) continue
      if (state.get(to) === 1) back.add(`${id}>${to}`)
      else if (!state.has(to)) visit(to)
    }
    state.set(id, 2)
  }
  const roots = [
    ...nodes.filter((n) => n.kind === 'start'),
    ...nodes.filter((n) => n.kind !== 'start' && !hasIn.has(n.id)),
  ]
  for (const r of roots) if (!state.has(r.id)) visit(r.id)
  for (const n of nodes) if (!state.has(n.id)) visit(n.id)

  const dagOut = new Map<string, string[]>()
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || back.has(`${e.from}>${e.to}`)) continue
    if (!dagOut.has(e.from)) dagOut.set(e.from, [])
    dagOut.get(e.from)!.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }
  const layer = new Map<string, number>()
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  for (const id of queue) layer.set(id, 0)
  while (queue.length) {
    const cur = queue.shift()!
    for (const to of dagOut.get(cur) ?? []) {
      layer.set(to, Math.max(layer.get(to) ?? 0, (layer.get(cur) ?? 0) + 1))
      indeg.set(to, indeg.get(to)! - 1)
      if (indeg.get(to) === 0) queue.push(to)
    }
  }
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, 0)
  return layer
}

export function layoutLanes(nodes: LaneNode[], edges: LaneEdge[]): LaneLayout {
  const layers = assignLayers(nodes, edges)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    if (!preds.has(e.to)) preds.set(e.to, [])
    preds.get(e.to)!.push(e.from)
    if (!succs.has(e.from)) succs.set(e.from, [])
    succs.get(e.from)!.push(e.to)
  }

  // Rata: roolillisen vaiheen oma rooli. Alku, loppu ja päätös lainaavat naapurin radan.
  // Vaihe ilman roolia menee "Ei roolia" -radalle, jolloin puute näkyy.
  const lane = new Map<string, string | null>()
  const ordered = [...nodes].sort((a, b) => (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0))
  for (const n of ordered)
    if (n.kind === 'step' || n.kind === 'subprocess') lane.set(n.id, n.roleId ?? null)
  const borrow = (n: LaneNode): string | null | undefined => {
    const lend = (ids: string[] | undefined) =>
      ids?.map((i) => lane.get(i)).find((l) => l !== undefined && l !== null)
    return (
      lend(n.kind === 'end' ? preds.get(n.id) : succs.get(n.id)) ??
      lend(preds.get(n.id)) ??
      lend(succs.get(n.id))
    )
  }
  for (const n of ordered) {
    if (lane.has(n.id)) continue
    if (n.kind === 'decision') {
      // Päätös kuuluu sille, joka sen tekee: edellisen vaiheen rata (tai rooli itse, jos annettu)
      lane.set(
        n.id,
        n.roleId ??
          preds
            .get(n.id)
            ?.map((i) => lane.get(i))
            .find((l) => l !== undefined && l !== null) ??
          borrow(n) ??
          null,
      )
    } else {
      lane.set(n.id, borrow(n) ?? null)
    }
  }
  // Toisella kierroksella alut ja loput voivat lainata päätösten ratoja
  for (const n of ordered)
    if ((n.kind === 'start' || n.kind === 'end') && lane.get(n.id) == null)
      lane.set(n.id, borrow(n) ?? null)

  // Ratojen järjestys: ensiesiintymisjärjestys kerroksen mukaan, "Ei roolia" viimeisenä
  const laneOrder: (string | null)[] = []
  for (const n of ordered) {
    const l = lane.get(n.id) ?? null
    if (l !== null && !laneOrder.includes(l)) laneOrder.push(l)
  }
  if ([...lane.values()].some((l) => l === null)) laneOrder.push(null)
  if (laneOrder.length === 0) laneOrder.push(null)

  // Sijoitus: sarake = kerros, rivi = radan sisällä pinottu
  const cell = new Map<string, number>()
  const used = new Map<string, number>()
  const maxRows = new Map<string | null, number>()
  for (const n of ordered) {
    const l = lane.get(n.id) ?? null
    const key = `${l}|${layers.get(n.id)}`
    const row = used.get(key) ?? 0
    used.set(key, row + 1)
    cell.set(n.id, row)
    maxRows.set(l, Math.max(maxRows.get(l) ?? 1, row + 1))
  }

  const lanes: Lane[] = []
  const laneTop = new Map<string | null, number>()
  let y = 0
  for (const l of laneOrder) {
    const rows = maxRows.get(l) ?? 1
    const height = rows * LANE.rowHeight + LANE.padY
    lanes.push({ roleId: l, y, height })
    laneTop.set(l, y)
    y += height
  }

  const positions = new Map<string, Point>()
  let maxLayer = 0
  for (const n of nodes) {
    const l = lane.get(n.id) ?? null
    const layerIdx = layers.get(n.id) ?? 0
    maxLayer = Math.max(maxLayer, layerIdx)
    positions.set(n.id, {
      x: LANE.labelWidth + LANE.padX + layerIdx * LANE.colWidth,
      y:
        (laneTop.get(l) ?? 0) +
        LANE.padY / 2 +
        (cell.get(n.id) ?? 0) * LANE.rowHeight +
        (LANE.rowHeight - 72) / 2 -
        8,
    })
  }
  return {
    lanes,
    positions,
    layers,
    width: LANE.labelWidth + LANE.padX * 2 + (maxLayer + 1) * LANE.colWidth,
    height: y,
  }
}
