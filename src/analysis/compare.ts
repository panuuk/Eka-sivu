import { formatRange } from '../model/duration'
import { normalizeName } from '../model/selectors'
import type { Project, ProcessNode } from '../model/types'
import { analyzeMetrics } from './metrics'

/**
 * Kahden tilan (esim. nykytila ja tavoitetila) vertailu. Vaiheet tunnistetaan samoiksi tunnisteen
 * perusteella (tavoitetila on nykytilan kopio). Jäljelle jääneet poistetut ja lisätyt vaiheet
 * yhdistetään nimen ja tyypin perusteella, jos käyttäjä on luonut saman vaiheen uudelleen.
 */

export type ChangeKind = 'added' | 'removed' | 'changed'

export interface FieldChange {
  field: string
  label: string
  before: string
  after: string
}

export interface NodeChange {
  kind: ChangeKind
  label: string
  processName: string
  /** Vaiheen tunniste vertailun lähtötilassa (puuttuu lisätyiltä). */
  baseId?: string
  /** Vaiheen tunniste kohdetilassa (puuttuu poistetuilta). */
  targetId?: string
  fields: FieldChange[]
  /** Tunnistettiin samaksi nimen perusteella, ei tunnisteen. */
  matchedByLabel?: boolean
}

export interface EdgeChange {
  kind: ChangeKind
  fromLabel: string
  toLabel: string
  before?: string
  after?: string
}

export interface ProcessChange {
  kind: ChangeKind
  name: string
  before?: string
}

export interface MetricsSnapshot {
  steps: number
  decisions: number
  handoffs: number
  loops: number
  roles: number
  lead?: { best?: number; low?: number; high?: number; worst?: number }
  effort: number
  waiting: number
}

export interface Comparison {
  nodes: NodeChange[]
  edges: EdgeChange[]
  processes: ProcessChange[]
  /** Vaiheet, joiden rooli vaihtui (osajoukko `nodes`-listasta). */
  roleChanges: NodeChange[]
  /** Merkinnät kaaviopiirtoa varten: tilan oma solmutunniste -> muutos. */
  baseMarks: Map<string, Mark>
  targetMarks: Map<string, Mark>
  base: MetricsSnapshot
  target: MetricsSnapshot
  counts: {
    added: number
    removed: number
    changed: number
    edgesAdded: number
    edgesRemoved: number
  }
  /** Ei yhtään eroa. */
  identical: boolean
}

export type Mark = 'added' | 'removed' | 'changed'

const WORK = new Set(['step', 'decision', 'subprocess'])

function nameList(p: Project, ids: string[] | undefined): string[] {
  return (ids ?? []).map((i) => p.entities[i]?.name ?? '?').sort((a, b) => a.localeCompare(b, 'fi'))
}

const join = (xs: string[]) => (xs.length ? xs.join(', ') : '–')

/** Vaiheen vertailtavat kentät luettavassa muodossa. */
function fieldsOf(p: Project, n: ProcessNode): Record<string, [label: string, value: string]> {
  const role = n.roleId ? (p.entities[n.roleId]?.name ?? '?') : ''
  return {
    label: ['Nimi', n.label],
    kind: ['Tyyppi', n.kind],
    role: ['Rooli', role || '–'],
    systems: ['Järjestelmät', join(nameList(p, n.systemIds))],
    inputs: ['Syötteet', join(nameList(p, n.inputIds))],
    outputs: ['Tuotokset', join(nameList(p, n.outputIds))],
    duration: ['Työaika', formatRange(n.duration) || '–'],
    waiting: ['Odotusaika', formatRange(n.waiting) || '–'],
    frequency: ['Toistuvuus', n.frequency || '–'],
    accountable: ['Hyväksyjä (A)', join(nameList(p, n.raci?.accountableIds))],
    consulted: ['Konsultoitavat (C)', join(nameList(p, n.raci?.consultedIds))],
    informed: ['Informoitavat (I)', join(nameList(p, n.raci?.informedIds))],
    pains: ['Kipupisteet', join((n.painPoints ?? []).map((x) => x.text).sort())],
    tags: ['Tunnisteet', join([...(n.tags ?? [])].sort())],
    description: ['Kuvaus', (n.description ?? '').trim() ? 'muokattu' : '–'],
    process: ['Prosessi', p.processes[n.processId]?.name ?? '?'],
  }
}

