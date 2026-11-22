import { maxOf, minOf, typicalOf } from '../model/duration'
import type { ProcessEdge, ProcessNode, Project } from '../model/types'
import { indexGraph, type GraphIndex } from './gaps'

/**
 * Tietotyön mittarit: luovutukset roolien välillä, läpimenoaika polkua pitkin, uudelleenkierrokset ja
 * roolien kuormitus. Kaikki lasketaan mallista, ja arviot ovat vain niin hyviä kuin annetut kestot.
 */

const WORK_KINDS = new Set(['step', 'decision', 'subprocess'])

interface Handoff {
  edgeId: string
  fromId: string
  toId: string
  fromRoleId: string
  toRoleId: string
  processId: string
  /** Vastaanottavan vaiheen odotusaika (min, tyypillinen), jos arvioitu. */
  waiting?: number
}

interface RolePair {
  fromRoleId: string
  toRoleId: string
  count: number
  waiting: number
}

interface Loop {
  fromId: string
  toId: string
  processId: string
  /** Kierroksen vaiheet (ilman paluuyhteyttä). */
  nodeIds: string[]
  /** Yhden lisäkierroksen arvioitu kesto (työ + odotus), jos kestoja on. */
  extraMinutes?: number
}

interface PathEstimate {
  /** Nopein polku minimiarvoilla. */
  best?: number
  /** Lyhin ja pisin polku tyypillisillä arvoilla. */
  typicalLow?: number
  typicalHigh?: number
  /** Hitain polku maksimiarvoilla. */
  worst?: number
  /** Kriittinen (pisin tyypillinen) polku solmuina. */
  criticalPath: string[]
  /** Polun vaiheet, joilla on kestoarvio, ja kaikki työvaiheet polulla. */
  coveredSteps: number
  pathSteps: number
}

interface RoleLoad {
  roleId: string | undefined
  steps: number
  /** Tyypillinen työaika yhteensä (min). */
  effort: number
  /** Tyypillinen odotus ennen näitä vaiheita yhteensä (min). */
  waiting: number
}

interface ProcessMetrics {
  processId: string
  handoffs: Handoff[]
  loops: Loop[]
  lead: PathEstimate
  /** Työvaiheiden (ilman alaprosesseja) kestoarvioiden summa. */
  effort: number
  waiting: number
  /** Työvaiheita ja niistä arvioituja. */
  workSteps: number
  estimatedSteps: number
}

interface Metrics extends ScopeSummary {
  perProcess: Map<string, ProcessMetrics>
  /** Solmu -> arvioitu aika (työ + odotus), lämpökarttaa varten. */
  nodeTime: Map<string, number>
  maxNodeTime: number
  /** Vaiheet, joihin tullaan toisen roolin vaiheesta (luovutuksen vastaanottajat). */
  handoffTargets: Set<string>
}

interface Weights {
  min?: number
  typ?: number
  max?: number
}

function sumDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined
  return (a ?? 0) + (b ?? 0)
}

function ownWeights(n: ProcessNode): Weights {
  return {
    min: sumDefined(minOf(n.duration), minOf(n.waiting)),
    typ: sumDefined(typicalOf(n.duration), typicalOf(n.waiting)),
    max: sumDefined(maxOf(n.duration), maxOf(n.waiting)),
  }
}

