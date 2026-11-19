import { opsExpandNode } from './commands'
import { createEdge, createEntity, createNode, createProject } from './factory'
import { applyOperations, type Operation } from './operations'
import type { Confidence, NodeKind, Project } from './types'

/** Esimerkkiprojekti: ostolaskun käsittely. Toimii aloitusesimerkkinä ja testiaineistona. */
export function buildSampleProject(): Project {
  let p = createProject('Esimerkki: ostolaskun käsittely', 'Ostolaskun käsittely')
  const root = p.rootProcessId
  const ops: Operation[] = []

  const role = (n: string) => {
    const e = createEntity('role', n)
    ops.push({ type: 'addEntity', entity: e })
    return e.id
  }
  const sys = (n: string) => {
    const e = createEntity('system', n)
    ops.push({ type: 'addEntity', entity: e })
    return e.id
  }
  const art = (n: string) => {
    const e = createEntity('artifact', n)
    ops.push({ type: 'addEntity', entity: e })
    return e.id
  }
  const reskontra = role('Ostoreskontra')
  const esimies = role('Esimies')
  const operaattori = sys('Verkkolaskuoperaattori')
  const erp = sys('ERP')
  const lasku = art('Ostolasku')
  const tilaus = art('Ostotilaus')
  const maksu = art('Maksuerä')

  const mk = (
    label: string,
    kind: NodeKind = 'step',
    extra: Partial<Parameters<typeof createNode>[1]> = {},
    confidence: Confidence = 'likely',
  ) => {
    const n = createNode(root, { label, kind, confidence, ...extra })
    ops.push({ type: 'addNode', node: n })
    return n.id
  }
  const link = (a: string, b: string, label?: string) =>
    ops.push({ type: 'addEdge', edge: createEdge(root, a, b, label) })

  const start = mk('Lasku saapuu', 'start', {}, 'confirmed')
  const receive = mk(
    'Vastaanota lasku',
    'step',
    { roleId: reskontra, systemIds: [operaattori], outputIds: [lasku] },
    'confirmed',
  )
  const check = mk(
    'Tarkista laskun tiedot',
    'step',
    { roleId: reskontra, systemIds: [erp], inputIds: [lasku, tilaus] },
    'confirmed',
  )
  const ok = mk('Tiedot kunnossa?', 'decision', {}, 'confirmed')
  // Rooli puuttuu tarkoituksella: esimerkki näyttää, miten kysymysjono ohjaa täydentämään mallia.
  const request = mk('Pyydä korjaus toimittajalta', 'step', {}, 'guess')
  const approval = mk('Hyväksyntäkierto', 'subprocess', { roleId: esimies }, 'likely')
  const approved = mk('Hyväksytty?', 'decision', {}, 'likely')
  const post = mk(
    'Kirjaa ja vie maksuun',
    'step',
    { roleId: reskontra, systemIds: [erp], outputIds: [maksu] },
    'likely',
  )
  const reject = mk('Palauta laskun tarkistajalle', 'step', { roleId: esimies }, 'guess')
  const end = mk('Lasku maksettu', 'end', {}, 'confirmed')

  link(start, receive)
  link(receive, check)
  link(check, ok)
  link(ok, approval, 'Kyllä')
  link(ok, request, 'Ei')
  link(request, receive)
  link(approval, approved)
  link(approved, post, 'Kyllä')
  link(approved, reject, 'Ei')
  link(reject, check)
  link(post, end)

  p = applyOperations(p, ops)
  // Avaa hyväksyntäkierto alaprosessiksi ja täytä se.
  const { ops: expand, processId } = opsExpandNode(p, approval)
  p = applyOperations(p, expand)
  const sub = Object.values(p.nodes).filter((n) => n.processId === processId)
  const subStart = sub.find((n) => n.kind === 'start')!
  const subEnd = sub.find((n) => n.kind === 'end')!
  const send = createNode(processId, {
    label: 'Lähetä esimiehelle',
    roleId: reskontra,
    systemIds: [erp],
    confidence: 'likely',
  })
  const decide = createNode(processId, {
    label: 'Esimies hyväksyy',
    roleId: esimies,
    confidence: 'guess',
  })
  const subOps: Operation[] = [
    { type: 'addNode', node: send },
    { type: 'addNode', node: decide },
  ]
  const stale = Object.values(p.edges).find((e) => e.processId === processId)!
  subOps.push({ type: 'deleteEdge', id: stale.id })
  subOps.push({ type: 'addEdge', edge: createEdge(processId, subStart.id, send.id) })
  subOps.push({ type: 'addEdge', edge: createEdge(processId, send.id, decide.id) })
  subOps.push({ type: 'addEdge', edge: createEdge(processId, decide.id, subEnd.id) })
  return applyOperations(p, subOps)
}
