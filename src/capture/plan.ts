import { ensureEntity, opsDeleteNodeBridging } from '../model/commands'
import { createEdge, createNode, createProcess } from '../model/factory'
import { newId } from '../model/ids'
import { applyOperation, type Operation } from '../model/operations'
import { incoming, nodesOf, normalizeName, outgoing } from '../model/selectors'
import type {
  Confidence,
  EntityKind,
  NodeKind,
  ProcessCard,
  Project,
  SourceRef,
} from '../model/types'
import { diffProjects, type ProjectDiff } from './diff'
import {
  parseSyntax,
  walkItems,
  type DocMeta,
  type Issue,
  type ParsedItem,
  type ParseResult,
} from './syntax'

export interface PlanOptions {
  /** Kohdeprosessi. Ei käytössä, jos `newProcessName` on annettu. */
  processId: string
  /** Luo teksti uudeksi prosessiksi tällä nimellä. */
  newProcessName?: string
  /** Liitoskohta (esim. valittu vaihe). Ilman sitä liitoskohta päätellään prosessista. */
  anchorNodeId?: string
  /** `standalone`: sisältöä ei liitetä olemassa olevaan. */
  mode?: 'append' | 'standalone'
  saveSource?: boolean
  sourceTitle?: string
  skipLines?: ReadonlySet<number>
  /** Viitteet olemassa oleviin lähteisiin rivinumeron mukaan (ohittaa `saveSource`-viitteet). */
  lineRefs?: ReadonlyMap<number, SourceRef>
  /**
   * Ehdota poistettavaksi kohdeprosessin vaiheet, joita teksti ei mainitse (tekstin on kuvattava koko prosessi).
   * Vain `append`-tilassa ilman liitoskohtaa ja vain, jos teksti jäsentyy ilman virheitä.
   */
  removeMissing?: boolean
  /** Poistoehdotukset, jotka käyttäjä haluaa säilyttää. */
  keepIds?: ReadonlySet<string>
}

interface Removal {
  id: string
  label: string
  kind: NodeKind
}

export type EffectStatus = 'new' | 'matched' | 'updated' | 'branch' | 'link' | 'note' | 'renamed'

interface LineEffect {
  line: number
  status: EffectStatus
  text: string
}

interface PlanResult {
  ops: Operation[]
  after: Project
  parse: ParseResult
  issues: Issue[]
  effects: LineEffect[]
  /** Poistoehdotukset (kaikki ehdokkaat, myös säilytettäviksi valitut). */
  removals: Removal[]
  diff: ProjectDiff
  targetProcessId: string
  hasErrors: boolean
}

interface Exit {
  from: string
  label?: string
}

class Planner {
  p: Project
  readonly before: Project
  ops: Operation[] = []
  issues: Issue[] = []
  effects: LineEffect[] = []
  /** Tässä suunnitelmassa luodut tai täsmätyt solmut. */
  touched = new Set<string>()
  created = new Set<string>()
  private consumed = new Set<string>()
  /** Nimenmuutokset: vanha nimi (normalisoitu) -> vaihe, jotta vanhaan nimeen viittaavat hypyt löytävät kohteensa. */
  private renames = new Map<string, string>()
  private gotos: {
    from: string
    label?: string
    target: string
    line: number
    processId: string
  }[] = []
  private sourceId?: string
  private text: string
  /** Tekstissä annetut alku- ja loppupisteen nimet. */
  lineRefs?: ReadonlyMap<number, SourceRef>
  private terminalLabels: { start?: string; end?: string } = {}

  constructor(project: Project, text: string, saveSource: boolean, sourceTitle: string) {
    this.p = project
    this.before = project
    this.text = text
    if (saveSource) {
      this.sourceId = newId('src')
      this.emit({
        type: 'addSource',
        source: { id: this.sourceId, title: sourceTitle, kind: 'note', text, addedAt: Date.now() },
      })
    }
  }

  setTerminalLabels(items: ParsedItem[]) {
    walkItems(items, (it) => {
      if (
        (it.kind === 'start' || it.kind === 'end') &&
        it.label !== 'Alku' &&
        it.label !== 'Loppu'
      ) {
        this.terminalLabels[it.kind] ??= it.label
      }
    })
  }