/** Paluuyhteydet (DFS:n takareunat). Loput reunat muodostavat syklittömän graafin. */
function findBackEdges(
  nodes: ProcessNode[],
  out: Map<string, ProcessEdge[]>,
): { back: Set<string>; order: string[] } {
  const state = new Map<string, 0 | 1 | 2>()
  const back = new Set<string>()
  const order: string[] = []
  const ids = new Set(nodes.map((n) => n.id))
  const roots = [
    ...nodes.filter((n) => n.kind === 'start'),
    ...nodes.filter((n) => n.kind !== 'start'),
  ]
  const visit = (start: string) => {
    // Iteratiivinen DFS: suuret prosessit eivät kaada pinoa.
    const stack: { id: string; i: number }[] = [{ id: start, i: 0 }]
    state.set(start, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const edges = out.get(top.id) ?? []
      if (top.i < edges.length) {
        const e = edges[top.i++]
        if (!ids.has(e.to)) continue
        const st = state.get(e.to) ?? 0
        if (st === 1) back.add(e.id)
        else if (st === 0) {
          state.set(e.to, 1)
          stack.push({ id: e.to, i: 0 })
        }
      } else {
        state.set(top.id, 2)
        order.push(top.id)
        stack.pop()
      }
    }
  }
  for (const n of roots) if ((state.get(n.id) ?? 0) === 0) visit(n.id)
  // order on käänteinen topologinen järjestys
  return { back, order: order.reverse() }
}

