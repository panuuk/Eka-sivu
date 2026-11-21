import { normalizeName } from './selectors'
import type { Entity, Process, ProcessEdge, ProcessNode, Project, Question, Source } from './types'
import { validateProject } from './validate'

/**
 * Laitteiden välinen yhdistäminen. Jokaisella tietueella on muokkausaika (`stamps`) ja poistetuilla
 * poistoaika (`tombstones`), jotka sivutaulut pitävät erillään tietueista. Muokkausajat päivitetään
 * tallennuksen yhteydessä vertaamalla tietueiden viitteitä (`stampChanges`), joten operaatiot pysyvät puhtaina.
 */

const COLLECTIONS = ['processes', 'nodes', 'edges', 'entities', 'sources', 'questions'] as const
type Collection = (typeof COLLECTIONS)[number]

const MAX_TOMBSTONES = 2000

/** Päivittää muokkausajat ja poistomerkinnät `before` -> `after` -muutoksesta. Palauttaa `after`in, jos mikään ei muuttunut. */
export function stampChanges(before: Project, after: Project, now: number): Project {
  if (before === after) return after
  let stamps: Record<string, number> | undefined
  let tombstones: Record<string, number> | undefined
  const stamp = (id: string) => {
    stamps ??= { ...after.stamps }
    stamps[id] = now
  }
  for (const c of COLLECTIONS) {
    const a = after[c] as Record<string, unknown>
    const b = before[c] as Record<string, unknown>
    if (a === b) continue
    for (const id in a) if (a[id] !== b[id]) stamp(id)
    for (const id in b) {
      if (id in a) continue
      tombstones ??= { ...after.tombstones }
      tombstones[id] = now
      if (after.stamps?.[id] !== undefined || stamps) {
        stamps ??= { ...after.stamps }
        delete stamps[id]
      }
    }
  }
  if (!stamps && !tombstones) return after
  if (tombstones) {
    const keys = Object.keys(tombstones)
    if (keys.length > MAX_TOMBSTONES) {
      const keep = keys.sort((x, y) => tombstones![y] - tombstones![x]).slice(0, MAX_TOMBSTONES)
      tombstones = Object.fromEntries(keep.map((k) => [k, tombstones![k]]))
    }
  }
  return {
    ...after,
    ...(stamps ? { stamps } : {}),
    ...(tombstones ? { tombstones } : {}),
  }
}

// ---------- Yhdistäminen ----------

export type MergeChangeKind =
  | 'new-incoming' // vain tiedostossa
  | 'new-local' // vain tällä laitteella
  | 'changed' // eroaa, molemmissa
  | 'deleted-in-incoming' // poistettu tiedostossa, mutta täällä vielä
  | 'deleted-local' // poistettu täällä, mutta tiedostossa vielä (muokattu poiston jälkeen)

export interface MergeChange {
  id: string
  collection: Collection
  label: string
  kind: MergeChangeKind
  /** Oletuksena voittava puoli: uudempi muokkaus. */
  winner: 'local' | 'incoming'
}

export interface MergePlan {
  changes: MergeChange[]
  /** Muutokset, joissa käyttäjän valinnalla ei ole merkitystä (uudet, vain toisella puolella). */
  counts: Record<MergeChangeKind, number>
}

export type Decisions = ReadonlyMap<string, 'local' | 'incoming'>

type Rec = Record<string, unknown> & { id: string }

const labelOf = (c: Collection, r: Rec): string => {
  if (c === 'nodes') return (r as unknown as ProcessNode).label || 'Vaihe'
  if (c === 'edges') return 'Yhteys'
  if (c === 'questions') return (r as unknown as Question).text.slice(0, 60)
  if (c === 'sources') return (r as unknown as Source).title
  return (r as unknown as Process | Entity).name
}

/** Sijainnit ja lukitus eivät ole sisällöllisiä eroja. */
const content = (r: Rec): string => {
  const { position: _p, locked: _l, ...rest } = r as Record<string, unknown>
  void _p
  void _l
  return JSON.stringify(rest, Object.keys(rest).sort())
}

/** Tietue, jota ei ole muokattu leimojen aikana, on vanhin mahdollinen. */
const stampOf = (p: Project, id: string) => p.stamps?.[id] ?? 0

/**
 * Tiedoston samannimiset roolit, järjestelmät ja tuotokset yhdistetään tämän laitteen vastaaviin, vaikka
 * tunnisteet olisivat eri (sama asia luotu kummallakin laitteella erikseen).
 */
