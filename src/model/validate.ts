import type { Project } from './types'

export interface ValidationIssue {
  code: string
  message: string
  id?: string
}

/** Tarkistaa mallin eheyden: viittaukset, prosessihierarkia ja reunat. Tyhjä lista = eheä. */
export function validateProject(p: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (code: string, message: string, id?: string) => issues.push({ code, message, id })

  if (!p.processes[p.rootProcessId])
    add('root-missing', 'Päätason prosessia ei löydy', p.rootProcessId)
  for (const pr of Object.values(p.processes)) {
    if (pr.parentNodeId) {
      const parent = p.nodes[pr.parentNodeId]
      if (!parent) add('parent-missing', `Prosessin "${pr.name}" vanhempivaihetta ei löydy`, pr.id)
      else if (parent.childProcessId !== pr.id) {
        add('parent-mismatch', `Prosessin "${pr.name}" vanhempivaihe ei viittaa takaisin`, pr.id)
      }
    }
  }
  for (const n of Object.values(p.nodes)) {
    if (!p.processes[n.processId])
      add('node-process', `Solmun "${n.label}" prosessia ei löydy`, n.id)
    if (n.roleId && p.entities[n.roleId]?.kind !== 'role')
      add('node-role', `Solmun "${n.label}" rooli puuttuu`, n.id)
    for (const id of n.systemIds) {
      if (p.entities[id]?.kind !== 'system')
        add('node-system', `Solmun "${n.label}" järjestelmä puuttuu`, n.id)
    }
    for (const id of [...n.inputIds, ...n.outputIds]) {
      if (p.entities[id]?.kind !== 'artifact')
        add('node-artifact', `Solmun "${n.label}" syöte/tuotos puuttuu`, n.id)
    }
    for (const id of [
      ...(n.raci?.accountableIds ?? []),
      ...(n.raci?.consultedIds ?? []),
      ...(n.raci?.informedIds ?? []),
    ]) {
      if (p.entities[id]?.kind !== 'role')
        add('node-raci', `Solmun "${n.label}" RACI-rooli puuttuu`, n.id)
    }
    for (const r of [n.duration, n.waiting]) {
      if (!r) continue
      const vals = [r.min, r.typical, r.max]
      if (vals.some((v) => v !== undefined && (!Number.isFinite(v) || v < 0)))
        add('node-duration', `Solmun "${n.label}" kesto on virheellinen`, n.id)
      else if (r.min !== undefined && r.max !== undefined && r.min > r.max)
        add('node-duration', `Solmun "${n.label}" kesto: vähintään on suurempi kuin enintään`, n.id)
    }
    if (n.childProcessId) {
      const child = p.processes[n.childProcessId]
      if (!child) add('child-missing', `Solmun "${n.label}" alaprosessia ei löydy`, n.id)
      else if (child.parentNodeId !== n.id)
        add('child-mismatch', `Alaprosessi ei viittaa takaisin solmuun "${n.label}"`, n.id)
    }
    for (const s of n.sources) {
      if (!p.sources[s.sourceId]) add('node-source', `Solmun "${n.label}" lähdettä ei löydy`, n.id)
    }
  }
  for (const e of Object.values(p.edges)) {
    const from = p.nodes[e.from]
    const to = p.nodes[e.to]
    if (!from || !to) add('edge-dangling', 'Reuna viittaa puuttuvaan solmuun', e.id)
    else if (from.processId !== e.processId || to.processId !== e.processId) {
      add('edge-cross', 'Reuna ylittää prosessin rajan', e.id)
    }
  }
  for (const q of Object.values(p.questions)) {
    if (!p.processes[q.processId]) add('question-process', 'Kysymyksen prosessia ei löydy', q.id)
    if (q.targetId && !p.nodes[q.targetId])
      add('question-target', 'Kysymyksen kohdetta ei löydy', q.id)
  }
  return issues
}