  emit(op: Operation) {
    this.p = applyOperation(this.p, op)
    this.ops.push(op)
  }

  effect(line: number, status: EffectStatus, text: string) {
    this.effects.push({ line, status, text })
  }

  err(line: number, message: string) {
    this.issues.push({ line, severity: 'error', message })
  }
  warn(line: number, message: string) {
    this.issues.push({ line, severity: 'warning', message })
  }

  private entity(kind: EntityKind, name: string): string {
    const { id, ops } = ensureEntity(this.p, kind, name)
    for (const op of ops) this.emit(op)
    return id
  }

  private sourceRef(item: { start: number; end: number; line: number }): SourceRef | undefined {
    const external = this.lineRefs?.get(item.line)
    if (external) return external
    if (!this.sourceId) return undefined
    return {
      sourceId: this.sourceId,
      start: item.start,
      end: item.end,
      quote: this.text.slice(item.start, item.end),
    }
  }

  /** Etsii olemassa olevan, vielä täsmäämättömän solmun samalla nimellä ja yhteensopivalla tyypillä. */
  private findExisting(processId: string, label: string, kind: NodeKind): string | undefined {
    const target = normalizeName(label)
    const compatible = (k: NodeKind) =>
      kind === 'decision' ? k === 'decision' : k === 'step' || k === 'subprocess'
    return nodesOf(this.p, processId).find(
      (n) => !this.consumed.has(n.id) && compatible(n.kind) && normalizeName(n.label) === target,
    )?.id
  }

  private singleton(processId: string, kind: 'start' | 'end'): string {
    const existing = nodesOf(this.p, processId).find((n) => n.kind === kind)
    if (existing) return existing.id
    const node = createNode(processId, {
      kind,
      label: this.terminalLabels[kind] ?? (kind === 'start' ? 'Alku' : 'Loppu'),
      confidence: 'confirmed',
    })
    this.emit({ type: 'addNode', node })
    this.created.add(node.id)
    return node.id
  }

  /** Luo tai täsmää solmu ja soveltaa merkinnät. Palauttaa solmun tunnisteen. */
  private resolveNode(item: ParsedItem, processId: string): string {
    if (item.kind === 'start' || item.kind === 'end') {
      const existed = nodesOf(this.p, processId).some((n) => n.kind === item.kind)
      const id = this.singleton(processId, item.kind)
      this.touched.add(id)
      this.effect(
        item.line,
        existed ? 'matched' : 'new',
        existed ? 'Olemassa oleva' : item.kind === 'start' ? 'Uusi alkupiste' : 'Uusi loppupiste',
      )
      return id
    }
    const kind: NodeKind =
      item.kind === 'decision' ? 'decision' : item.kind === 'subprocess' ? 'subprocess' : 'step'
    let existing = this.findExisting(processId, item.label, kind)
    let renamed = false
    if (!existing && item.renamedFrom) {
      // Nimenmuutos: vanha vaihe säilyy (yhteydet, roolit, lähteet) ja saa uuden nimen
      const old = this.findExisting(processId, item.renamedFrom, kind)
      if (old) {
        this.emit({ type: 'updateNode', id: old, patch: { label: item.label } })
        existing = old
        renamed = true
        this.renames.set(normalizeName(item.renamedFrom), old)
      }
    }
    const ref = this.sourceRef(item)
    if (existing) {
      this.consumed.add(existing)
      this.touched.add(existing)
      const before = this.p
      this.applyAnnotations(existing, item)
      if (kind === 'subprocess' && this.p.nodes[existing].kind === 'step') {
        this.emit({ type: 'updateNode', id: existing, patch: { kind: 'subprocess' } })
      }
      if (ref) {
        const cur = this.p.nodes[existing]
        const dup = cur.sources.some(
          (r) => r.sourceId === ref.sourceId && r.start === ref.start && r.end === ref.end,
        )
        if (!dup)
          this.emit({ type: 'updateNode', id: existing, patch: { sources: [...cur.sources, ref] } })
      }
      const changed =
        this.p !== before &&
        JSON.stringify(before.nodes[existing]) !== JSON.stringify(this.p.nodes[existing])
      if (renamed) this.effect(item.line, 'renamed', `Uusi nimi vaiheelle “${item.renamedFrom}”`)
      else
        this.effect(
          item.line,
          changed ? 'updated' : 'matched',
          changed ? 'Päivittää olemassa olevaa vaihetta' : 'Olemassa oleva vaihe',
        )
      return existing
    }
    const node = createNode(processId, {
      label: item.label,
      kind,
      confidence: item.ann.confidence ?? 'likely',
      sources: ref ? [ref] : [],
    })
    this.emit({ type: 'addNode', node })
    this.created.add(node.id)
    this.consumed.add(node.id)
    this.touched.add(node.id)
    this.applyAnnotations(node.id, item)
    this.effect(
      item.line,
      'new',
      kind === 'decision'
        ? 'Uusi päätös'
        : kind === 'subprocess'
          ? 'Uusi alaprosessi'
          : 'Uusi vaihe',
    )
    return node.id
  }