function remapEntities(local: Project, incoming: Project): Project {
  const byKey = new Map<string, string>()
  for (const e of Object.values(local.entities))
    byKey.set(`${e.kind}|${normalizeName(e.name)}`, e.id)
  const map = new Map<string, string>()
  for (const e of Object.values(incoming.entities)) {
    if (local.entities[e.id]) continue
    const same = byKey.get(`${e.kind}|${normalizeName(e.name)}`)
    if (same && same !== e.id) map.set(e.id, same)
  }
  if (map.size === 0) return incoming
  const m = (id: string) => map.get(id) ?? id
  const mm = (ids?: string[]) => (ids ? [...new Set(ids.map(m))] : ids)
  const entities = { ...incoming.entities }
  for (const id of map.keys()) delete entities[id]
  const nodes: Record<string, ProcessNode> = {}
  for (const n of Object.values(incoming.nodes)) {
    nodes[n.id] = {
      ...n,
      roleId: n.roleId ? m(n.roleId) : undefined,
      systemIds: mm(n.systemIds)!,
      inputIds: mm(n.inputIds)!,
      outputIds: mm(n.outputIds)!,
      raci: n.raci
        ? {
            accountableIds: mm(n.raci.accountableIds),
            consultedIds: mm(n.raci.consultedIds),
            informedIds: mm(n.raci.informedIds),
          }
        : undefined,
    }
  }
  return { ...incoming, entities, nodes }
}

/** Laskee erot ja oletusvalinnat. Molemmat projektit ovat saman projektin kopioita (sama tunniste). */
export function planMerge(local: Project, incomingRaw: Project): MergePlan {
  const incoming = remapEntities(local, incomingRaw)
  const changes: MergeChange[] = []
  for (const c of COLLECTIONS) {
    const L = local[c] as unknown as Record<string, Rec>
    const I = incoming[c] as unknown as Record<string, Rec>
    const ids = new Set([...Object.keys(L), ...Object.keys(I)])
    for (const id of ids) {
      const l = L[id]
      const i = I[id]
      if (l && i) {
        if (content(l) === content(i)) continue
        const lt = stampOf(local, id)
        const it = stampOf(incoming, id)
        changes.push({
          id,
          collection: c,
          label: labelOf(c, l),
          kind: 'changed',
          winner: it > lt ? 'incoming' : 'local',
        })
      } else if (l) {
        const tomb = incoming.tombstones?.[id]
        if (tomb !== undefined && tomb >= stampOf(local, id))
          changes.push({
            id,
            collection: c,
            label: labelOf(c, l),
            kind: 'deleted-in-incoming',
            winner: 'incoming',
          })
        else
          changes.push({
            id,
            collection: c,
            label: labelOf(c, l),
            kind: 'new-local',
            winner: 'local',
          })
      } else if (i) {
        const tomb = local.tombstones?.[id]
        if (tomb !== undefined && tomb >= stampOf(incoming, id))
          changes.push({
            id,
            collection: c,
            label: labelOf(c, i),
            kind: 'deleted-local',
            winner: 'local',
          })
        else
          changes.push({
            id,
            collection: c,
            label: labelOf(c, i),
            kind: 'new-incoming',
            winner: 'incoming',
          })
      }
    }
  }
  const counts: Record<MergeChangeKind, number> = {
    'new-incoming': 0,
    'new-local': 0,
    changed: 0,
    'deleted-in-incoming': 0,
    'deleted-local': 0,
  }
  for (const ch of changes) counts[ch.kind]++
  return { changes, counts }
}

export class MergeError extends Error {}

/**
 * Yhdistää tiedoston tähän projektiin. `decisions` ohittaa oletusvalinnan tunnisteen mukaan
 * (`local` säilyttää tämän laitteen version tai poistamattoman, `incoming` ottaa tiedoston version).
 */
