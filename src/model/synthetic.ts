import { createEdge, createEntity, createNode, createProcess, createProject } from './factory'
import { applyOperations, type Operation } from './operations'
import type { NodeKind, Project } from './types'

/**
 * Tuottaa suuren, realistisen testiprosessin: jaksoja, päätöksiä (haarat yhtyvät), rooleja, järjestelmiä
 * ja alaprosesseja. Käytetään suorituskyky- ja skaalaustesteissä. Tulos on deterministinen.
 */
export function buildLargeProject(targetNodes = 500, subprocessEvery = 40): Project {
  let p = createProject(`Suuri prosessi (${targetNodes})`, 'Päätason prosessi')
  const root = p.rootProcessId
  const ops: Operation[] = []
  const roles = [
    'Myynti',
    'Talous',
    'Esimies',
    'Logistiikka',
    'Asiakaspalvelu',
    'Tuotanto',
    'Laatu',
    'IT',
  ].map((n) => createEntity('role', n))
  const systems = ['ERP', 'CRM', 'Sähköposti', 'Varasto', 'BI'].map((n) =>
    createEntity('system', n),
  )
  for (const e of [...roles, ...systems]) ops.push({ type: 'addEntity', entity: e })

  let counter = 0
  let seed = 7
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const mk = (processId: string, label: string, kind: NodeKind = 'step') => {
    const n = createNode(processId, {
      label,
      kind,
      confidence: (['guess', 'likely', 'confirmed'] as const)[counter % 3],
      ...(kind === 'step'
        ? {
            roleId: roles[counter % roles.length].id,
            systemIds: counter % 2 ? [systems[counter % systems.length].id] : [],
          }
        : {}),
    })
    counter++
    ops.push({ type: 'addNode', node: n })
    return n.id
  }
  const link = (processId: string, a: string, b: string, label?: string) =>
    ops.push({ type: 'addEdge', edge: createEdge(processId, a, b, label) })

  let created = 0
  const start = mk(root, 'Alku', 'start')
  let prev: string[] = [start]
  let i = 0
  while (created < targetNodes - 2) {
    i++
    const roll = rand()
    const connectPrev = (to: string, label?: string) => {
      for (const from of prev) link(root, from, to, label)
    }
    if (i % subprocessEvery === 0) {
      const sub = mk(root, `Alaprosessi ${i}`, 'subprocess')
      created++
      connectPrev(sub)
      const child = createProcess(`Alaprosessi ${i}`, sub)
      ops.push({ type: 'addProcess', process: child })
      ops.push({ type: 'updateNode', id: sub, patch: { childProcessId: child.id } })
      let cprev = mk(child.id, 'Alku', 'start')
      for (let k = 0; k < 8; k++) {
        const c = mk(child.id, `Sisävaihe ${i}.${k}`)
        link(child.id, cprev, c)
        cprev = c
      }
      const cend = mk(child.id, 'Loppu', 'end')
      link(child.id, cprev, cend)
      prev = [sub]
    } else if (roll < 0.18) {
      const d = mk(root, `Päätös ${i}?`, 'decision')
      created++
      connectPrev(d)
      const a = mk(root, `Kyllä-vaihe ${i}`)
      const b = mk(root, `Ei-vaihe ${i}`)
      created += 2
      link(root, d, a, 'Kyllä')
      link(root, d, b, 'Ei')
      prev = [a, b]
    } else {
      const s = mk(root, `Vaihe ${i}`)
      created++
      connectPrev(s)
      prev = [s]
    }
  }
  const end = mk(root, 'Loppu', 'end')
  for (const from of prev) link(root, from, end)
  p = applyOperations(p, ops)
  return p
}
