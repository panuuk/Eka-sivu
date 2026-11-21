import { describe, expect, it } from 'vitest'
import { discoverEntities } from '../discover'
import { createProject } from '../../model/factory'
import { ruleExtractor } from '../suggest'
import { CORPUS } from './corpus'
import { evaluateExtractor, ruleRunner } from './metrics'

describe('sääntömoottorin arviointi koko aineistolla', () => {
  it('tulostaa mittarit dokumenteittain', async () => {
    const s = await evaluateExtractor(CORPUS, ruleRunner(ruleExtractor))
    for (const d of s.docs) {
      console.log(
        `${d.id.padEnd(12)} ehd ${String(d.suggestions).padStart(3)} odotettu ${String(d.gold).padStart(2)} R ${(d.recall * 100).toFixed(0).padStart(3)} % P ${(d.precision * 100).toFixed(0).padStart(3)} % F1 ${(d.f1 * 100).toFixed(0).padStart(3)} %  puuttuu: ${d.missed.join(' | ')}`,
      )
    }
    console.log(
      `KESKIARVO R ${(s.recall * 100).toFixed(1)} % P ${(s.precision * 100).toFixed(1)} % F1 ${(s.f1 * 100).toFixed(1)} %`,
    )
    expect(s.docs).toHaveLength(CORPUS.length)
  })

  it('roolien löytyminen tekstistä', () => {
    let any = 0
    let likely = 0
    let total = 0
    let candidates = 0
    const missing: string[] = []
    for (const doc of CORPUS) {
      const found = discoverEntities(createProject(), doc.text).filter((c) => c.kind === 'role')
      candidates += found.length
      const match = (list: typeof found, r: string) =>
        list.some((c) => {
          const n = c.name.toLocaleLowerCase('fi')
          return n === r || n.startsWith(r) || r.startsWith(n)
        })
      for (const r of doc.roles) {
        total++
        if (match(found, r)) any++
        else missing.push(`${doc.id}:${r}`)
        if (
          match(
            found.filter((c) => c.likely),
            r,
          )
        )
          likely++
      }
    }
    console.log(
      `Roolit: löytyi ${any}/${total}, valittuna oletuksena ${likely}/${total}, ehdokkaita ${candidates}, puuttuu: ${missing.join(', ')}`,
    )
    expect(any / total).toBeGreaterThanOrEqual(0.8)
    expect(candidates / CORPUS.length).toBeLessThan(14) // ehdokaslista pysyy luettavana
  })
})