export function mergeProjects(
  local: Project,
  incomingRaw: Project,
  decisions: Decisions = new Map(),
): Project {
  const incoming = remapEntities(local, incomingRaw)
  const plan = planMerge(local, incomingRaw)
  const winner = new Map(plan.changes.map((c) => [c.id, decisions.get(c.id) ?? c.winner]))

  const out: Record<Collection, Record<string, unknown>> = {
    processes: {},
    nodes: {},
    edges: {},
    entities: {},
    sources: {},
    questions: {},
  }
  const stamps: Record<string, number> = {}
  for (const c of COLLECTIONS) {
    const L = local[c] as unknown as Record<string, Rec>
    const I = incoming[c] as unknown as Record<string, Rec>
    for (const id of new Set([...Object.keys(L), ...Object.keys(I)])) {
      const l = L[id]
      const i = I[id]
      const w = winner.get(id)
      let pick: Rec | undefined
      let from: 'local' | 'incoming' = 'local'
      if (l && i) {
        pick = w === 'incoming' ? i : l
        from = w === 'incoming' ? 'incoming' : 'local'
      } else if (l) {
        // Vain täällä: poistettu tiedostossa -> poistetaan, jos valinta on `incoming`
        const deletedThere = plan.changes.some(
          (c) => c.id === id && c.kind === 'deleted-in-incoming',
        )
        pick = deletedThere && w === 'incoming' ? undefined : l
      } else if (i) {
        const deletedHere = plan.changes.some((c) => c.id === id && c.kind === 'deleted-local')
        // Poistettu täällä: palautetaan vain, jos käyttäjä valitsi tiedoston version
        pick = deletedHere && w !== 'incoming' ? undefined : i
        from = 'incoming'
      }
      if (!pick) continue
      out[c][id] = pick
      const st = (from === 'incoming' ? incoming : local).stamps?.[id]
      if (st !== undefined) stamps[id] = st
    }
  }

  // Eheys: poista viittaukset, joiden kohde puuttuu
  const processes = out.processes as Record<string, Process>
  const entities = out.entities as Record<string, Entity>
  const sources = out.sources as Record<string, Source>
  let nodes = out.nodes as Record<string, ProcessNode>
  const edges: Record<string, ProcessEdge> = {}
  const questions: Record<string, Question> = {}

  nodes = Object.fromEntries(
    Object.entries(nodes).filter(([, n]) => processes[n.processId]),
  ) as Record<string, ProcessNode>
  const ent = (id?: string) => (id && entities[id] ? id : undefined)
  const ents = (ids?: string[]) => ids?.filter((x) => entities[x])
  for (const n of Object.values(nodes)) {
    const raci = n.raci
      ? {
          accountableIds: ents(n.raci.accountableIds),
          consultedIds: ents(n.raci.consultedIds),
          informedIds: ents(n.raci.informedIds),
        }
      : undefined
    nodes[n.id] = {
      ...n,
      roleId: ent(n.roleId),
      systemIds: ents(n.systemIds) ?? [],
      inputIds: ents(n.inputIds) ?? [],
      outputIds: ents(n.outputIds) ?? [],
      raci,
      sources: n.sources.filter((r) => sources[r.sourceId]),
      childProcessId:
        n.childProcessId && processes[n.childProcessId] ? n.childProcessId : undefined,
    }
  }
  // Alaprosessin ja vanhempivaiheen on viitattava toisiinsa
  for (const pr of Object.values(processes)) {
    if (!pr.parentNodeId) continue
    const parent = nodes[pr.parentNodeId]
    if (!parent) delete processes[pr.id]
    else if (parent.childProcessId !== pr.id)
      nodes[parent.id] = { ...parent, childProcessId: pr.id }
  }
  for (const n of Object.values(nodes)) {
    if (n.childProcessId && !processes[n.childProcessId])
      nodes[n.id] = { ...n, childProcessId: undefined }
  }
  for (const e of Object.values(out.edges as Record<string, ProcessEdge>)) {
    const a = nodes[e.from]
    const b = nodes[e.to]
    if (a && b && a.processId === e.processId && b.processId === e.processId) edges[e.id] = e
  }
  for (const q of Object.values(out.questions as Record<string, Question>)) {
    if (processes[q.processId] && (!q.targetId || nodes[q.targetId])) questions[q.id] = q
  }

  const tombstones: Record<string, number> = { ...local.tombstones }
  for (const [id, t] of Object.entries(incoming.tombstones ?? {}))
    tombstones[id] = Math.max(tombstones[id] ?? 0, t)
  // Tietue, joka on mukana tuloksessa, ei ole poistettu
  for (const id of [...Object.keys(nodes), ...Object.keys(processes), ...Object.keys(entities)])
    delete tombstones[id]

  const merged: Project = {
    ...local,
    name: incoming.updatedAt > local.updatedAt ? incoming.name : local.name,
    updatedAt: Date.now(),
    processes,
    nodes,
    edges,
    entities,
    sources,
    questions,
    versions: { ...incoming.versions, ...local.versions },
    scenarios:
      local.scenarios || incoming.scenarios
        ? { ...incoming.scenarios, ...local.scenarios }
        : undefined,
    stamps,
    tombstones: Object.keys(tombstones).length ? tombstones : undefined,
  }
  if (!merged.versions || Object.keys(merged.versions).length === 0) delete merged.versions
  const issues = validateProject(merged)
  if (issues.length) throw new MergeError(`Yhdistäminen epäonnistui: ${issues[0].message}`)
  return merged
}
