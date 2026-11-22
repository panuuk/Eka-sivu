import { ensureEntity } from '../model/commands'
import { newId } from '../model/ids'
import type { Operation } from '../model/operations'
import type { EntityKind, Source, SourceRef } from '../model/types'
import { findMentions } from '../capture/mentions'
import { planText } from '../capture/plan'
import { opsAddRef, opsRemoveRef, opsUpdateSourceText } from '../capture/refs'
import type { Suggestion } from '../capture/suggest'
import { suggestionsToDsl } from '../capture/suggestToText'
import { capitalize, collapse, truncate } from '../capture/text'
import { insertNode, resolveAnchor } from './actions'
import { useStore } from './store'
import { useUi } from './ui'

const st = () => useStore.getState()

export function createSource(init: {
  title: string
  text: string
  kind: Source['kind']
  fileName?: string
}): string | undefined {
  const source: Source = {
    id: newId('src'),
    title: init.title.trim() || 'Nimetön lähde',
    kind: init.kind,
    text: init.text,
    addedAt: Date.now(),
    ...(init.fileName ? { fileName: init.fileName } : {}),
  }
  if (!st().dispatch({ type: 'addSource', source })) return undefined
  useUi.getState().setOpenSource(source.id)
  return source.id
}

export function updateSourceText(sourceId: string, text: string) {
  const { project } = st()
  if (!project?.sources[sourceId]) return
  st().dispatch(opsUpdateSourceText(project, sourceId, text))
}

/** Valitun tekstin nimeksi sopiva lyhyt versio. */
export function labelFromQuote(quote: string): string {
  const t = collapse(quote)
    .replace(/^[-*•–\d.)\s]+/, '')
    .replace(/[.!?…:;,\s]+$/, '')
  return truncate(capitalize(t), 90)
}

interface RangeInput {
  sourceId: string
  start: number
  end: number
}

function refFor(r: RangeInput): SourceRef | undefined {
  const source = st().project?.sources[r.sourceId]
  if (!source) return undefined
  const start = Math.max(0, Math.min(r.start, r.end))
  const end = Math.min(source.text.length, Math.max(r.start, r.end))
  const quote = source.text.slice(start, end)
  if (!quote.trim()) return undefined
  return { sourceId: r.sourceId, start, end, quote }
}

/** Luo vaiheen tai päätöksen valitusta tekstialueesta, liittää viitteen ja tunnistetut roolit ja järjestelmät. */
export function addNodeFromRange(
  range: RangeInput,
  kind: 'step' | 'decision' = 'step',
  label?: string,
): string | undefined {
  const { project } = st()
  const ref = refFor(range)
  if (!project || !ref) return undefined
  const mentions = findMentions(project, ref.quote, ['role', 'system'])
  const role = kind === 'step' ? mentions.find((m) => m.kind === 'role') : undefined
  const systems =
    kind === 'step'
      ? [...new Set(mentions.filter((m) => m.kind === 'system').map((m) => m.entityId))]
      : []
  const base = label?.trim() || labelFromQuote(ref.quote)
  return insertNode({
    kind,
    label: kind === 'decision' && !base.endsWith('?') ? `${base}?` : base,
    quiet: false,
    patch: {
      sources: [ref],
      ...(role ? { roleId: role.entityId } : {}),
      ...(systems.length ? { systemIds: systems } : {}),
    },
  })
}

/** Hyväksyy yhden ehdotuksen. Ehdon haarat saavat nimen Kyllä/Ei, jos liitoskohta on päätös. */
export function acceptSuggestion(s: Suggestion, sourceId: string): string | undefined {
  const edgeLabel = s.branch === 'yes' ? 'Kyllä' : s.branch === 'no' ? 'Ei' : undefined
  const { project, currentProcessId, selection } = st()
  if (!project) return undefined
  // Haara liitetään vain päätökseen: jos valittuna ei ole päätöstä, haara on tavallinen vaihe.
  const anchor = resolveAnchor(project, currentProcessId, selection)
  const useLabel =
    s.branch && anchor && project.nodes[anchor]?.kind === 'decision' ? edgeLabel : undefined
  return insertNode({
    kind: s.kind,
    label: s.label,
    edgeLabel: useLabel,
    patch: {
      sources: [{ sourceId, start: s.start, end: s.end, quote: s.quote }],
      ...(s.roleId ? { roleId: s.roleId } : {}),
      ...(s.systemIds.length ? { systemIds: s.systemIds } : {}),
    },
  })
}

/** Lisää useita ehdotuksia kerralla pikasyötteen suunnittelijalla (haarat yhdistyvät jatkoon). */
export function acceptSuggestions(list: Suggestion[], sourceId: string): boolean {
  const { project, currentProcessId, selection } = st()
  if (!project || list.length === 0) return false
  const { text, lineRefs } = suggestionsToDsl(project, list, sourceId)
  const anchor = resolveAnchor(project, currentProcessId, selection)
  const plan = planText(project, text, {
    processId: currentProcessId,
    anchorNodeId: anchor,
    lineRefs,
  })
  if (plan.hasErrors) {
    st().setError(
      `Ehdotuksia ei voitu lisätä: ${plan.issues.find((i) => i.severity === 'error')?.message ?? 'tuntematon virhe'}`,
    )
    return false
  }
  return st().dispatch(plan.ops)
}

/** Liittää valitun tekstin viitteeksi valittuun solmuun. */
export function attachRangeToNode(range: RangeInput, nodeId: string): boolean {
  const { project } = st()
  const ref = refFor(range)
  if (!project || !ref) return false
  const ops = opsAddRef(project, nodeId, ref)
  if (!ops.length) {
    st().setError('Tämä tekstikohta on jo liitetty vaiheeseen')
    return false
  }
  return st().dispatch(ops)
}

export function removeRef(nodeId: string, ref: SourceRef) {
  const { project } = st()
  if (!project) return
  st().dispatch(opsRemoveRef(project, nodeId, ref))
}

/** Luo (tai löytää) entiteetin valitusta tekstistä ja liittää sen valittuun solmuun, jos sellainen on. */
export function addEntityFromText(kind: EntityKind, name: string, nodeId?: string): void {
  const { project } = st()
  const clean = collapse(name)
  if (!project || !clean) return
  const { id, ops } = ensureEntity(project, kind, clean)
  const all: Operation[] = [...ops]
  const node = nodeId ? project.nodes[nodeId] : undefined
  if (node && node.kind !== 'start' && node.kind !== 'end') {
    if (kind === 'role') all.push({ type: 'updateNode', id: node.id, patch: { roleId: id } })
    else if (kind === 'system' && !node.systemIds.includes(id)) {
      all.push({ type: 'updateNode', id: node.id, patch: { systemIds: [...node.systemIds, id] } })
    }
  }
  if (all.length) st().dispatch(all)
}
