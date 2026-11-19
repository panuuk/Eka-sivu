import type { Entity, EntityKind, Project } from '../model/types'

export interface Mention {
  start: number
  end: number
  entityId: string
  kind: EntityKind
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Taivutusmuotojen tunnistus ilman sanakirjaa: nimestä otetaan etuosa (pitkistä nimistä viimeiset
 * kirjaimet pois), jolloin esim. "Myynti" tunnistaa myös "myynnin" ja "Esimies" tunnistaa "esimiehen".
 */
export function stemPattern(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const last = words[words.length - 1]
  // Pitkistä nimistä jätetään loppu pois. -nti/-nto-päätteet saavat lisäksi konsonanttivaihtelun
  // huomioon: "myynti" -> "myynnin", "hallinto" -> "hallinnon".
  const gradation = /n[td][aiouäöe]$/i.test(last)
  const trim = last.length >= 8 || (gradation && last.length >= 5) ? 2 : last.length >= 5 ? 1 : 0
  const stem = last.slice(0, Math.max(last.length - trim, Math.min(last.length, 3)))
  const head = words.slice(0, -1).map(escapeRe)
  const tail = trim > 0 ? `${escapeRe(stem)}[\\p{L}]*` : `${escapeRe(stem)}(?![\\p{L}])`
  return [...head, tail].join('\\s+')
}

function patternFor(entity: Entity): RegExp | undefined {
  const names = [entity.name, ...entity.aliases].map((n) => n.trim()).filter((n) => n.length >= 2)
  if (!names.length) return undefined
  const alt = names
    .map(stemPattern)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})`, 'giu')
}

/** Etsii tekstistä projektin roolien, järjestelmien ja tuotosten maininnat taivutusmuodot mukaan lukien. */
export function findMentions(
  project: Pick<Project, 'entities'>,
  text: string,
  kinds?: EntityKind[],
): Mention[] {
  const found: Mention[] = []
  for (const entity of Object.values(project.entities)) {
    if (kinds && !kinds.includes(entity.kind)) continue
    const re = patternFor(entity)
    if (!re) continue
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      found.push({
        start: m.index,
        end: m.index + m[0].length,
        entityId: entity.id,
        kind: entity.kind,
      })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  // Päällekkäisistä osumista pidetään pisin; samanpituisista aiempi.
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const out: Mention[] = []
  for (const m of found) {
    const prev = out[out.length - 1]
    if (prev && m.start < prev.end) {
      if (m.end - m.start > prev.end - prev.start) out[out.length - 1] = m
      continue
    }
    out.push(m)
  }
  return out
}
