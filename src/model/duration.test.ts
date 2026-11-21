import { describe, expect, it } from 'vitest'
import {
  formatMinutes,
  formatRange,
  formatTotal,
  MIN_PER_DAY,
  MIN_PER_WEEK,
  parseDuration,
  typicalOf,
} from './duration'

describe('parseDuration', () => {
  it.each([
    ['2 pv', { typical: 2 * MIN_PER_DAY }],
    ['2pv', { typical: 2 * MIN_PER_DAY }],
    ['30 min', { typical: 30 }],
    ['1,5 h', { typical: 90 }],
    ['kaksi päivää', { typical: 2 * MIN_PER_DAY }],
    ['puoli tuntia', { typical: 30 }],
    ['viikko', { typical: MIN_PER_WEEK }],
    ['1-3 pv', { min: MIN_PER_DAY, max: 3 * MIN_PER_DAY }],
    ['1–3 pv', { min: MIN_PER_DAY, max: 3 * MIN_PER_DAY }],
    ['1-2-5 pv', { min: MIN_PER_DAY, typical: 2 * MIN_PER_DAY, max: 5 * MIN_PER_DAY }],
    ['2 vk', { typical: 2 * MIN_PER_WEEK }],
  ])('%s', (text, expected) => {
    expect(parseDuration(text)).toEqual(expected)
  })

  it.each(['', 'pian', '3', '5 apinaa', '3-1 pv', '1-5-2 pv', '-2 pv', 'a-b pv'])(
    'hylkää %j',
    (text) => {
      expect(parseDuration(text)).toBeNull()
    },
  )
})

describe('muotoilu', () => {
  it('muotoilee yksittäisen keston sopivassa yksikössä', () => {
    expect(formatMinutes(30)).toBe('30 min')
    expect(formatMinutes(90)).toBe('1,5 h')
    expect(formatMinutes(MIN_PER_DAY)).toBe('1 pv')
    expect(formatMinutes(2.5 * MIN_PER_DAY)).toBe('2,5 pv')
    expect(formatMinutes(2 * MIN_PER_WEEK)).toBe('2 vk')
  })
  it('muotoilu ja jäsennys ovat toistensa käänteisiä', () => {
    for (const text of [
      '30 min',
      '1,5 h',
      '2 pv',
      '1-3 pv',
      '1-2-5 pv',
      '2 vk',
      '1-2 vk',
      '15-45 min',
    ]) {
      expect(formatRange(parseDuration(text)!)).toBe(text)
    }
  })
  it('tyypillinen arvo laskentaa varten', () => {
    expect(typicalOf({ typical: 5 })).toBe(5)
    expect(typicalOf({ min: 2, max: 6 })).toBe(4)
    expect(typicalOf({ max: 7 })).toBe(7)
    expect(typicalOf(undefined)).toBeUndefined()
  })
})

describe('muotoilun tarkkuus', () => {
  it('ei pyöristä arvoa vääräksi vaan valitsee pienemmän yksikön', () => {
    expect(formatRange({ min: 15, max: 60 })).toBe('15-60 min')
    expect(formatMinutes(500)).toBe('500 min')
    expect(formatMinutes(0)).toBe('0 min')
    for (const v of [1, 7, 15, 25, 45, 59, 61, 90, 500, 479, 481, 1000, 2399, 5000]) {
      expect(parseDuration(formatMinutes(v))).toEqual({ typical: v })
    }
  })
})

describe('formatTotal', () => {
  it('pyöristää summat luettavaan yksikköön', () => {
    expect(formatTotal(1032.5)).toBe('2,2 pv')
    expect(formatTotal(45)).toBe('45 min')
    expect(formatTotal(150)).toBe('2,5 h')
    expect(formatTotal(3 * MIN_PER_WEEK)).toBe('3 vk')
  })
})