export function analyzeMetrics(p: Project, index: GraphIndex = indexGraph(p)): Metrics {
  const perProcess = new Map<string, ProcessMetrics>()
  const nodeTime = new Map<string, number>()
  const subprocessWeights = new Map<string, Weights>()

  const computeProcess = (processId: string): ProcessMetrics => {
    const hit = perProcess.get(processId)
    if (hit) return hit
    const nodes = index.nodesByProcess.get(processId) ?? []
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const roleOf = (n: ProcessNode | undefined) => n?.roleId

    // Alaprosessien kestot ensin (hierarkia on puu, joten rekursio päättyy)
    const weightOf = (n: ProcessNode): Weights => {
      const own = ownWeights(n)
      if (
        n.childProcessId &&
        own.typ === undefined &&
        own.min === undefined &&
        own.max === undefined
      ) {
        const child = computeProcess(n.childProcessId)
        const w: Weights = {
          min: child.lead.best,
          typ: child.lead.typicalHigh,
          max: child.lead.worst,
        }
        subprocessWeights.set(n.id, w)
        return w
      }
      return own
    }

    const { back, order } = findBackEdges(nodes, index.out)

    // Luovutukset
    const handoffs: Handoff[] = []
    for (const e of index.edgesByProcess.get(processId) ?? []) {
      const from = byId.get(e.from)
      const to = byId.get(e.to)
      if (!from || !to || !WORK_KINDS.has(from.kind) || !WORK_KINDS.has(to.kind)) continue
      const a = roleOf(from)
      const b = roleOf(to)
      if (a && b && a !== b) {
        handoffs.push({
          edgeId: e.id,
          fromId: from.id,
          toId: to.id,
          fromRoleId: a,
          toRoleId: b,
          processId,
          waiting: typicalOf(to.waiting),
        })
      }
    }

    // Reitit: DP syklittömässä graafissa
    const w = new Map(nodes.map((n) => [n.id, weightOf(n)]))
    for (const n of nodes) {
      const t = w.get(n.id)!.typ
      if (t !== undefined) nodeTime.set(n.id, t)
    }
    const forward = (id: string) =>
      (index.out.get(id) ?? []).filter((e) => !back.has(e.id) && byId.has(e.to))
    const hasIn = new Set<string>()
    for (const n of nodes) for (const e of forward(n.id)) hasIn.add(e.to)
    const sources = nodes.filter((n) => n.kind === 'start' || !hasIn.has(n.id))
    const isSink = (n: ProcessNode) => forward(n.id).length === 0

    interface Best {
      min: number
      typLow: number
      typHigh: number
      max: number
      prevHigh?: string
    }
    const best = new Map<string, Best>()
    for (const id of order) {
      const n = byId.get(id)
      if (!n) continue
      const own = w.get(id)!
      const preds = (index.inc.get(id) ?? []).filter((e) => !back.has(e.id) && best.has(e.from))
      const base: Best = { min: 0, typLow: 0, typHigh: 0, max: 0 }
      if (preds.length > 0 && !sources.includes(n)) {
        const ps = preds.map((e) => ({ id: e.from, b: best.get(e.from)! }))
        base.min = Math.min(...ps.map((x) => x.b.min))
        base.typLow = Math.min(...ps.map((x) => x.b.typLow))
        const hi = ps.reduce((a, b) => (b.b.typHigh > a.b.typHigh ? b : a))
        base.typHigh = hi.b.typHigh
        base.prevHigh = hi.id
        base.max = Math.max(...ps.map((x) => x.b.max))
      }
      best.set(id, {
        min: base.min + (own.min ?? own.typ ?? 0),
        typLow: base.typLow + (own.typ ?? 0),
        typHigh: base.typHigh + (own.typ ?? 0),
        max: base.max + (own.max ?? own.typ ?? 0),
        prevHigh: base.prevHigh,
      })
    }
    const sinks = nodes.filter((n) => best.has(n.id) && isSink(n))
    let lead: PathEstimate = { criticalPath: [], coveredSteps: 0, pathSteps: 0 }
    const anyEstimate = nodes.some((n) => {
      const x = w.get(n.id)!
      return x.min !== undefined || x.typ !== undefined || x.max !== undefined
    })
    if (anyEstimate && sinks.length) {
      const bSinks = sinks.map((s) => ({ id: s.id, b: best.get(s.id)! }))
      const worstSink = bSinks.reduce((a, b) => (b.b.typHigh > a.b.typHigh ? b : a))
      const critical: string[] = []
      for (let cur: string | undefined = worstSink.id; cur; cur = best.get(cur)?.prevHigh) {
        critical.push(cur)
      }
      critical.reverse()
      const workOnPath = critical.map((id) => byId.get(id)!).filter((n) => WORK_KINDS.has(n.kind))
      lead = {
        best: Math.min(...bSinks.map((x) => x.b.min)),
        typicalLow: Math.min(...bSinks.map((x) => x.b.typLow)),
        typicalHigh: worstSink.b.typHigh,
        worst: Math.max(...bSinks.map((x) => x.b.max)),
        criticalPath: critical,
        coveredSteps: workOnPath.filter((n) => {
          const x = w.get(n.id)!
          return x.typ !== undefined || x.min !== undefined || x.max !== undefined
        }).length,
        pathSteps: workOnPath.length,
      }
    }

    // Kierrokset: kierroksen vaiheet = solmut, jotka ovat `to`:sta tavoitettavissa ja joista pääsee `from`:iin
    const loops: Loop[] = []
    const reachFrom = (
      start: string,
      edgesOf: (id: string) => ProcessEdge[],
      pick: 'to' | 'from',
    ) => {
      const seen = new Set([start])
      const stack = [start]
      while (stack.length) {
        for (const e of edgesOf(stack.pop()!)) {
          const nxt = pick === 'to' ? e.to : e.from
          if (!seen.has(nxt) && byId.has(nxt) && !back.has(e.id)) {
            seen.add(nxt)
            stack.push(nxt)
          }
        }
      }
      return seen
    }
    for (const e of index.edgesByProcess.get(processId) ?? []) {
      if (!back.has(e.id)) continue
      const down = reachFrom(e.to, (id) => index.out.get(id) ?? [], 'to')
      const up = reachFrom(e.from, (id) => index.inc.get(id) ?? [], 'from')
      const ids = [...down].filter((id) => up.has(id))
      const minutes = ids.reduce((s, id) => s + (w.get(id)?.typ ?? 0), 0)
      loops.push({
        fromId: e.from,
        toId: e.to,
        processId,
        nodeIds: ids,
        extraMinutes: ids.some((id) => w.get(id)?.typ !== undefined) ? minutes : undefined,
      })
    }

    const workNodes = nodes.filter((n) => WORK_KINDS.has(n.kind) && !n.childProcessId)
    const result: ProcessMetrics = {
      processId,
      handoffs,
      loops,
      lead,
      effort: workNodes.reduce((s, n) => s + (typicalOf(n.duration) ?? 0), 0),
      waiting: workNodes.reduce((s, n) => s + (typicalOf(n.waiting) ?? 0), 0),
      workSteps: workNodes.length,
      estimatedSteps: workNodes.filter(
        (n) => typicalOf(n.duration) !== undefined || typicalOf(n.waiting) !== undefined,
      ).length,
    }
    perProcess.set(processId, result)
    return result
  }

  for (const id of Object.keys(p.processes)) computeProcess(id)

  const all = summarizeScope(p, perProcess, Object.keys(p.processes))
  return {
    perProcess,
    ...all,
    nodeTime,
    maxNodeTime: Math.max(0, ...nodeTime.values()),
    handoffTargets: new Set([...perProcess.values()].flatMap((m) => m.handoffs.map((h) => h.toId))),
  }
}

