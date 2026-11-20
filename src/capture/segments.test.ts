import { describe, expect, it } from 'vitest'
import { buildSegments, trimRange, type Mark } from './segments'

describe('buildSegments', () => {
  const text = 'abcdefghij'

  it('palauttaa koko tekstin yhtenä osana ilman merkintöjä', () => {
    expect(buildSegments(text, [])).toEqual([{ start: 0, end: 10, text, marks: [] }])
    expect(buildSegments('', [])).toEqual([])
  })

  it('jakaa tekstin ja yhdistää limittäiset merkinnät', () => {
    const marks: Mark[] = [
      { start: 2, end: 6, type: 'ref' },
      { start: 4, end: 8, type: 'role' },
    ]
    const segs = buildSegments(text, marks)
    expect(segs.map((s) => [s.text, s.marks.map((m) => m.type)])).toEqual([
      ['ab', []],
      ['cd', ['ref']],
      ['ef', ['ref', 'role']],
      ['gh', ['role']],
      ['ij', []],
    ])
    // osat kattavat koko tekstin ilman aukkoja
    expect(segs.map((s) => s.text).join('')).toBe(text)
  })

  it('käsittelee sisäkkäiset, täsmälleen samat ja rajan ylittävät merkinnät', () => {
    const marks: Mark[] = [
      { start: 0, end: 10, type: 'suggestion' },
      { start: 3, end: 5, type: 'selection' },
      { start: 3, end: 5, type: 'focus' },
      { start: -5, end: 2, type: 'ref' },
      { start: 8, end: 99, type: 'role' },
      { start: 5, end: 5, type: 'system' },
    ]
    const segs = buildSegments(text, marks)
    expect(segs.map((s) => s.text).join('')).toBe(text)
    const mid = segs.find((s) => s.start === 3)!
    expect(mid.marks.map((m) => m.type).sort()).toEqual(['focus', 'selection', 'suggestion'])
    expect(segs[0].marks.map((m) => m.type).sort()).toEqual(['ref', 'suggestion'])
    expect(segs[segs.length - 1].marks.map((m) => m.type).sort()).toEqual(['role', 'suggestion'])
    // tyhjä merkintä ei luo osaa
    expect(segs.every((s) => s.end > s.start)).toBe(true)
  })

  it('toimii isolla määrällä merkintöjä', () => {
    const big = 'sana '.repeat(5000)
    const marks: Mark[] = Array.from({ length: 2000 }, (_, i) => ({
      start: i * 10,
      end: i * 10 + 7,
      type: 'suggestion' as const,
    }))
    const segs = buildSegments(big, marks)
    expect(segs.map((s) => s.text).join('')).toBe(big)
  })
})

describe('trimRange', () => {
  it('karsii välilyönnit ja hylkää tyhjän', () => {
    expect(trimRange('  abc  ', 0, 7)).toEqual({ start: 2, end: 5 })
    expect(trimRange('   ', 0, 3)).toBeNull()
    expect(trimRange('abc', 3, 1)).toEqual({ start: 1, end: 3 })
  })
})
