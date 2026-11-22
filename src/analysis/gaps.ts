import { leadingRoleMention } from '../capture/suggest'
import { flowOrder } from '../model/flow'
import { normalizeName } from '../model/selectors'
import type { ProcessEdge, ProcessNode } from '../model/types'
import type { Project } from '../model/types'

/**
 * Aukkosäännöt: löytävät mallista kohdat, joissa tieto puuttuu tai on epäselvää, ja muotoilevat ne
 * kysymyksiksi. Aukot lasketaan mallista aina uudelleen; tallennetaan vain käyttäjän päätökset (ohitukset).
 */

type GapRule =
  | 'no-role'
  | 'decision-branches'
  | 'decision-labels'
  | 'unreachable'
  | 'dead-end'
  | 'no-start'
  | 'no-end'
  | 'artifact-source'
  | 'output-unused'
  | 'guess-unsourced'
  | 'source-conflict'
  | 'empty-subprocess'
  | 'duplicate-label'
  | 'no-label'

type Severity = 'high' | 'medium' | 'low'

export interface Gap {
  /** Vakaa avain: sama aukko tunnistetaan samaksi ajojen välillä (ohitukset perustuvat tähän). */
  key: string
  rule: GapRule
  processId: string
  targetId?: string
  entityId?: string
  severity: Severity
  text: string
  /** Sääntökohtaista lisätietoa vastauslomakkeille. */
  data?: Record<string, unknown>
}

const SIMILAR_THRESHOLD = 0.75

/** Nimen sanavartalot (5 ensimmäistä kirjainta), joilla taivutusmuodot ja johdokset yhtyvät. Alle kahden sanan nimet eivät kelpaa. */
function similarityTokens(label: string): Set<string> | null {
  const stems = label
    .toLocaleLowerCase('fi')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 5))
  const set = new Set(stems)
  return set.size >= 2 ? set : null
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** Solmut ja reunat prosesseittain sekä reunat solmuittain: rakennetaan kerran, jotta analyysi on lineaarinen. */
export interface GraphIndex {
  nodesByProcess: Map<string, ProcessNode[]>
  edgesByProcess: Map<string, ProcessEdge[]>
  out: Map<string, ProcessEdge[]>
  inc: Map<string, ProcessEdge[]>
}

export function indexGraph(p: Project): GraphIndex {
  const nodesByProcess = new Map<string, ProcessNode[]>()
  const edgesByProcess = new Map<string, ProcessEdge[]>()
  const out = new Map<string, ProcessEdge[]>()
  const inc = new Map<string, ProcessEdge[]>()
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    const list = m.get(k)
    if (list) list.push(v)
    else m.set(k, [v])
  }
  for (const n of Object.values(p.nodes)) push(nodesByProcess, n.processId, n)
  for (const e of Object.values(p.edges)) {
    push(edgesByProcess, e.processId, e)
    push(out, e.from, e)
    push(inc, e.to, e)
  }
  return { nodesByProcess, edgesByProcess, out, inc }
}

/** Solmut, joihin alkupisteistä pääsee seuraamalla reunoja. */
function reach(starts: string[], out: Map<string, ProcessEdge[]>): Set<string> {
  const seen = new Set(starts)
  const stack = [...starts]
  while (stack.length) {
    for (const e of out.get(stack.pop()!) ?? []) {
      if (!seen.has(e.to)) {
        seen.add(e.to)
        stack.push(e.to)
      }
    }
  }
  return seen
}

