import { metricsOf, summarizeScope } from '../analysis/metrics'
import { formatRange, formatTotal } from '../model/duration'
import { flowOrder } from '../model/flow'
import { descendantProcessIds } from '../model/operations'
import { createView, scenarioPath } from '../model/scenario'
import type { ProcessNode, Project, SavedView } from '../model/types'
import { renderSvg } from './svg'
import { cropFor, renderView, requestForView } from './views'
import { svgOptions } from './run'
import type { ExportRequest } from './run'

/**
 * PowerPoint-esityksen suunnitelma: lista dioja, joista kukin on kuva, teksti tai taulukko. Suunnitelma
 * on erillään tiedoston kirjoituksesta, jotta sisältö on testattavissa ilman selainta.
 */

export interface DeckOptions {
  /** Päätason yleiskuva ja alaprosessit. Pois, jos tallennetut näkymät riittävät. */
  overview: boolean
  subprocesses: boolean
  /** Tallennetut näkymät omina diaoinaan. */
  views: boolean
  scenarios: boolean
  metrics: boolean
  changes: boolean
  /** Vaihe vaiheelta -läpikäynti (yksi dia vaihetta kohti). */
  walkthrough: boolean
}

export const DEFAULT_DECK: DeckOptions = {
  overview: true,
  subprocesses: true,
  views: true,
  scenarios: true,
  metrics: true,
  changes: true,
  walkthrough: false,
}

export type DeckSlide =
  | { kind: 'title'; title: string; subtitle: string; notes: string }
  | {
      kind: 'diagram'
      title: string
      svg: string
      width: number
      height: number
      notes: string
      /** Tekstipaneeli kuvan oikealla puolella (läpikäyntidioissa). */
      side?: string[]
      caption?: string
    }
  | { kind: 'text'; title: string; bullets: string[]; notes: string }
  | {
      kind: 'table'
      title: string
      header: string[]
      rows: string[][]
      notes: string
      caption?: string
    }

const WORK = new Set(['step', 'decision', 'subprocess'])
/** Kuvan käytettävissä oleva alue diassa (tuumaa), ilman sivupaneelia. */
const SLIDE_BOX = { w: 12.4, h: 5.9 }
/** Läpikäyntidioja tehdään enintään näin monta, jotta tiedosto pysyy käsiteltävänä. */
export const WALKTHROUGH_LIMIT = 40

/** Vaiheen tiedot luettavina riveinä (muistiinpanoihin ja läpikäyntidian sivupaneeliin). */
export function stepLines(p: Project, n: ProcessNode): string[] {
  const names = (ids: string[]) =>
    ids
      .map((i) => p.entities[i]?.name)
      .filter(Boolean)
      .join(', ')
  const lines: string[] = []
  if (n.roleId && p.entities[n.roleId]) lines.push(`Rooli: ${p.entities[n.roleId].name}`)
  if (n.systemIds.length) lines.push(`Järjestelmät: ${names(n.systemIds)}`)
  if (n.inputIds.length) lines.push(`Syötteet: ${names(n.inputIds)}`)
  if (n.outputIds.length) lines.push(`Tuotokset: ${names(n.outputIds)}`)
  if (n.duration) lines.push(`Työaika: ${formatRange(n.duration)}`)
  if (n.waiting) lines.push(`Odotus: ${formatRange(n.waiting)}`)
  if (n.frequency) lines.push(`Toistuvuus: ${n.frequency}`)
  const raci = [
    ['A', n.raci?.accountableIds],
    ['C', n.raci?.consultedIds],
    ['I', n.raci?.informedIds],
  ] as const
  for (const [letter, ids] of raci) if (ids?.length) lines.push(`${letter}: ${names(ids)}`)
  for (const pp of n.painPoints ?? [])
    lines.push(`Kipupiste: ${pp.text}${pp.idea ? ` (idea: ${pp.idea})` : ''}`)
  if (n.description?.trim()) lines.push(n.description.trim())
  return lines
}

function notesForProcess(p: Project, processId: string): string {
  const proc = p.processes[processId]
  const rows = flowOrder(p, processId).filter((r) => WORK.has(r.node.kind))
  const out: string[] = []
  if (proc?.description) out.push(proc.description, '')
  rows.forEach((r, i) => {
    const lines = stepLines(p, r.node)
    out.push(`${i + 1}. ${r.node.label}${lines.length ? ` — ${lines.join('; ')}` : ''}`)
  })
  return out.join('\n')
}

function notesForPath(p: Project, processId: string, choices: Record<string, string>): string {
  const path = scenarioPath(p, processId, choices)
  const out: string[] = []
  for (const id of path.nodeIds) {
    const n = p.nodes[id]
    if (!n || !WORK.has(n.kind)) continue
    const lines = stepLines(p, n)
    out.push(`${path.order.get(id)}. ${n.label}${lines.length ? ` — ${lines.join('; ')}` : ''}`)
  }
  if (path.looped) out.push('(Polku palaa jo käytyyn vaiheeseen ja katkaistiin tähän.)')
  return out.join('\n')
}

