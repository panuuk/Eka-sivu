import type { ProjectDiff } from './diff'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Muutosten yhteenveto yhdellä rivillä, esim. "3 uutta vaihetta · 1 päivitys · 5 yhteyttä". */
export function diffSummary(d: ProjectDiff): string {
  const parts: string[] = []
  const steps = d.newNodes.filter((n) => n.kind === 'step' || n.kind === 'subprocess').length
  const decisions = d.newNodes.filter((n) => n.kind === 'decision').length
  if (steps) parts.push(plural(steps, 'uusi vaihe', 'uutta vaihetta'))
  if (decisions) parts.push(plural(decisions, 'uusi päätös', 'uutta päätöstä'))
  if (d.changedNodes.length) parts.push(plural(d.changedNodes.length, 'päivitys', 'päivitystä'))
  if (d.removedNodes.length)
    parts.push(plural(d.removedNodes.length, 'vaihe poistuu', 'vaihetta poistuu'))
  if (d.newEdges.length) parts.push(plural(d.newEdges.length, 'yhteys', 'yhteyttä'))
  if (d.removedEdges.length)
    parts.push(plural(d.removedEdges.length, 'yhteys poistuu', 'yhteyttä poistuu'))
  const kinds = { role: 0, system: 0, artifact: 0 } as Record<string, number>
  for (const e of d.newEntities) kinds[e.kind]++
  if (kinds.role) parts.push(plural(kinds.role, 'uusi rooli', 'uutta roolia'))
  if (kinds.system) parts.push(plural(kinds.system, 'uusi järjestelmä', 'uutta järjestelmää'))
  if (kinds.artifact)
    parts.push(plural(kinds.artifact, 'uusi syöte/tuotos', 'uutta syötettä/tuotosta'))
  if (d.newProcesses.length)
    parts.push(plural(d.newProcesses.length, 'uusi prosessi', 'uutta prosessia'))
  return parts.join(' · ')
}
