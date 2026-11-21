import type { NodeKind } from '../model/types'
import type { ImportedEdge, ImportedGraph, ImportedNode, ImportedProcess } from './diagram'
import { MAX_IMPORT_NODES } from './diagram'

/**
 * BPMN 2.0 XML -tuonti (esim. Signavio, Camunda Modeler, bpmn.io, Visio). Luetaan prosessin
 * rakenne: tapahtumat, tehtävät, yhdyskäytävät, alaprosessit, uimaradat (rooleiksi) ja
 * sekvenssivirrat. Diagrammin sijainnit eivät tule mukaan, koska asettelu lasketaan uudelleen.
 */

export class BpmnImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BpmnImportError'
  }
}

const TASKS = new Set([
  'task',
  'usertask',
  'servicetask',
  'manualtask',
  'scripttask',
  'businessruletask',
  'sendtask',
  'receivetask',
  'callactivity',
])
const GATEWAYS = new Set([
  'exclusivegateway',
  'inclusivegateway',
  'parallelgateway',
  'eventbasedgateway',
  'complexgateway',
])
const SUBPROCESSES = new Set(['subprocess', 'transaction', 'adhocsubprocess'])

const GATEWAY_NOTES: Record<string, string> = {
  parallelgateway: 'Rinnakkainen haarautuminen: kaikki haarat suoritetaan (AND)',
  inclusivegateway: 'Yksi tai useampi haara suoritetaan (OR)',
  eventbasedgateway: 'Valinta tapahtuman perusteella',
  complexgateway: 'Monimutkainen yhdyskäytävä',
}

const local = (el: Element) => el.localName.toLowerCase()
const children = (el: Element) => Array.from(el.children)

function docText(el: Element): string | undefined {
  const d = children(el).find((c) => local(c) === 'documentation')
  const t = d?.textContent?.replace(/\s+/g, ' ').trim()
  return t || undefined
}

function parseProcessElement(
  el: Element,
  name: string,
  laneOf: Map<string, string>,
  skipped: Set<string>,
  depth: number,
): ImportedProcess {
  const nodes: ImportedNode[] = []
  const edges: ImportedEdge[] = []
  for (const c of children(el)) {
    const tag = local(c)
    const id = c.getAttribute('id') ?? ''
    const label = (c.getAttribute('name') ?? '').replace(/\s+/g, ' ').trim()
    const base = { key: id, label, role: laneOf.get(id), description: docText(c) }
    let kind: NodeKind | undefined
    if (tag === 'startevent') kind = 'start'
    else if (tag === 'endevent') kind = 'end'
    else if (tag === 'intermediatecatchevent' || tag === 'intermediatethrowevent') kind = 'step'
    else if (TASKS.has(tag)) kind = 'step'
    else if (GATEWAYS.has(tag)) kind = 'decision'
    else if (SUBPROCESSES.has(tag)) kind = 'subprocess'

    if (kind && id) {
      if (kind === 'start' && !label) base.label = 'Alku'
      if (kind === 'end' && !label) base.label = 'Loppu'
      if (tag === 'intermediatecatchevent' || tag === 'intermediatethrowevent')
        base.label ||= 'Välitapahtuma'
      const note = GATEWAY_NOTES[tag]
      const description = [base.description, note].filter(Boolean).join('\n')
      const node: ImportedNode = { ...base, kind, description: description || undefined }
      if (kind === 'subprocess' && depth < 8) {
        node.child = parseProcessElement(c, label || 'Alaprosessi', laneOf, skipped, depth + 1)
      }
      nodes.push(node)
    } else if (tag === 'sequenceflow') {
      const from = c.getAttribute('sourceRef')
      const to = c.getAttribute('targetRef')
      if (from && to) edges.push({ from, to, label: label || undefined })
    } else if (
      [
        'dataobject',
        'dataobjectreference',
        'datastorereference',
        'textannotation',
        'association',
        'group',
      ].includes(tag)
    ) {
      skipped.add(
        tag === 'textannotation'
          ? 'tekstimerkinnät'
          : tag === 'association'
            ? 'assosiaatiot'
            : 'dataobjektit',
      )
    } else if (tag === 'boundaryevent') {
      skipped.add('reunatapahtumat')
    }
  }
  // Vain tunnetut päätepisteet
  const keys = new Set(nodes.map((n) => n.key))
  return { name, nodes, edges: edges.filter((e) => keys.has(e.from) && keys.has(e.to)) }
}

/** Jäsentää BPMN 2.0 XML:n väliesitykseen. Heittää BpmnImportError, jos tiedosto ei ole BPMN. */
export function parseBpmn(xml: string): ImportedGraph {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0)
    throw new BpmnImportError('XML-tiedosto on virheellinen')
  const root = doc.documentElement
  if (!root || local(root) !== 'definitions')
    throw new BpmnImportError(
      'Tiedosto ei ole BPMN 2.0 -kaavio (juurielementti “definitions” puuttuu)',
    )

  const all = Array.from(root.getElementsByTagName('*'))
  const skipped = new Set<string>()
  const processes: ImportedProcess[] = []
  const participantName = new Map<string, string>()
  for (const el of all) {
    if (local(el) === 'participant') {
      const ref = el.getAttribute('processRef')
      const name = el.getAttribute('name')?.trim()
      if (ref && name) participantName.set(ref, name)
    } else if (local(el) === 'messageflow') {
      skipped.add('viestivirrat')
    }
  }
  for (const el of all) {
    if (local(el) !== 'process' || el.parentElement !== root) continue
    // Uimaradat: lane -> roolinimi vaiheille
    const laneOf = new Map<string, string>()
    for (const lane of Array.from(el.getElementsByTagName('*')).filter(
      (x) => local(x) === 'lane',
    )) {
      const name = lane.getAttribute('name')?.replace(/\s+/g, ' ').trim()
      if (!name) continue
      for (const ref of children(lane).filter((x) => local(x) === 'flownoderef')) {
        const id = ref.textContent?.trim()
        if (id) laneOf.set(id, name)
      }
    }
    const id = el.getAttribute('id') ?? ''
    const name = participantName.get(id) ?? el.getAttribute('name')?.trim() ?? 'Prosessi'
    processes.push(parseProcessElement(el, name, laneOf, skipped, 0))
  }
  const nonEmpty = processes.filter((p) => p.nodes.length > 0)
  if (nonEmpty.length === 0) throw new BpmnImportError('Kaaviosta ei löytynyt prosessin vaiheita')
  const total = nonEmpty.reduce((n, p) => n + countNodes(p), 0)
  if (total > MAX_IMPORT_NODES)
    throw new BpmnImportError(
      `Kaavio on liian suuri (${total} elementtiä, enintään ${MAX_IMPORT_NODES})`,
    )
  return { processes: nonEmpty, skipped: [...skipped] }
}

function countNodes(p: ImportedProcess): number {
  return p.nodes.reduce((n, x) => n + 1 + (x.child ? countNodes(x.child) : 0), 0)
}
