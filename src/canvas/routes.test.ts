import { describe, expect, it } from 'vitest'
import { labelPoint, roundedPath } from './routes'

describe('roundedPath', () => {
  it('suora viiva ei saa kaarteita', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ]),
    ).toBe('M 0 0 L 0 100')
  })
  it('pyöristää kulmat ja rajoittaa säteen lyhyisiin segmentteihin', () => {
    const d = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 40, y: 40 },
      ],
      10,
    )
    expect(d).toBe('M 0 0 L 0 30 Q 0 40 10 40 L 40 40')
    const tight = roundedPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 8 },
        { x: 40, y: 8 },
      ],
      10,
    )
    expect(tight).toContain('Q 0 8 4 8') // säde puolitettu: 8/2
  })
  it('käsittelee tyhjän ja yksittäisen pisteen', () => {
    expect(roundedPath([])).toBe('')
    expect(roundedPath([{ x: 1, y: 2 }])).toBe('M 1 2')
  })
})

describe('labelPoint', () => {
  it('käyttää toista segmenttiä mutkaisella reitillä', () => {
    const p = labelPoint([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 100, y: 20 },
      { x: 100, y: 60 },
    ])
    expect(p).toEqual({ x: 50, y: 20 })
  })
  it('sijoittaa suoran reitin nimikkeen lähelle lähtöä', () => {
    const p = labelPoint([
      { x: 0, y: 0 },
      { x: 0, y: 200 },
    ])
    expect(p.x).toBe(0)
    expect(p.y).toBeCloseTo(28, 6)
  })
})