  private applyAnnotations(nodeId: string, item: ParsedItem) {
    const ann = item.ann
    const cur = this.p.nodes[nodeId]
    const patch: Record<string, unknown> = {}
    if (ann.role) {
      const roleId = this.entity('role', ann.role)
      if (cur.roleId !== roleId) patch.roleId = roleId
    }
    const union = (existing: string[], kind: EntityKind, names: string[]) => {
      const next = [...existing]
      for (const name of names) {
        const id = this.entity(kind, name)
        if (!next.includes(id)) next.push(id)
      }
      return next.length === existing.length ? undefined : next
    }
    const systems = union(cur.systemIds, 'system', ann.systems)
    if (systems) patch.systemIds = systems
    const inputs = union(cur.inputIds, 'artifact', ann.inputs)
    if (inputs) patch.inputIds = inputs
    const outputs = union(cur.outputIds, 'artifact', ann.outputs)
    if (outputs) patch.outputIds = outputs
    if (ann.confidence && ann.confidence !== cur.confidence)
      patch.confidence = ann.confidence as Confidence
    // Tietotyön merkinnät: arvot asetetaan, listat yhdistetään (idempotentti)
    if (ann.duration && JSON.stringify(ann.duration) !== JSON.stringify(cur.duration))
      patch.duration = ann.duration
    if (ann.waiting && JSON.stringify(ann.waiting) !== JSON.stringify(cur.waiting))
      patch.waiting = ann.waiting
    if (ann.frequency && ann.frequency !== cur.frequency) patch.frequency = ann.frequency
    const tags = [...new Set([...(cur.tags ?? []), ...ann.tags])]
    if (tags.length !== (cur.tags ?? []).length) patch.tags = tags
    const pains = [...(cur.painPoints ?? [])]
    for (const pp of ann.pains) {
      const same = pains.find(
        (x) => x.text.toLocaleLowerCase('fi') === pp.text.toLocaleLowerCase('fi'),
      )
      if (!same) pains.push({ id: newId('pp'), ...pp })
      else if (same.severity !== pp.severity || (pp.idea && same.idea !== pp.idea)) {
        pains[pains.indexOf(same)] = { ...same, severity: pp.severity, idea: pp.idea ?? same.idea }
      }
    }
    if (JSON.stringify(pains) !== JSON.stringify(cur.painPoints ?? [])) patch.painPoints = pains
    const raciKeys = [
      ['a', 'accountableIds'],
      ['c', 'consultedIds'],
      ['i', 'informedIds'],
    ] as const
    let raci = cur.raci
    for (const [letter, key] of raciKeys) {
      const next = union(raci?.[key] ?? [], 'role', ann.raci[letter])
      if (next) raci = { ...raci, [key]: next }
    }
    if (raci !== cur.raci) patch.raci = raci
    if (item.checklist?.length) {
      const have = cur.checklist ?? []
      const next = [...have, ...item.checklist.filter((c) => !have.includes(c))]
      if (next.length !== have.length) patch.checklist = next
    }
    if (item.notes.length) {
      const text = item.notes.join('\n')
      if (!cur.description) patch.description = text
      else if (!cur.description.includes(text)) patch.description = `${cur.description}\n${text}`
    }
    if (Object.keys(patch).length) this.emit({ type: 'updateNode', id: nodeId, patch })
  }

