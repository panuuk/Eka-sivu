import { normalizeName } from '../model/selectors'
import type { Confidence, ProcessNode, Project } from '../model/types'

export interface Filter {
  text: string
  roleId?: string
  systemId?: string
  confidence?: Confidence
  /** Vain vaiheet, joilla on avoimia kysymyksiä. */
  openOnly?: boolean
}

export const EMPTY_FILTER: Filter = { text: '' }

export function filterActive(f: Filter): boolean {
  return Boolean(f.text.trim() || f.roleId || f.systemId || f.confidence || f.openOnly)
}

/** Vaiheen hakuteksti: nimi, kuvaus, muistiinpanot sekä liitettyjen entiteettien nimet ja aliakset. */
function haystack(p: Project, n: ProcessNode): string {
  const parts = [n.label, n.description ?? '', n.notes ?? '']
  const ids = [n.roleId, ...n.systemIds, ...n.inputIds, ...n.outputIds]
  for (const id of ids) {
    const e = id ? p.entities[id] : undefined
    if (e) parts.push(e.name, ...e.aliases)
  }
  return normalizeName(parts.join(' \n '))
}

export interface SearchHit {
  node: ProcessNode
  /** Mistä kentästä osuma löytyi (nimi, kuvaus, rooli...) */
  where: string[]
}

/**
 * Suodattaa vaiheet. Hakusanat yhdistetään JA-ehdolla (jokaisen on löydyttävä), ja muut ehdot rajaavat lisää.
 * `openNodeIds` on joukko vaiheista, joilla on avoimia kysymyksiä.
 */
export function matchNodes(
  p: Project,
  f: Filter,
  openNodeIds: ReadonlySet<string> = new Set(),
): ProcessNode[] {
  const tokens = normalizeName(f.text).split(' ').filter(Boolean)
  const out: ProcessNode[] = []
  for (const n of Object.values(p.nodes)) {
    if (f.roleId && n.roleId !== f.roleId) continue
    if (f.systemId && !n.systemIds.includes(f.systemId)) continue
    if (f.confidence && n.confidence !== f.confidence) continue
    if (f.openOnly && !openNodeIds.has(n.id)) continue
    if (tokens.length) {
      const hay = haystack(p, n)
      if (!tokens.every((t) => hay.includes(t))) continue
    }
    out.push(n)
  }
  return out
}

/** Hakutulokset luettavina osumina: kertoo, mistä kentästä jokainen hakusana löytyi. */
export function searchHits(
  p: Project,
  f: Filter,
  openNodeIds?: ReadonlySet<string>,
  limit = 50,
): SearchHit[] {
  const tokens = normalizeName(f.text).split(' ').filter(Boolean)
  return matchNodes(p, f, openNodeIds)
    .filter((n) => n.kind !== 'start' && n.kind !== 'end')
    .slice(0, limit)
    .map((node) => {
      const where: string[] = []
      const has = (s: string | undefined) => !!s && tokens.some((t) => normalizeName(s).includes(t))
      if (has(node.label)) where.push('nimi')
      if (has(node.description)) where.push('kuvaus')
      if (has(node.notes)) where.push('muistiinpano')
      if (has(node.roleId ? p.entities[node.roleId]?.name : undefined)) where.push('rooli')
      if (node.systemIds.some((id) => has(p.entities[id]?.name))) where.push('järjestelmä')
      if ([...node.inputIds, ...node.outputIds].some((id) => has(p.entities[id]?.name)))
        where.push('syöte/tuotos')
      return { node, where }
    })
}
