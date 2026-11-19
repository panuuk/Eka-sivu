import type { RenderGraph } from './graph'
import { flowOrder } from '../model/flow'
import { edgesOf } from '../model/selectors'
import type { Project } from '../model/types'

/**
 * BPMN 2.0 XML -vienti. Sisältää prosessin rakenteen (tehtävät, yhdyskäytävät, tapahtumat, alaprosessit,
 * rooleista uimaradat) ja diagrammitiedot (BPMNDI), jotta se avautuu graafisena muissa työkaluissa (esim. bpmn.io).
 */

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

// Ohjausmerkit eivät ole sallittuja XML 1.0:ssa.
// eslint-disable-next-line no-control-regex
const SKIP = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g
const clean = (s: string) => xml(s.replace(SKIP, ''))

/** Tunniste, joka kelpaa XML:n NCName-muotona. */
const ncname = (prefix: string, id: string) => `${prefix}_${id.replace(/[^A-Za-z0-9_]/g, '_')}`

export function toBpmn(p: Project, processId: string, layout?: RenderGraph): string {
  const proc = p.processes[processId]
  const bpmnId = (nodeId: string) => {
    const n = p.nodes[nodeId]
    const prefix =
      n.kind === 'start'
        ? 'StartEvent'
        : n.kind === 'end'
          ? 'EndEvent'
          : n.kind === 'decision'
            ? 'Gateway'
            : n.kind === 'subprocess'
              ? 'SubProcess'
              : 'Activity'
    return ncname(prefix, nodeId)
  }
  const flowId = (edgeId: string) => ncname('Flow', edgeId)

  const body: string[] = []

  const emitProcess = (pid: string, indent: string, depth: number) => {
    const rows = flowOrder(p, pid)
    const edges = edgesOf(p, pid)
    const incoming = new Map<string, string[]>()
    const outgoing = new Map<string, string[]>()
    for (const e of edges) {
      if (!outgoing.has(e.from)) outgoing.set(e.from, [])
      outgoing.get(e.from)!.push(e.id)
      if (!incoming.has(e.to)) incoming.set(e.to, [])
      incoming.get(e.to)!.push(e.id)
    }

    // Uimaradat rooleittain (vain yläprosessille)
    if (depth === 0) {
      const byRole = new Map<string, string[]>()
      for (const { node } of rows) {
        if (!node.roleId || !p.entities[node.roleId]) continue
        if (!byRole.has(node.roleId)) byRole.set(node.roleId, [])
        byRole.get(node.roleId)!.push(node.id)
      }
      if (byRole.size) {
        body.push(`${indent}<laneSet id="LaneSet_1">`)
        for (const [roleId, nodeIds] of byRole) {
          body.push(
            `${indent}  <lane id="${ncname('Lane', roleId)}" name="${clean(p.entities[roleId].name)}">`,
          )
          for (const id of nodeIds)
            body.push(`${indent}    <flowNodeRef>${bpmnId(id)}</flowNodeRef>`)
          body.push(`${indent}  </lane>`)
        }
        body.push(`${indent}</laneSet>`)
      }
    }

    for (const { node } of rows) {
      const id = bpmnId(node.id)
      const name = ` name="${clean(node.label)}"`
      const refs = [
        ...(incoming.get(node.id) ?? []).map((e) => `${indent}  <incoming>${flowId(e)}</incoming>`),
        ...(outgoing.get(node.id) ?? []).map((e) => `${indent}  <outgoing>${flowId(e)}</outgoing>`),
      ]
      const doc = node.description
        ? [`${indent}  <documentation>${clean(node.description)}</documentation>`]
        : []
      const open = (tag: string) => `${indent}<${tag} id="${id}"${name}>`
      if (node.kind === 'start')
        body.push(open('startEvent'), ...doc, ...refs, `${indent}</startEvent>`)
      else if (node.kind === 'end')
        body.push(open('endEvent'), ...doc, ...refs, `${indent}</endEvent>`)
      else if (node.kind === 'decision')
        body.push(open('exclusiveGateway'), ...doc, ...refs, `${indent}</exclusiveGateway>`)
      else if (node.kind === 'subprocess' && node.childProcessId && depth < 6) {
        body.push(open('subProcess'), ...doc, ...refs)
        emitProcess(node.childProcessId, `${indent}  `, depth + 1)
        body.push(`${indent}</subProcess>`)
      } else body.push(open('task'), ...doc, ...refs, `${indent}</task>`)
    }
    for (const e of edges) {
      const label = e.label ? ` name="${clean(e.label)}"` : ''
      body.push(
        `${indent}<sequenceFlow id="${flowId(e.id)}" sourceRef="${bpmnId(e.from)}" targetRef="${bpmnId(e.to)}"${label}/>`,
      )
    }
  }
  emitProcess(processId, '    ', 0)

  // Diagrammitiedot (BPMNDI) asettelusta
  const di: string[] = []
  if (layout) {
    di.push(
      '  <bpmndi:BPMNDiagram id="BPMNDiagram_1">',
      `    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${ncname('Process', processId)}">`,
    )
    const inScope = (id: string) => !!p.nodes[id]
    for (const n of layout.nodes) {
      if (!inScope(n.id)) continue
      const expandedAttr = n.group ? ' isExpanded="true"' : ''
      di.push(
        `      <bpmndi:BPMNShape id="${bpmnId(n.id)}_di" bpmnElement="${bpmnId(n.id)}"${expandedAttr}>`,
        `        <dc:Bounds x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${Math.round(n.w)}" height="${Math.round(n.h)}"/>`,
        '      </bpmndi:BPMNShape>',
      )
    }
    for (const e of layout.edges) {
      di.push(
        `      <bpmndi:BPMNEdge id="${flowId(e.id)}_di" bpmnElement="${flowId(e.id)}">`,
        ...e.points.map(
          (pt) => `        <di:waypoint x="${Math.round(pt.x)}" y="${Math.round(pt.y)}"/>`,
        ),
        '      </bpmndi:BPMNEdge>',
      )
    }
    di.push('    </bpmndi:BPMNPlane>', '  </bpmndi:BPMNDiagram>')
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://prosessikartta.local/bpmn">',
    `  <process id="${ncname('Process', processId)}" name="${clean(proc?.name ?? 'Prosessi')}" isExecutable="false">`,
    ...body,
    '  </process>',
    ...di,
    '</definitions>',
    '',
  ].join('\n')
}