  /** Yhdistää odottavat ulosmenot kohteeseen. Jo olemassa olevaa yhteyttä ei lisätä uudelleen. */
  connect(exits: Exit[], toId: string) {
    const to = this.p.nodes[toId]
    const seen = new Set<string>()
    for (const ex of exits) {
      const key = `${ex.from}|${ex.label ?? ''}`
      if (seen.has(key) || ex.from === toId) continue
      seen.add(key)
      const from = this.p.nodes[ex.from]
      if (!from || from.processId !== to.processId) continue
      const existing = Object.values(this.p.edges).find((e) => e.from === ex.from && e.to === toId)
      if (existing) {
        if (ex.label && !existing.label)
          this.emit({ type: 'updateEdge', id: existing.id, patch: { label: ex.label } })
        continue
      }
      this.emit({ type: 'addEdge', edge: createEdge(from.processId, ex.from, toId, ex.label) })
    }
  }

  /**
   * `dropEntryIfMatched`: jos ensimmäinen vaihe täsmää olemassa olevaan, teksti kuvaa jo olemassa olevaa
   * eikä sitä liitetä liitoskohtaan (näin saman tekstin uudelleenlisäys ei muuta mitään).
   */
  planSequence(
    items: ParsedItem[],
    processId: string,
    entry: Exit[],
    dropEntryIfMatched = false,
  ): Exit[] {
    let exits = entry
    let first = true
    let endedByBreak = false
    for (const item of items) {
      if (item.kind === 'break') {
        exits = []
        first = false
        endedByBreak = true
        continue
      }
      if (item.kind !== 'goto' && !item.label) continue // virhe on jo raportoitu
      if (item.kind === 'goto') {
        for (const ex of exits)
          this.gotos.push({
            from: ex.from,
            label: ex.label,
            target: item.label,
            line: item.line,
            processId,
          })
        this.effect(item.line, 'link', `Hyppy kohteeseen “${item.label}”`)
        exits = []
        continue
      }
      const id = this.resolveNode(item, processId)
      if (first && dropEntryIfMatched && !this.created.has(id)) exits = []
      // Edellinen rivi päätti ketjun (loppu, hyppy tai kaikki haarat päättyvät): tähän ei tule yhteyttä.
      if (!first && exits.length === 0 && item.kind !== 'start' && !endedByBreak) {
        this.warn(
          item.line,
          `“${item.label}” ei saa yhteyttä edelliseen riviin, koska edellinen rivi päättää ketjun. Lisää erotin --- jos tämä on tarkoituksellista.`,
        )
      }
      first = false
      endedByBreak = false
      this.connect(exits, id)

      if (item.kind === 'end') {
        exits = []
      } else if (item.kind === 'decision') {
        exits = this.planDecision(item, id, processId)
      } else if (item.kind === 'subprocess') {
        this.planSubprocess(item, id)
        exits = [{ from: id }]
      } else {
        exits = [{ from: id }]
      }
    }
    return exits
  }

  private planDecision(item: ParsedItem, id: string, processId: string): Exit[] {
    const out: Exit[] = []
    item.branches.forEach((branch, i) => {
      const label = branch.label || ['Kyllä', 'Ei'][i] || ''
      const start: Exit = { from: id, label: label || undefined }
      this.effect(branch.line, 'branch', `Haara “${label || '–'}”`)
      if (branch.jump === 'continue' || (!branch.jump && branch.body.length === 0)) {
        out.push(start)
      } else if (branch.jump === 'end') {
        this.connect([start], this.singleton(processId, 'end'))
      } else if (branch.jump) {
        this.gotos.push({
          from: id,
          label: start.label,
          target: branch.jump.goto,
          line: branch.line,
          processId,
        })
      } else {
        out.push(...this.planSequence(branch.body, processId, [start]))
      }
    })
    return out
  }

  private planSubprocess(item: ParsedItem, nodeId: string) {
    const node = this.p.nodes[nodeId]
    if (node.childProcessId && this.p.processes[node.childProcessId]) {
      if (item.children.length) this.planInto(item.children, node.childProcessId)
      return
    }
    const child = createProcess(node.label, nodeId)
    this.emit({ type: 'addProcess', process: child })
    this.emit({
      type: 'updateNode',
      id: nodeId,
      patch: { kind: 'subprocess', childProcessId: child.id },
    })
    const start = createNode(child.id, { kind: 'start', label: 'Alku', confidence: 'confirmed' })
    const end = createNode(child.id, { kind: 'end', label: 'Loppu', confidence: 'confirmed' })
    this.emit({ type: 'addNode', node: start })
    this.emit({ type: 'addNode', node: end })
    this.created.add(start.id)
    this.created.add(end.id)
    const exits = this.planSequence(item.children, child.id, [{ from: start.id }])
    this.connect(exits, end.id)
  }