/** Suunnittelee esityksen diat annetuista asetuksista. */
export async function planDeck(
  project: Project,
  req: ExportRequest,
  opts: DeckOptions,
  now = new Date(),
): Promise<DeckSlide[]> {
  const slides: DeckSlide[] = []
  const root = project.processes[req.processId]
  slides.push({
    kind: 'title',
    title: root?.name ?? project.name,
    subtitle: `${project.name} · ${now.toLocaleDateString('fi-FI')}`,
    notes: root?.description ?? '',
  })

  const baseView = (processId: string, patch: Partial<SavedView> = {}): SavedView =>
    createView({
      name: project.processes[processId]?.name ?? 'Prosessi',
      processId,
      expand: false,
      onlyConfirmed: req.options.onlyConfirmed,
      showMetrics: req.options.showMetrics,
      heat: req.options.heat,
      changes: req.options.changes,
      ...patch,
    })

  // Diakuva on vaakasuuntainen: kokeillaan molempia asetteluja ja valitaan se, joka mahtuu diaan isompana.
  const bestRender = async (view: SavedView) => {
    const down = await renderView(project, view, { ...req, direction: 'DOWN' })
    const right = await renderView(project, view, { ...req, direction: 'RIGHT' })
    const fit = (r: { width: number; height: number }) =>
      Math.min(SLIDE_BOX.w / Math.max(r.width, 1), SLIDE_BOX.h / Math.max(r.height, 1))
    return fit(right) > fit(down) * 1.15
      ? { ...right, direction: 'RIGHT' as const }
      : { ...down, direction: 'DOWN' as const }
  }

  const diagram = async (view: SavedView, notes: string, extra: Partial<DeckSlide> = {}) => {
    const r = await bestRender(view)
    slides.push({
      kind: 'diagram',
      title: view.name,
      svg: r.svg,
      width: r.width,
      height: r.height,
      notes: [view.note, notes].filter(Boolean).join('\n\n'),
      ...(extra as object),
    } as DeckSlide)
  }

  if (opts.overview) {
    await diagram(
      baseView(req.processId, { name: root?.name ?? 'Yleiskuva', expand: req.options.expand }),
      notesForProcess(project, req.processId),
    )
  }
  if (opts.subprocesses) {
    for (const id of descendantProcessIds(project, req.processId).filter(
      (x) => x !== req.processId,
    )) {
      if (!flowOrder(project, id).length) continue
      await diagram(baseView(id), notesForProcess(project, id))
    }
  }

  if (opts.views) {
    for (const v of project.views ?? []) {
      if (!project.processes[v.processId]) continue
      const sc = v.scenarioId ? project.scenarios?.[v.scenarioId] : undefined
      await diagram(
        v,
        sc
          ? `Skenaario: ${sc.name}\n${notesForPath(project, sc.processId, sc.choices)}`
          : notesForProcess(project, v.processId),
      )
    }
  }

  if (opts.scenarios) {
    for (const sc of Object.values(project.scenarios ?? {})) {
      if (!project.processes[sc.processId]) continue
      // Näkymä, joka jo esittelee skenaarion, ei tuota toista diaa
      if (opts.views && project.views?.some((v) => v.scenarioId === sc.id)) continue
      await diagram(
        baseView(sc.processId, {
          name: `Skenaario: ${sc.name}`,
          scenarioId: sc.id,
          note: sc.description,
        }),
        notesForPath(project, sc.processId, sc.choices),
      )
    }
  }

  if (opts.metrics) {
    const metrics = metricsOf(project)
    const ids = descendantProcessIds(project, req.processId)
    const summary = summarizeScope(project, metrics.perProcess, ids)
    const lead = metrics.perProcess.get(req.processId)?.lead
    const name = (id: string) => project.entities[id]?.name ?? '?'
    if (lead?.typicalHigh !== undefined || summary.handoffCount > 0 || summary.loopCount > 0) {
      const rows: string[][] = []
      if (lead?.typicalHigh !== undefined) {
        rows.push([
          'Läpimenoaika',
          `${formatTotal(lead.typicalLow ?? lead.typicalHigh)}–${formatTotal(lead.typicalHigh)}`,
          `nopeimmillaan ${formatTotal(lead.best ?? 0)}, hitaimmillaan ${formatTotal(lead.worst ?? 0)}`,
        ])
      }
      rows.push([
        'Luovutukset roolien välillä',
        String(summary.handoffCount),
        summary.rolePairs
          .slice(0, 3)
          .map((r) => `${name(r.fromRoleId)} → ${name(r.toRoleId)} (${r.count})`)
          .join(', ') || '–',
      ])
      rows.push([
        'Uudelleenkierrokset',
        String(summary.loopCount),
        summary.loops
          .slice(0, 3)
          .map((l) => `${project.nodes[l.fromId]?.label} → ${project.nodes[l.toId]?.label}`)
          .join(', ') || '–',
      ])
      if (summary.effort + summary.waiting > 0)
        rows.push([
          'Työ ja odotus',
          `${formatTotal(summary.effort)} / ${formatTotal(summary.waiting)}`,
          `odotuksen osuus ${Math.round((summary.waiting / (summary.effort + summary.waiting)) * 100)} %`,
        ])
      slides.push({
        kind: 'table',
        title: 'Prosessin mittarit',
        header: ['Mittari', 'Arvo', 'Lisätieto'],
        rows,
        notes:
          'Arviot perustuvat vaiheille annettuihin kestoihin. Läpimenoaika on väli lyhimmästä pisimpään polkuun.',
      })
    }
    if (summary.painPoints.length) {
      const top = summary.painPoints.slice(0, 10)
      slides.push({
        kind: 'table',
        title: 'Kipupisteet ja parannusideat',
        header: ['Vaihe', 'Kipupiste', 'Vakavuus', 'Parannusidea'],
        rows: top.map((x) => [
          project.nodes[x.nodeId]?.label ?? '',
          x.text,
          ['', 'pieni', 'kohtalainen', 'vakava'][x.severity],
          x.idea ?? '',
        ]),
        caption:
          summary.painPoints.length > top.length
            ? `Näytetään ${top.length}/${summary.painPoints.length} vakavinta.`
            : undefined,
        notes: summary.painPoints
          .map((x) => `${project.nodes[x.nodeId]?.label}: ${x.text}${x.idea ? ` → ${x.idea}` : ''}`)
          .join('\n'),
      })
    }
  }

  if (opts.changes && req.comparison) {
    const c = req.comparison.comparison
    const KIND = { added: 'Lisätty', removed: 'Poistettu', changed: 'Muuttunut' } as const
    const t = (n?: number) => (n === undefined ? '–' : formatTotal(n))
    slides.push({
      kind: 'text',
      title: `Muutokset: ${req.comparison.baseName} → nykyinen`,
      bullets: [
        `${c.counts.added} lisätty, ${c.counts.removed} poistettu, ${c.counts.changed} muuttunut vaihe`,
        `Luovutukset ${c.base.handoffs} → ${c.target.handoffs}`,
        `Kierrokset ${c.base.loops} → ${c.target.loops}`,
        `Läpimeno ${t(c.base.lead?.high)} → ${t(c.target.lead?.high)}`,
        `Odotus ${t(c.base.waiting)} → ${t(c.target.waiting)}`,
      ],
      notes: '',
    })
    if (c.nodes.length) {
      const rows = c.nodes
        .slice(0, 14)
        .map((n) => [
          KIND[n.kind],
          n.label,
          n.fields.map((f) => `${f.label}: ${f.before} → ${f.after}`).join('; '),
        ])
      slides.push({
        kind: 'table',
        title: 'Muutosluettelo',
        header: ['Muutos', 'Vaihe', 'Tiedot'],
        rows,
        caption:
          c.nodes.length > rows.length
            ? `Näytetään ${rows.length}/${c.nodes.length} muutosta. Koko luettelo on prosessidokumentissa.`
            : undefined,
        notes: c.nodes.map((n) => `${KIND[n.kind]}: ${n.label}`).join('\n'),
      })
    }
  }

  if (opts.walkthrough) {
    const steps = flowOrder(project, req.processId)
      .map((r) => r.node)
      .filter((n) => WORK.has(n.kind))
      .slice(0, WALKTHROUGH_LIMIT)
    // Asettelu lasketaan kerran ja jokaiselle diaan tehdään vain rajaus ja korostus
    const whole = baseView(req.processId, { name: root?.name ?? 'Prosessi' })
    const chosen = await bestRender(whole)
    const wreq = requestForView({ ...req, direction: chosen.direction }, whole)
    const visited = new Set<string>()
    for (const n of steps) {
      const crop = cropFor(chosen.graph, [n.id, ...neighbours(project, n.id)])
      const svg = renderSvg(chosen.graph, {
        ...svgOptions(wreq, n.label || 'Vaihe'),
        crop,
        highlight: { current: n.id, visited: new Set(visited) },
      })
      const m = /width="(\d+)" height="(\d+)"/.exec(svg)
      const lines = stepLines(project, n)
      slides.push({
        kind: 'diagram',
        title: n.label || 'Vaihe',
        svg,
        width: Number(m?.[1] ?? 0),
        height: Number(m?.[2] ?? 0),
        side: lines.length ? lines : ['Ei lisätietoja'],
        notes: lines.join('\n'),
      })
      visited.add(n.id)
    }
  }
  return slides
}

function neighbours(p: Project, id: string): string[] {
  return Object.values(p.edges)
    .filter((e) => e.from === id || e.to === id)
    .map((e) => (e.from === id ? e.to : e.from))
}

/** Hakemisto prosesseista, joille on dia (yleiskatsaus esikatseluun). */
export function deckSummary(slides: DeckSlide[]): string[] {
  return slides.map((s, i) => `${i + 1}. ${s.title}`)
}