function describeFields(
  base: Project,
  a: ProcessNode,
  target: Project,
  b: ProcessNode,
): FieldChange[] {
  const fa = fieldsOf(base, a)
  const fb = fieldsOf(target, b)
  const out: FieldChange[] = []
  for (const key of Object.keys(fa)) {
    let before = fa[key][1]
    const after = fb[key][1]
    if (key === 'description') {
      // Kuvauksen sisältö: vertaillaan tekstejä, näytetään vain että se muuttui
      const changed = (a.description ?? '').trim() !== (b.description ?? '').trim()
      if (!changed) continue
      before = (a.description ?? '').trim() ? 'muokattu' : '–'
      out.push({
        field: key,
        label: fa[key][0],
        before,
        after: (b.description ?? '').trim() ? 'muokattu' : '–',
      })
      continue
    }
    if (before !== after) out.push({ field: key, label: fa[key][0], before, after })
  }
  return out
}

function metricsSnapshot(p: Project): MetricsSnapshot {
  const m = analyzeMetrics(p)
  const root = m.perProcess.get(p.rootProcessId)
  const nodes = Object.values(p.nodes)
  const lead = root?.lead
  return {
    steps: nodes.filter((n) => n.kind === 'step' || n.kind === 'subprocess').length,
    decisions: nodes.filter((n) => n.kind === 'decision').length,
    handoffs: m.handoffCount,
    loops: m.loopCount,
    roles: new Set(nodes.filter((n) => WORK.has(n.kind) && n.roleId).map((n) => n.roleId)).size,
    lead:
      lead && lead.typicalHigh !== undefined
        ? { best: lead.best, low: lead.typicalLow, high: lead.typicalHigh, worst: lead.worst }
        : undefined,
    effort: m.perProcess.size ? [...m.perProcess.values()].reduce((s, x) => s + x.effort, 0) : 0,
    waiting: [...m.perProcess.values()].reduce((s, x) => s + x.waiting, 0),
  }
}