interface ScopeSummary {
  rolePairs: RolePair[]
  roleLoad: RoleLoad[]
  handoffCount: number
  loopCount: number
  handoffs: Handoff[]
  loops: Loop[]
  painPoints: {
    nodeId: string
    processId: string
    id: string
    text: string
    severity: number
    idea?: string
  }[]
  effort: number
  waiting: number
}

/** Yhteenveto valituista prosesseista (esim. nykyinen prosessi alaprosesseineen tai koko projekti). */
export function summarizeScope(
  p: Project,
  perProcess: Map<string, ProcessMetrics>,
  processIds: string[],
): ScopeSummary {
  const ids = new Set(processIds)
  const pairs = new Map<string, RolePair>()
  const handoffs: Handoff[] = []
  const loops: Loop[] = []
  for (const id of ids) {
    const m = perProcess.get(id)
    if (!m) continue
    handoffs.push(...m.handoffs)
    loops.push(...m.loops)
  }
  for (const h of handoffs) {
    const key = `${h.fromRoleId}>${h.toRoleId}`
    const cur = pairs.get(key) ?? {
      fromRoleId: h.fromRoleId,
      toRoleId: h.toRoleId,
      count: 0,
      waiting: 0,
    }
    cur.count++
    cur.waiting += h.waiting ?? 0
    pairs.set(key, cur)
  }
  const loads = new Map<string | undefined, RoleLoad>()
  let effort = 0
  let waiting = 0
  const nodes = Object.values(p.nodes).filter((n) => ids.has(n.processId))
  for (const n of nodes) {
    if (!WORK_KINDS.has(n.kind) || n.childProcessId) continue
    const cur = loads.get(n.roleId) ?? { roleId: n.roleId, steps: 0, effort: 0, waiting: 0 }
    cur.steps++
    cur.effort += typicalOf(n.duration) ?? 0
    cur.waiting += typicalOf(n.waiting) ?? 0
    effort += typicalOf(n.duration) ?? 0
    waiting += typicalOf(n.waiting) ?? 0
    loads.set(n.roleId, cur)
  }
  const painPoints = nodes.flatMap((n) =>
    (n.painPoints ?? []).map((pp) => ({
      nodeId: n.id,
      processId: n.processId,
      id: pp.id,
      text: pp.text,
      severity: pp.severity,
      idea: pp.idea,
    })),
  )
  return {
    rolePairs: [...pairs.values()].sort((a, b) => b.count - a.count || b.waiting - a.waiting),
    roleLoad: [...loads.values()].sort(
      (a, b) => b.effort + b.waiting - (a.effort + a.waiting) || b.steps - a.steps,
    ),
    handoffCount: handoffs.length,
    loopCount: loops.length,
    handoffs,
    loops,
    painPoints: painPoints.sort((a, b) => b.severity - a.severity),
    effort,
    waiting,
  }
}

const cache = new WeakMap<Project, Metrics>()
export function metricsOf(p: Project): Metrics {
  let m = cache.get(p)
  if (!m) {
    m = analyzeMetrics(p)
    cache.set(p, m)
  }
  return m
}
