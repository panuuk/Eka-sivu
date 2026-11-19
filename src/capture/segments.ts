/** Lähdetekstin korostukset: jakaa tekstin osiin, joissa jokaisella on joukko päällekkäisiä merkintöjä. */

export type MarkType = 'ref' | 'role' | 'system' | 'artifact' | 'suggestion' | 'selection' | 'focus'

export interface Mark {
  start: number
  end: number
  type: MarkType
  /** Viitteen solmut (type = ref). */
  nodeIds?: string[]
  suggestionId?: string
  stale?: boolean
}

export interface Segment {
  start: number
  end: number
  text: string
  marks: Mark[]
}

export function buildSegments(text: string, marks: Mark[]): Segment[] {
  const len = text.length
  const valid = marks
    .map((m) => ({ ...m, start: Math.max(0, m.start), end: Math.min(len, m.end) }))
    .filter((m) => m.end > m.start)
  const bounds = new Set<number>([0, len])
  for (const m of valid) {
    bounds.add(m.start)
    bounds.add(m.end)
  }
  const points = [...bounds].sort((a, b) => a - b)
  const sorted = [...valid].sort((a, b) => a.start - b.start)
  const segments: Segment[] = []
  let active: Mark[] = []
  let next = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (b <= a) continue
    active = active.filter((m) => m.end > a)
    while (next < sorted.length && sorted[next].start <= a) {
      if (sorted[next].end > a) active.push(sorted[next])
      next++
    }
    segments.push({ start: a, end: b, text: text.slice(a, b), marks: [...active] })
  }
  return segments
}

/** Selaimen valinnan sijainti tekstin merkkeinä (valinnan reunojen välilyönnit karsittuna). */
export function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let s = Math.max(0, Math.min(start, end))
  let e = Math.min(text.length, Math.max(start, end))
  while (s < e && /\s/.test(text[s])) s++
  while (e > s && /\s/.test(text[e - 1])) e--
  return e > s ? { start: s, end: e } : null
}
