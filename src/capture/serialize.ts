import { formatRange } from '../model/duration'
import { edgesOf, nodesOf } from '../model/selectors'
import type { ProcessNode, Project } from '../model/types'

/** Prosessi pikasyötteen tekstimuotoon. Käänteinen toiminto `planText`:lle. */

const INDENT = '  '

const safe = (s: string) => s.replace(/\s+/g, ' ').trim()

function annotationText(p: Project, n: ProcessNode, io: boolean): string {
  const parts: string[] = []
  if (n.roleId && p.entities[n.roleId]) {
    const name = safe(p.entities[n.roleId].name)
    parts.push(/[\s@[\]<>~,;()"]/.test(name) ? `@(${name.replace(/[()]/g, '')})` : `@${name}`)
  }
  const roleName = (id: string) => {
    const name = safe(p.entities[id]?.name ?? '').replace(/[()]/g, '')
    return name ? (/[\s@[\]<>~,;"]/.test(name) ? `(${name})` : name) : ''
  }
  const names = (ids: string[]) =>
    ids.map((id) => safe(p.entities[id]?.name ?? '').replace(/[,;\]]/g, ' ')).filter(Boolean)
  const systems = names(n.systemIds)
  if (systems.length) parts.push(`[${systems.join(', ')}]`)
  if (io) {
    const inputs = names(n.inputIds)
    if (inputs.length) parts.push(`< ${inputs.join(', ')}`)
    const outputs = names(n.outputIds)
    if (outputs.length) parts.push(`> ${outputs.join(', ')}`)
  }
  for (const [letter, ids] of [
    ['A', n.raci?.accountableIds],
    ['C', n.raci?.consultedIds],
    ['I', n.raci?.informedIds],
  ] as const) {
    for (const id of ids ?? []) {
      const name = roleName(id)
      if (name) parts.push(`${letter}@${name}`)
    }
  }
  if (n.duration) parts.push(`=${formatRange(n.duration)}`)
  if (n.waiting) parts.push(`^${formatRange(n.waiting)}`)
  if (n.frequency) {
    const f = safe(n.frequency).replace(/[()]/g, '')
    parts.push(/\s/.test(f) ? `%(${f})` : `%${f}`)
  }
  for (const t of n.tags ?? []) parts.push(`#${t.replace(/\s+/g, '_')}`)
  for (const pp of n.painPoints ?? []) {
    // Merkintätekstistä poistetaan merkinnän erottimet, jotta rivi jäsentyy takaisin samaksi.
    const strip = (x: string) =>
      safe(x)
        .replace(/\s[@[<>~#%^=!]|[@[\]<>~]/g, ' ')
        .trim()
    const text = strip(pp.text)
    if (!text) continue
    parts.push(`!${pp.severity} ${text}${pp.idea ? ` => ${strip(pp.idea)}` : ''}`)
  }
  if (n.confidence !== 'likely')
    parts.push(`~${n.confidence === 'guess' ? 'arvaus' : 'vahvistettu'}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

interface SerializeOptions {
  /** Lisää ensimmäiselle riville otsikon `# Nimi`. */
  title?: boolean
}

export function processToText(
  p: Project,
  processId: string,
  options: SerializeOptions = {},
): string {
  const lines: string[] = []
  const proc = p.processes[processId]
  if (options.title && proc) lines.push(`# ${safe(proc.name)}`)
  lines.push(...metaLines(p, processId))
  lines.push(...serializeProcess(p, processId, 0))
  return lines.join('\n')
}

/** Prosessikortti ja roolien kuvaukset direktiiveinä (`:tarkoitus ...`, `:rooli Nimi: kuvaus`). */
function metaLines(p: Project, processId: string): string[] {
  const out: string[] = []
  const card = p.processes[processId]?.card
  if (card) {
    if (card.purpose) out.push(`:tarkoitus ${safe(card.purpose)}`)
    if (card.owner) out.push(`:omistaja ${safe(card.owner)}`)
    if (card.trigger) out.push(`:käynnistäjä ${safe(card.trigger)}`)
    if (card.customer) out.push(`:asiakas ${safe(card.customer)}`)
    for (const x of card.outputs ?? []) out.push(`:tuotos ${safe(x)}`)
    for (const x of card.metrics ?? []) out.push(`:mittari ${safe(x)}`)
    for (const x of card.risks ?? []) out.push(`:riski ${safe(x)}`)
    for (const x of card.checklist ?? []) out.push(`:tarkistus ${safe(x)}`)
  }
  // Roolien kuvaukset kuuluvat koko projektiin: tulostetaan vain päätason prosessin yhteydessä
  if (p.rootProcessId === processId) {
    for (const e of Object.values(p.entities)) {
      if (e.kind === 'role' && e.description?.trim()) {
        out.push(`:rooli ${safe(e.name).replace(/:/g, ' ')}: ${safe(e.description)}`)
      }
    }
  }
  return out
}

function serializeProcess(p: Project, processId: string, baseIndent: number): string[] {
  const nodes = nodesOf(p, processId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, { to: string; label?: string }[]>()
  const hasIn = new Set<string>()
  for (const e of edgesOf(p, processId)) {
    if (!out.has(e.from)) out.set(e.from, [])
    out.get(e.from)!.push({ to: e.to, label: e.label })
    hasIn.add(e.to)
  }
  const emitted = new Set<string>()
  const lines: string[] = []
  const pad = (n: number) => INDENT.repeat(baseIndent + n)
  const nameOf = (id: string) => safe(byId.get(id)?.label ?? '')

  /** Solmut, joihin `from`ista pääsee kulkematta jo tulostettujen solmujen kautta. */
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [from]
    while (queue.length) {
      const cur = queue.shift()!
      if (seen.has(cur) || emitted.has(cur)) continue
      seen.add(cur)
      for (const e of out.get(cur) ?? []) queue.push(e.to)
    }
    return seen
  }

  /** Haarojen yhtymäkohta: ensimmäinen solmu, jonne kaikki haarat johtavat. */
  const findJoin = (targets: string[], decisionId: string): string | undefined => {
    if (targets.length < 2) return undefined
    const sets = targets.map((t) => {
      const r = reach(t)
      r.delete(decisionId)
      return r
    })
    const queue = [targets[0]]
    const seen = new Set<string>()
    while (queue.length) {
      const cur = queue.shift()!
      if (seen.has(cur) || emitted.has(cur) || cur === decisionId) continue
      seen.add(cur)
      if (sets.every((s) => s.has(cur))) return cur
      for (const e of out.get(cur) ?? []) queue.push(e.to)
    }
    return undefined
  }

  const defaultBranchLabel = (i: number) => ['kyllä', 'ei'][i] ?? `haara ${i + 1}`

  const emitNode = (n: ProcessNode, depth: number) => {
    if (n.kind === 'start' || n.kind === 'end') {
      const word = n.kind === 'start' ? 'alku' : 'loppu'
      const def = n.kind === 'start' ? 'Alku' : 'Loppu'
      return void lines.push(
        `${pad(depth)}${word}${safe(n.label) && safe(n.label) !== def ? `: ${safe(n.label)}` : ''}`,
      )
    }
    if (n.kind === 'decision') {
      return void lines.push(`${pad(depth)}? ${safe(n.label)}${annotationText(p, n, false)}`)
    }
    const prefix = n.kind === 'subprocess' ? '+ ' : '- '
    lines.push(
      `${pad(depth)}${prefix}${safe(n.label)}${annotationText(p, n, n.kind !== 'subprocess')}`,
    )
    if (n.kind === 'subprocess') {
      if (n.childProcessId && p.processes[n.childProcessId]) {
        lines.push(...serializeProcess(p, n.childProcessId, baseIndent + depth + 1))
      }
    } else {
      for (const d of (n.description ?? '').split('\n'))
        if (d.trim()) lines.push(`${pad(depth + 1)}${safe(d)}`)
      for (const c of n.checklist ?? []) lines.push(`${pad(depth + 1)}:tarkistus ${safe(c)}`)
    }
  }

  const emitFrom = (start: string, depth: number, stopAt: Set<string>) => {
    let id: string | undefined = start
    while (id) {
      const n = byId.get(id)
      if (!n) return
      if (stopAt.has(id)) return
      if (emitted.has(id)) {
        lines.push(`${pad(depth)}-> ${nameOf(id)}`)
        return
      }
      emitted.add(id)
      emitNode(n, depth)
      const outs: { to: string; label?: string }[] = out.get(id) ?? []
      if (n.kind === 'end' || outs.length === 0) return
      if (n.kind !== 'decision' && outs.length === 1) {
        id = outs[0].to
        continue
      }
      // Haarautuva solmu. Päätöksen haarat sisennetään, ja yhtymäkohdasta jatketaan päätöksen tasolla.
      const join = findJoin(
        outs.map((o) => o.to),
        id,
      )
      outs.forEach((o, i) => {
        const label = safe(o.label ?? '') || defaultBranchLabel(i)
        const target = byId.get(o.to)
        if (!target) return
        if (o.to === join) lines.push(`${pad(depth + 1)}${label}: jatka`)
        else if (emitted.has(o.to)) lines.push(`${pad(depth + 1)}${label}: -> ${nameOf(o.to)}`)
        else if (target.kind === 'end') {
          lines.push(`${pad(depth + 1)}${label}: loppu`)
        } else {
          lines.push(`${pad(depth + 1)}${label}:`)
          emitFrom(o.to, depth + 2, new Set([...(join ? [join] : []), ...stopAt]))
        }
      })
      id = join
    }
  }

  const starts = nodes.filter((n) => n.kind === 'start')
  const roots = [...starts, ...nodes.filter((n) => n.kind !== 'start' && !hasIn.has(n.id))]
  let first = true
  for (const r of roots) {
    if (emitted.has(r.id)) continue
    if (!first) lines.push(`${pad(0)}---`)
    first = false
    emitFrom(r.id, 0, new Set())
  }
  // Sykliset osat, joihin ei pääse alkupisteistä
  for (const n of nodes) {
    if (emitted.has(n.id)) continue
    if (!first) lines.push(`${pad(0)}---`)
    first = false
    emitFrom(n.id, 0, new Set())
  }
  return lines
}
