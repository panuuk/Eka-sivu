import type { DurationRange } from './types'

/** Työpäivä on 8 tuntia ja viikko 5 työpäivää. Arviot ovat työaikaa, eivät kalenteriaikaa. */
const MIN_PER_HOUR = 60
export const MIN_PER_DAY = 8 * 60
export const MIN_PER_WEEK = 5 * MIN_PER_DAY
const MIN_PER_MONTH = 4 * MIN_PER_WEEK

const UNITS: [RegExp, number][] = [
  [/^(?:min|minuutti|minuuttia|minuutin)$/i, 1],
  [/^(?:h|t|tunti|tuntia|tunnin)$/i, MIN_PER_HOUR],
  [/^(?:pv|päivä|päivää|päivän|työpäivä|työpäivää)$/i, MIN_PER_DAY],
  [/^(?:vk|viikko|viikkoa|viikon|viikkoa)$/i, MIN_PER_WEEK],
  [/^(?:kk|kuukausi|kuukautta|kuukauden)$/i, MIN_PER_MONTH],
]

const NUMBER_WORDS: Record<string, number> = {
  yksi: 1,
  yhden: 1,
  kaksi: 2,
  kahden: 2,
  kolme: 3,
  kolmen: 3,
  neljä: 4,
  neljän: 4,
  viisi: 5,
  viiden: 5,
  kuusi: 6,
  kuuden: 6,
  seitsemän: 7,
  kahdeksan: 8,
  yhdeksän: 9,
  kymmenen: 10,
  puoli: 0.5,
  puolen: 0.5,
}

/** Yksikön sana ilman lukua: "viikko" = 1 viikko. */
const BARE_UNIT = /^(?:tunti|tunnin|päivä|päivän|viikko|viikon|kuukausi|kuukauden)$/i

function unitMinutes(word: string): number | undefined {
  for (const [re, m] of UNITS) if (re.test(word)) return m
  return undefined
}

function toNumber(s: string): number | undefined {
  const w = NUMBER_WORDS[s.toLowerCase()]
  if (w !== undefined) return w
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/**
 * Jäsentää kestoarvion: "2 pv", "30 min", "1,5 h", "1-3 pv" (väli), "1-2-5 pv" (väh.-tyyp.-enint.),
 * "kaksi päivää", "viikko". Palauttaa null, jos teksti ei ole kesto.
 */
export function parseDuration(input: string): DurationRange | null {
  const text = input.trim().replace(/\s+/g, ' ').replace(/[–—]/g, '-')
  if (!text) return null
  if (BARE_UNIT.test(text)) {
    const m = unitMinutes(text)
    return m ? { typical: m } : null
  }
  // "1-3 pv", "1-2-5 pv", "2 pv", "kaksi päivää", "puoli tuntia"
  const m = /^(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?){0,2}|\p{L}+)\s*([\p{L}]+)$/u.exec(text)
  if (!m) return null
  const unit = unitMinutes(m[2])
  if (unit === undefined) return null
  const nums = m[1].split('-').map((x) => toNumber(x.trim()))
  if (nums.some((n) => n === undefined || n < 0)) return null
  const v = (nums as number[]).map((n) => Math.round(n * unit))
  if (v.length === 1) return { typical: v[0] }
  if (v.length === 2) return v[0] <= v[1] ? { min: v[0], max: v[1] } : null
  return v[0] <= v[1] && v[1] <= v[2] ? { min: v[0], typical: v[1], max: v[2] } : null
}

const UNIT_LABELS: [minutes: number, label: string][] = [
  [MIN_PER_WEEK, 'vk'],
  [MIN_PER_DAY, 'pv'],
  [MIN_PER_HOUR, 'h'],
  [1, 'min'],
]

/** Suurin yksikkö, jossa kaikki arvot ovat vähintään yksi yksikköä ja esitettävissä yhdellä desimaalilla ilman pyöristysvirhettä. */
function bestUnit(vals: number[]): [number, string] {
  for (const [div, label] of UNIT_LABELS) {
    if (vals.every((v) => v >= div && Math.abs(Math.round((v / div) * 10) * (div / 10) - v) < 0.01))
      return [div, label]
  }
  return [1, 'min']
}

const fmtNum = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

/** Yksittäinen kesto luettavana: 90 -> "1,5 h", 480 -> "1 pv". Jäsennys palauttaa saman arvon. */
export function formatMinutes(min: number): string {
  const [div, label] = bestUnit([min])
  return `${fmtNum(min / div)} ${label}`
}

/** Summa tai arvio luettavaksi (pyöristäen): 1032,5 min -> "2,2 pv". Ei tarkoitettu jäsennettäväksi. */
export function formatTotal(min: number): string {
  const abs = Math.abs(min)
  const [div, label] =
    abs >= MIN_PER_WEEK
      ? [MIN_PER_WEEK, 'vk']
      : abs >= MIN_PER_DAY
        ? [MIN_PER_DAY, 'pv']
        : abs >= MIN_PER_HOUR
          ? [MIN_PER_HOUR, 'h']
          : [1, 'min']
  return `${fmtNum(min / div)} ${label}`
}

/** Väli luettavana, yksi yhteinen yksikkö: "1-3 pv", "2 pv", "1-2-5 pv", "15-60 min". */
export function formatRange(r: DurationRange | undefined): string {
  if (!r) return ''
  const vals = [r.min, r.typical, r.max].filter((v): v is number => v !== undefined)
  if (!vals.length) return ''
  const [div, label] = bestUnit(vals)
  return `${vals.map((v) => fmtNum(v / div)).join('-')} ${label}`
}

/** Arvion edustaja laskennassa: tyypillinen, muuten välin keskikohta, muuten ainoa annettu raja. */
export function typicalOf(r: DurationRange | undefined): number | undefined {
  if (!r) return undefined
  if (r.typical !== undefined) return r.typical
  if (r.min !== undefined && r.max !== undefined) return (r.min + r.max) / 2
  return r.min ?? r.max
}

export const minOf = (r: DurationRange | undefined) => r?.min ?? r?.typical ?? r?.max
export const maxOf = (r: DurationRange | undefined) => r?.max ?? r?.typical ?? r?.min

export function isEmptyRange(r: DurationRange | undefined): boolean {
  return !r || (r.min === undefined && r.typical === undefined && r.max === undefined)
}
