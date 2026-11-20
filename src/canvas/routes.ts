import type { Point } from '../model/types'

/** SVG-polku murtoviivasta, jonka kulmat pyöristetään säteellä `radius` (rajoitettuna segmenttien pituuteen). */
export function roundedPath(points: Point[], radius = 10): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const lenIn = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, lenIn / 2, lenOut / 2)
    if (r < 0.5) {
      d += ` L ${cur.x} ${cur.y}`
      continue
    }
    const ax = cur.x + ((prev.x - cur.x) / lenIn) * r
    const ay = cur.y + ((prev.y - cur.y) / lenIn) * r
    const bx = cur.x + ((next.x - cur.x) / lenOut) * r
    const by = cur.y + ((next.y - cur.y) / lenOut) * r
    d += ` L ${ax} ${ay} Q ${cur.x} ${cur.y} ${bx} ${by}`
  }
  const last = points[points.length - 1]
  return `${d} L ${last.x} ${last.y}`
}

/**
 * Reunan nimikkeen paikka. Haarautuvilla reiteillä alkuosa on yhteinen, joten nimike sijoitetaan
 * toiseen segmenttiin (jos sellainen on), jolloin eri haarojen nimikkeet eivät mene päällekkäin.
 */
export function labelPoint(points: Point[]): Point {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 }
  const segIndex = points.length >= 4 ? 1 : 0
  const a = points[segIndex]
  const b = points[segIndex + 1]
  if (points.length >= 4) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  // Suora tai yhden mutkan reitti: lähelle lähtöä, jotta nimike erottuu haarauksessa.
  const first = points[0]
  const second = points[1]
  const len = Math.hypot(second.x - first.x, second.y - first.y) || 1
  const t = Math.min(0.5, 28 / len)
  return { x: first.x + (second.x - first.x) * t, y: first.y + (second.y - first.y) * t }
}
