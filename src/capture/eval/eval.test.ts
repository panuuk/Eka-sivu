import { describe, expect, it } from 'vitest'
import { createProject } from '../../model/factory'
import { ruleExtractor } from '../suggest'
import { REKRYTOINTI_GOLD, REKRYTOINTI_TEKSTI } from './rekrytointi'

function evaluate() {
  const project = createProject()
  const sugg = ruleExtractor.suggest(project, 's1', REKRYTOINTI_TEKSTI)
  const hay = (s: (typeof sugg)[number]) => `${s.label} ${s.quote}`.toLowerCase()
  const found = REKRYTOINTI_GOLD.map((g) => ({
    g,
    hit: sugg.find((s) => g.keys.every((k) => hay(s).includes(k))),
  }))
  const hitSet = new Set(found.map((f) => f.hit).filter(Boolean))
  const unmatched = sugg.filter((x) => !hitSet.has(x))
  return { sugg, found, recall: hitSet.size / REKRYTOINTI_GOLD.length, hitSet, unmatched }
}

describe('ehdotusmoottorin arviointi (rekrytointi)', () => {
  it('tulostaa mittarit', () => {
    const { sugg, found, recall, unmatched } = evaluate()
    const missed = found.filter((f) => !f.hit).map((f) => f.g.name)
    console.log(
      `ehdotuksia ${sugg.length}, odotettuja ${REKRYTOINTI_GOLD.length}, löytyi ${found.filter((f) => f.hit).length}, recall ${(recall * 100).toFixed(0)} %`,
    )
    console.log('Puuttuu:', missed)
    console.log(
      'Ylimääräiset:',
      unmatched.map((u) => `${u.kind}:${u.label}`),
    )
    const precision = (sugg.length - unmatched.length) / sugg.length
    console.log(`precision ${(precision * 100).toFixed(0)} %`)
    expect(recall).toBeGreaterThanOrEqual(0.9)
    expect(precision).toBeGreaterThanOrEqual(0.85)
  })
})