export function compareProjects(base: Project, target: Project): Comparison {
  const nodes: NodeChange[] = []
  const baseMarks = new Map<string, Mark>()
  const targetMarks = new Map<string, Mark>()
  const processName = (p: Project, n: ProcessNode) => p.processes[n.processId]?.name ?? ''

  const baseNodes = Object.values(base.nodes)
  const targetNodes = Object.values(target.nodes)

  // 1. Tunnisteen mukaan
  const pairs = new Map<string, string>() // base id -> target id
  const label = new Map<string, boolean>() // base id -> matched by label
  for (const n of baseNodes) if (target.nodes[n.id]) pairs.set(n.id, n.id)

  // 2. Nimen ja tyypin mukaan jäljelle jääneet
  const removed = baseNodes.filter((n) => !pairs.has(n.id))
  const addedSet = targetNodes.filter((n) => !base.nodes[n.id])
  const key = (n: ProcessNode) => `${n.kind}|${normalizeName(n.label)}`
  const pool = new Map<string, ProcessNode[]>()
  for (const n of addedSet) {
    const k = key(n)
    if (!pool.has(k)) pool.set(k, [])
    pool.get(k)!.push(n)
  }
  const usedTarget = new Set<string>()
  for (const n of removed) {
    const list = pool.get(key(n))
    // Tyhjät nimet eivät kelpaa vertailuavaimeksi
    if (!list?.length || !normalizeName(n.label)) continue
    const m = list.shift()!
    pairs.set(n.id, m.id)
    label.set(n.id, true)
    usedTarget.add(m.id)
  }

  // Muutokset
  for (const a of baseNodes) {
    const tid = pairs.get(a.id)
    if (!tid) {
      nodes.push({
        kind: 'removed',
        label: a.label,
        processName: processName(base, a),
        baseId: a.id,
        fields: [],
      })
      baseMarks.set(a.id, 'removed')
      continue
    }
    const b = target.nodes[tid]
    const fields = describeFields(base, a, target, b)
    if (fields.length) {
      nodes.push({
        kind: 'changed',
        label: b.label,
        processName: processName(target, b),
        baseId: a.id,
        targetId: b.id,
        fields,
        matchedByLabel: label.get(a.id),
      })
      baseMarks.set(a.id, 'changed')
      targetMarks.set(b.id, 'changed')
    }
  }
  for (const b of targetNodes) {
    if (base.nodes[b.id] || usedTarget.has(b.id)) continue
    nodes.push({
      kind: 'added',
      label: b.label,
      processName: processName(target, b),
      targetId: b.id,
      fields: [],
    })
    targetMarks.set(b.id, 'added')
  }

  // Yhteydet: tunnistetaan päätepisteiden vastaavuuden kautta (target-tunnisteilla)
  const toTarget = (id: string) => pairs.get(id)
  const edgeKey = (from: string, to: string) => `${from}>${to}`
  const baseEdges = new Map<string, { label?: string; from: string; to: string }>()
  for (const e of Object.values(base.edges)) {
    const f = toTarget(e.from)
    const t = toTarget(e.to)
    baseEdges.set(f && t ? edgeKey(f, t) : `x:${e.id}`, { label: e.label, from: e.from, to: e.to })
  }
  const targetEdges = new Map<string, { label?: string; from: string; to: string }>()
  for (const e of Object.values(target.edges))
    targetEdges.set(edgeKey(e.from, e.to), { label: e.label, from: e.from, to: e.to })
  const edges: EdgeChange[] = []
  for (const [k, e] of baseEdges) {
    const t = targetEdges.get(k)
    if (!t) {
      edges.push({
        kind: 'removed',
        fromLabel: base.nodes[e.from]?.label ?? '',
        toLabel: base.nodes[e.to]?.label ?? '',
      })
    } else if ((e.label ?? '') !== (t.label ?? '')) {
      edges.push({
        kind: 'changed',
        fromLabel: target.nodes[t.from]?.label ?? '',
        toLabel: target.nodes[t.to]?.label ?? '',
        before: e.label ?? '–',
        after: t.label ?? '–',
      })
    }
  }
  for (const [k, e] of targetEdges) {
    if (!baseEdges.has(k))
      edges.push({
        kind: 'added',
        fromLabel: target.nodes[e.from]?.label ?? '',
        toLabel: target.nodes[e.to]?.label ?? '',
      })
  }

  // Prosessit
  const processes: ProcessChange[] = []
  const baseProcByName = new Map(Object.values(base.processes).map((p) => [p.id, p]))
  for (const p of Object.values(base.processes)) {
    const t = target.processes[p.id]
    if (!t) processes.push({ kind: 'removed', name: p.name })
    else if (t.name !== p.name) processes.push({ kind: 'changed', name: t.name, before: p.name })
  }
  for (const p of Object.values(target.processes))
    if (!baseProcByName.has(p.id)) processes.push({ kind: 'added', name: p.name })

  const roleChanges = nodes.filter(
    (n) => n.kind === 'changed' && n.fields.some((f) => f.field === 'role'),
  )
  const counts = {
    added: nodes.filter((n) => n.kind === 'added').length,
    removed: nodes.filter((n) => n.kind === 'removed').length,
    changed: nodes.filter((n) => n.kind === 'changed').length,
    edgesAdded: edges.filter((e) => e.kind === 'added').length,
    edgesRemoved: edges.filter((e) => e.kind === 'removed').length,
  }
  return {
    nodes,
    edges,
    processes,
    roleChanges,
    baseMarks,
    targetMarks,
    base: metricsSnapshot(base),
    target: metricsSnapshot(target),
    counts,
    identical: nodes.length === 0 && edges.length === 0 && processes.length === 0,
  }
}
