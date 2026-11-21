import { formatRange } from '../model/duration'
import type { Project, SourceRef } from '../model/types'
import type { Suggestion } from './suggest'

const cleanLabel = (s: string) =>
  s
    .replace(/[@[\]<>~]/g, ' ')
    .replace(/^(?:[-*+?•–]|->|→)+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()

function annotations(p: Pick<Project, 'entities'>, s: Suggestion): string {
  const parts: string[] = []
  const roleName = s.roleId && p.entities[s.roleId] ? p.entities[s.roleId].name : s.roleName
  if (roleName) {
    const name = roleName.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
    if (name) parts.push(/[\s@[\]<>~,;"]/.test(name) ? `@(${name})` : `@${name}`)
  }
  const systems = [...s.systemIds.map((id) => p.entities[id]?.name), ...(s.systemNames ?? [])]
    .map((n) => n?.replace(/[,;\]]/g, ' ').trim())
    .filter(Boolean)
  if (systems.length) parts.push(`[${systems.join(', ')}]`)
  if (s.duration) parts.push(`=${formatRange(s.duration)}`)
  if (s.waiting) parts.push(`^${formatRange(s.waiting)}`)
  if (s.frequency) parts.push(/\s/.test(s.frequency) ? `%(${s.frequency})` : `%${s.frequency}`)
  for (const pp of s.pains ?? []) {
    const text = pp.text
      .replace(/[@[\]<>~#%^=!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) parts.push(`!${pp.severity} ${text}`)
  }
  return parts.length ? ` ${parts.join(' ')}` : ''
}

/**
 * Muuntaa ehdotukset pikasyötteen tekstiksi, jolloin ne voi lisätä malliin samalla suunnittelijalla
 * kuin käsin kirjoitetun tekstin (liitoskohdan päättely, nimitäsmäys, haarojen yhdistyminen).
 * Palauttaa myös rivikohtaiset viitteet alkuperäiseen lähteeseen.
 */
export function suggestionsToDsl(
  project: Pick<Project, 'entities'>,
  suggestions: Suggestion[],
  sourceId: string,
): { text: string; lineRefs: Map<number, SourceRef> } {
  const lines: string[] = []
  const lineRefs = new Map<number, SourceRef>()
  const add = (line: string, s: Suggestion) => {
    lines.push(line)
    lineRefs.set(lines.length, { sourceId, start: s.start, end: s.end, quote: s.quote })
  }

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    if (s.kind === 'decision') {
      add(`? ${cleanLabel(s.label)}`, s)
      let yes: Suggestion | undefined
      let no: Suggestion | undefined
      while (
        i + 1 < suggestions.length &&
        suggestions[i + 1].kind === 'step' &&
        suggestions[i + 1].branch
      ) {
        const b = suggestions[i + 1]
        if (b.branch === 'yes' && !yes) yes = b
        else if (b.branch === 'no' && !no) no = b
        else break
        i++
      }
      const branch = (name: string, b?: Suggestion) => {
        if (!b) return void lines.push(`  ${name}: jatka`)
        add(`  ${name}: ${cleanLabel(b.label)}${annotations(project, b)}`, b)
      }
      branch('kyllä', yes)
      branch('ei', no)
    } else {
      add(`- ${cleanLabel(s.label)}${annotations(project, s)}`, s)
    }
  }
  return { text: lines.join('\n'), lineRefs }
}