  /** Lisää sisällön olemassa olevan prosessin loppuun (liitoskohta päätellään). */
  planInto(
    items: ParsedItem[],
    processId: string,
    anchorNodeId?: string,
    standalone = false,
  ): void {
    const nodes = nodesOf(this.p, processId)
    const hasOwnStartEnd = items.some((i) => i.kind === 'start' || i.kind === 'end')
    let entry: Exit[] = []
    let splice: { id: string; to: string; anchor: string } | undefined
    let autoEnd = false

    if (nodes.length === 0 && !hasOwnStartEnd) {
      const start = this.singleton(processId, 'start')
      this.touched.add(start)
      entry = [{ from: start }]
      autoEnd = true
    } else if (!standalone) {
      let anchor =
        anchorNodeId && this.p.nodes[anchorNodeId]?.processId === processId
          ? anchorNodeId
          : undefined
      if (anchor && this.p.nodes[anchor].kind === 'end') {
        const preds = incoming(this.p, anchor)
        anchor = preds.length === 1 ? preds[0].from : undefined
      }
      if (!anchor) {
        const end = nodes.find((n) => n.kind === 'end')
        if (end) {
          const preds = incoming(this.p, end.id)
          if (preds.length === 1) anchor = preds[0].from
          else if (preds.length > 1)
            this.warn(
              items[0]?.line ?? 1,
              'Prosessin loppuun tulee useita yhteyksiä: liitoskohtaa ei voitu päätellä, uusi sisältö jää irralliseksi. Valitse liitoskohta kaaviosta.',
            )
        } else {
          const tails = nodes.filter((n) => n.kind !== 'end' && outgoing(this.p, n.id).length === 0)
          if (tails.length === 1) anchor = tails[0].id
          else if (nodes.length > 0 && tails.length > 1)
            this.warn(
              items[0]?.line ?? 1,
              'Prosessissa on useita päättyviä haaroja: liitoskohtaa ei voitu päätellä, uusi sisältö jää irralliseksi. Valitse liitoskohta kaaviosta.',
            )
        }
      }
      if (anchor) {
        entry = [{ from: anchor }]
        const outs = outgoing(this.p, anchor)
        if (outs.length === 1 && this.p.nodes[anchor].kind !== 'decision')
          splice = { id: outs[0].id, to: outs[0].to, anchor }
      }
    }

    const exits = this.planSequence(items, processId, entry, true)

    if (autoEnd && exits.length) {
      const end = this.singleton(processId, 'end')
      this.touched.add(end)
      this.connect(exits, end)
    } else if (splice && this.p.edges[splice.id]) {
      const T = splice.to
      const added = new Set(this.ops.flatMap((o) => (o.type === 'addEdge' ? [o.edge.id] : [])))
      const addedEdges = Object.values(this.p.edges).filter((e) => added.has(e.id))
      const newEntry = addedEdges.some((e) => e.from === splice!.anchor && e.to !== T)
      let reachesT = addedEdges.some((e) => e.to === T && e.from !== splice!.anchor)
      if (!reachesT && exits.length && newEntry) {
        this.connect(exits, T)
        reachesT = true
      }
      // Uusi sisältö on lisätty liitoskohdan ja sen vanhan seuraajan väliin: poista suora yhteys.
      if (newEntry && reachesT) this.emit({ type: 'deleteEdge', id: splice.id })
    }
  }