export function findGaps(p: Project, index: GraphIndex = indexGraph(p)): Gap[] {
  const { nodesByProcess, out } = index
  const outgoing = (id: string) => out.get(id) ?? []
  const gaps: Gap[] = []
  const push = (g: Gap) => gaps.push(g)

  // Tuotettavat artefaktit koko projektissa (syötteen lähteen tarkistukseen)
  const produced = new Set<string>()
  for (const n of Object.values(p.nodes)) for (const id of n.outputIds) produced.add(id)
  const askedArtifact = new Set<string>()
  const askedOutput = new Set<string>()
  const consumed = new Set<string>()
  for (const n of Object.values(p.nodes)) for (const id of n.inputIds) consumed.add(id)
  const nodeKind = new Map(Object.values(p.nodes).map((n) => [n.id, n.kind]))

  const order: string[] = []
  const processIds = Object.keys(p.processes)

  for (const processId of processIds) {
    const proc = p.processes[processId]
    const nodes = nodesByProcess.get(processId) ?? []
    const starts = nodes.filter((n) => n.kind === 'start')
    const ends = nodes.filter((n) => n.kind === 'end')
    const hasStructure = nodes.length >= 2

    // Prosessin alku ja loppu
    if (hasStructure && starts.length === 0) {
      push({
        key: `no-start:${processId}`,
        rule: 'no-start',
        processId,
        severity: 'medium',
        text: `Prosessilta “${proc.name}” puuttuu alkupiste.`,
      })
    }
    if (hasStructure && ends.length === 0) {
      push({
        key: `no-end:${processId}`,
        rule: 'no-end',
        processId,
        severity: 'medium',
        text: `Prosessilta “${proc.name}” puuttuu loppupiste.`,
      })
    }

    // Saavutettavuus alusta ja pääsy loppuun
    if (hasStructure && starts.length > 0) {
      const reachable = reach(
        starts.map((s) => s.id),
        out,
      )
      for (const n of nodes) {
        if (n.kind !== 'start' && !reachable.has(n.id)) {
          push({
            key: `unreachable:${n.id}`,
            rule: 'unreachable',
            processId,
            targetId: n.id,
            severity: 'high',
            text: `Mistä vaiheeseen “${n.label}” tullaan? Siihen ei pääse alkupisteestä.`,
          })
        }
      }
    }
    if (hasStructure) {
      const deadEnds = nodes.filter((n) => n.kind !== 'end' && outgoing(n.id).length === 0)
      // Jos loppupistettä ei ole, yksittäinen häntä on luonnollinen; useampi on epäselvä.
      if (ends.length > 0 || deadEnds.length > 1) {
        for (const n of deadEnds) {
          push({
            key: `dead-end:${n.id}`,
            rule: 'dead-end',
            processId,
            targetId: n.id,
            severity: 'high',
            text: `Mihin vaihe “${n.label}” johtaa? Siitä ei lähde yhteyttä.`,
          })
        }
      }
    }

    // Solmukohtaiset säännöt
    const seen = new Map<string, string>()
    const similarPool: { id: string; kind: string; label: string; tokens: Set<string> }[] = []
    for (const n of nodes) {
      if (!n.label.trim()) {
        push({
          key: `no-label:${n.id}`,
          rule: 'no-label',
          processId,
          targetId: n.id,
          severity: 'high',
          text: 'Vaiheella ei ole nimeä.',
        })
        continue
      }

      if ((n.kind === 'step' || n.kind === 'subprocess') && !n.roleId) {
        push({
          key: `no-role:${n.id}`,
          rule: 'no-role',
          processId,
          targetId: n.id,
          severity: 'medium',
          text: `Kuka tekee vaiheen “${n.label}”?`,
        })
      }

      if (n.kind === 'decision') {
        const outs = outgoing(n.id)
        if (outs.length < 2) {
          push({
            key: `decision-branches:${n.id}`,
            rule: 'decision-branches',
            processId,
            targetId: n.id,
            severity: 'medium',
            text:
              outs.length === 0
                ? `Päätöksellä “${n.label}” ei ole yhtään haaraa. Mitä eri vastauksilla tapahtuu?`
                : `Päätöksellä “${n.label}” on vain yksi haara. Mitä tapahtuu muissa tapauksissa?`,
          })
        }
        const unlabeled = outs.filter((e) => !e.label?.trim())
        if (outs.length >= 2 && unlabeled.length > 0) {
          push({
            key: `decision-labels:${n.id}`,
            rule: 'decision-labels',
            processId,
            targetId: n.id,
            severity: 'low',
            text: `Päätöksen “${n.label}” haarat ovat nimeämättä.`,
            data: { edgeIds: unlabeled.map((e) => e.id) },
          })
        }
      }

      if (n.kind === 'subprocess') {
        const child = n.childProcessId ? p.processes[n.childProcessId] : undefined
        const inner = child
          ? (nodesByProcess.get(child.id) ?? []).filter(
              (x) => x.kind !== 'start' && x.kind !== 'end',
            )
          : []
        if (inner.length === 0) {
          push({
            key: `empty-subprocess:${n.id}`,
            rule: 'empty-subprocess',
            processId,
            targetId: n.id,
            severity: 'medium',
            text: `Mitä alaprosessissa “${n.label}” tapahtuu? Se on vielä tyhjä.`,
          })
        }
      }

      if (
        n.confidence === 'guess' &&
        n.sources.length === 0 &&
        n.kind !== 'start' &&
        n.kind !== 'end'
      ) {
        push({
          key: `guess-unsourced:${n.id}`,
          rule: 'guess-unsourced',
          processId,
          targetId: n.id,
          severity: 'low',
          text: `“${n.label}” on arvaus ilman lähdettä. Vahvista se tai etsi lähde.`,
        })
      }

      // Tuotokset, joita mikään vaihe ei käytä syötteenä (tiedon kulku katkeaa)
      for (const artifactId of n.outputIds) {
        if (!consumed.has(artifactId) && !askedOutput.has(artifactId) && p.entities[artifactId]) {
          // Prosessin lopputulos (vaihe johtaa suoraan loppuun tai on viimeinen) on perusteltu poikkeus.
          const next = outgoing(n.id)
          const leadsToEnd = next.length === 0 || next.every((e) => nodeKind.get(e.to) === 'end')
          if (leadsToEnd) continue
          askedOutput.add(artifactId)
          push({
            key: `output-unused:${artifactId}`,
            rule: 'output-unused',
            processId,
            targetId: n.id,
            entityId: artifactId,
            severity: 'low',
            text: `Kuka käyttää tuotosta “${p.entities[artifactId].name}”? Mikään vaihe ei tarvitse sitä syötteenä.`,
          })
        }
      }

      // Syötteet, joita mikään vaihe ei tuota
      for (const artifactId of n.inputIds) {
        if (!produced.has(artifactId) && !askedArtifact.has(artifactId) && p.entities[artifactId]) {
          askedArtifact.add(artifactId)
          push({
            key: `artifact-source:${artifactId}`,
            rule: 'artifact-source',
            processId,
            targetId: n.id,
            entityId: artifactId,
            severity: 'low',
            text: `Mistä “${p.entities[artifactId].name}” tulee? Mikään vaihe ei tuota sitä.`,
          })
        }
      }

      // Lähteiden ristiriita: lähteessä mainittu toimija on eri kuin merkitty rooli
      if (n.roleId && n.sources.length > 0) {
        for (const ref of n.sources) {
          const role = leadingRoleMention(p, ref.quote)
          if (role && role !== n.roleId) {
            push({
              key: `source-conflict:${n.id}:${role}`,
              rule: 'source-conflict',
              processId,
              targetId: n.id,
              entityId: role,
              severity: 'medium',
              text: `Lähteessä toimijaksi mainitaan “${p.entities[role].name}”, mutta vaiheen “${n.label}” vastuuksi on merkitty “${p.entities[n.roleId]?.name}”.`,
              data: { quote: ref.quote, sourceId: ref.sourceId, start: ref.start, end: ref.end },
            })
            break
          }
        }
      }

      // Samannimiset vaiheet samassa prosessissa
      if (n.kind === 'step' || n.kind === 'subprocess' || n.kind === 'decision') {
        const norm = `${n.kind === 'decision' ? 'd' : 's'}:${normalizeName(n.label)}`
        const first = seen.get(norm)
        if (first) {
          push({
            key: `duplicate-label:${n.id}`,
            rule: 'duplicate-label',
            processId,
            targetId: n.id,
            severity: 'low',
            text: `Vaihe “${n.label}” esiintyy prosessissa kahdesti. Ovatko ne sama vaihe?`,
            data: { otherId: first },
          })
        } else {
          seen.set(norm, n.id)
          // Lähes samannimiset: "Tarkista lasku" ja "Laskun tarkistus"
          const tokens = similarityTokens(n.label)
          if (tokens && similarPool.length < 800) {
            const twin = similarPool.find(
              (o) => o.kind === n.kind && jaccard(o.tokens, tokens) >= SIMILAR_THRESHOLD,
            )
            if (twin) {
              push({
                key: `duplicate-label:${n.id}`,
                rule: 'duplicate-label',
                processId,
                targetId: n.id,
                severity: 'low',
                text: `Vaiheet “${twin.label}” ja “${n.label}” kuulostavat samalta. Ovatko ne sama vaihe?`,
                data: { otherId: twin.id, similar: true },
              })
            }
            similarPool.push({ id: n.id, kind: n.kind, label: n.label, tokens })
          }
        }
      }
    }
    for (const row of flowOrder(p, processId)) order.push(row.node.id)
  }

  // Järjestys: vakavuus, sitten prosessin kulku
  const rank = new Map(order.map((id, i) => [id, i]))
  return gaps.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (rank.get(a.targetId ?? '') ?? 1e9) - (rank.get(b.targetId ?? '') ?? 1e9) ||
      a.key.localeCompare(b.key),
  )
}
