import { scenarioPath, type ScenarioPath } from '../model/scenario'
import type { Project, SavedView } from '../model/types'
import type { RenderGraph } from './graph'
import { buildGraph, comparisonFor, svgOptions, type ExportRequest } from './run'
import { renderSvg } from './svg'

/** Pyyntö, jossa tallennetun näkymän asetukset korvaavat esitysasetukset. */
export function requestForView(req: ExportRequest, view: SavedView): ExportRequest {
  return {
    ...req,
    processId: view.processId,
    options: {
      ...req.options,
      expand: view.expand,
      onlyConfirmed: view.onlyConfirmed,
      showMetrics: view.showMetrics,
      heat: view.heat,
      changes: view.changes,
    },
    comparison: view.changes ? comparisonFor(req.project) : undefined,
  }
}

/** Näkymän polku, jos se viittaa skenaarioon, joka on olemassa. */
function pathForView(project: Project, view: SavedView): ScenarioPath | undefined {
  const sc = view.scenarioId ? project.scenarios?.[view.scenarioId] : undefined
  return sc && project.processes[sc.processId]
    ? scenarioPath(project, sc.processId, sc.choices)
    : undefined
}

export function pathOption(path: ScenarioPath | undefined) {
  return path ? { nodes: new Set(path.nodeIds), edges: path.edgeIds, order: path.order } : undefined
}

/** Rajausalue: kohdevaiheiden ympäristö graafin koordinaateissa. */
export function cropFor(graph: RenderGraph, nodeIds: readonly string[] | undefined, pad = 48) {
  if (!nodeIds?.length) return undefined
  const set = new Set(nodeIds)
  const picked = graph.nodes.filter((n) => set.has(n.id))
  if (!picked.length) return undefined
  const x0 = Math.min(...picked.map((n) => n.x)) - pad
  const y0 = Math.min(...picked.map((n) => n.y)) - pad
  const x1 = Math.max(...picked.map((n) => n.x + n.w)) + pad
  const y1 = Math.max(...picked.map((n) => n.y + n.h)) + pad
  return {
    x: Math.max(0, x0),
    y: Math.max(0, y0),
    width: x1 - Math.max(0, x0),
    height: y1 - Math.max(0, y0),
  }
}

interface RenderedView {
  svg: string
  graph: RenderGraph
  path?: ScenarioPath
  /** Kuvan koko pikseleinä (SVG:n width ja height). */
  width: number
  height: number
}

/** Piirtää tallennetun näkymän SVG:ksi (rajaus, skenaariopolku, lämpökartta ja muutosten korostus mukana). */
export async function renderView(
  project: Project,
  view: SavedView,
  base: ExportRequest,
  extra: { highlight?: { current?: string; visited?: ReadonlySet<string> } } = {},
): Promise<RenderedView> {
  const req = requestForView({ ...base, project }, view)
  const graph = await buildGraph(req, { processId: view.processId })
  const path = pathForView(project, view)
  const crop = cropFor(graph, view.focusNodeIds)
  const svg = renderSvg(graph, {
    ...svgOptions(req, view.name),
    path: pathOption(path),
    crop,
    highlight: extra.highlight,
  })
  const m = /width="(\d+)" height="(\d+)"/.exec(svg)
  return { svg, graph, path, width: Number(m?.[1] ?? 0), height: Number(m?.[2] ?? 0) }
}