  /** Prosessikortti ja roolien kuvaukset direktiiveistä. Tekstikentät korvataan, listat yhdistetään (idempotentti). */
  applyMeta(meta: DocMeta, processId: string) {
    const cur = this.p.processes[processId]?.card ?? {}
    const next: ProcessCard = { ...cur }
    for (const k of ['purpose', 'owner', 'trigger', 'customer'] as const) {
      const v = meta.card[k]
      if (v) next[k] = v
    }
    for (const k of ['outputs', 'metrics', 'risks', 'checklist'] as const) {
      const add = meta.card[k]
      if (!add?.length) continue
      const have = next[k] ?? []
      next[k] = [...have, ...add.filter((x) => !have.includes(x))]
    }
    const cardChanged = JSON.stringify(next) !== JSON.stringify(cur)
    if (cardChanged) this.emit({ type: 'updateProcess', id: processId, patch: { card: next } })
    let rolesChanged = false
    for (const r of meta.roles) {
      const id = this.entity('role', r.name)
      if (this.p.entities[id].description !== r.description) {
        this.emit({ type: 'updateEntity', id, patch: { description: r.description } })
        rolesChanged = true
      }
    }
    const roleLines = new Set(meta.roles.map((r) => r.line))
    for (const l of meta.lines) {
      const isRole = roleLines.has(l.line)
      const changed = isRole ? rolesChanged : cardChanged
      this.effect(
        l.line,
        changed ? 'updated' : 'matched',
        isRole ? 'Roolin kuvaus' : 'Prosessikortin tieto',
      )
    }
  }

  resolveGotos() {
    for (const g of this.gotos) {
      const target = normalizeName(g.target)
      const candidates = nodesOf(this.p, g.processId).filter(
        (n) => normalizeName(n.label) === target,
      )
      const renamedTo = this.renames.get(target)
      const best =
        candidates.find((n) => this.touched.has(n.id)) ??
        candidates[0] ??
        (renamedTo ? this.p.nodes[renamedTo] : undefined)
      if (!best) {
        this.err(g.line, `Hyppykohdetta “${g.target}” ei löytynyt`)
        continue
      }
      this.connect([{ from: g.from, label: g.label }], best.id)
    }
    this.gotos = []
  }
}

/**
 * Muuttaa pikasyötteen tekstin operaatioiksi. Funktio on puhdas: se ei muuta annettua projektia,
 * vaan palauttaa operaatiot, tuloksena syntyvän projektin ja selitykset esikatselua varten.
 */
export function planText(project: Project, text: string, options: PlanOptions): PlanResult {
  const parse = parseSyntax(text, { skipLines: options.skipLines })
  const planner = new Planner(
    project,
    text,
    options.saveSource ?? false,
    options.sourceTitle ?? 'Pikasyöte',
  )
  planner.lineRefs = options.lineRefs

  let processId = options.processId
  if (options.newProcessName !== undefined) {
    const proc = createProcess(options.newProcessName.trim() || parse.title || 'Uusi prosessi')
    planner.emit({ type: 'addProcess', process: proc })
    processId = proc.id
  }

  const hasErrors = parse.issues.some((i) => i.severity === 'error')
  if (parse.meta) planner.applyMeta(parse.meta, processId)
  if (parse.items.length > 0) {
    planner.setTerminalLabels(parse.items)
    planner.planInto(
      parse.items,
      processId,
      options.anchorNodeId,
      options.mode === 'standalone' || options.newProcessName !== undefined,
    )
    planner.resolveGotos()
  }

  // Poistoehdotukset: vaiheet, joita koko prosessin kuvaavassa tekstissä ei ole
  const removals: Removal[] = []
  if (
    options.removeMissing &&
    options.newProcessName === undefined &&
    options.mode !== 'standalone' &&
    !options.anchorNodeId &&
    parse.items.length > 0 &&
    !hasErrors &&
    !planner.issues.some((i) => i.severity === 'error')
  ) {
    for (const n of nodesOf(planner.p, processId)) {
      if (n.kind === 'start' || n.kind === 'end') continue
      if (planner.touched.has(n.id)) continue
      removals.push({ id: n.id, label: n.label, kind: n.kind })
    }
    for (const r of removals) {
      if (options.keepIds?.has(r.id)) continue
      for (const op of opsDeleteNodeBridging(planner.p, r.id)) planner.emit(op)
    }
  }

  const issues = [...parse.issues, ...planner.issues].sort((a, b) => a.line - b.line)
  return {
    ops: planner.ops,
    after: planner.p,
    parse,
    issues,
    effects: planner.effects.sort((a, b) => a.line - b.line),
    removals,
    diff: diffProjects(project, planner.p),
    targetProcessId: processId,
    hasErrors: hasErrors || planner.issues.some((i) => i.severity === 'error'),
  }
}
