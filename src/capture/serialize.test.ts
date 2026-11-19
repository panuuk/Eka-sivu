import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { buildSampleProject } from '../model/sample'
import { edgesOf, nodesOf } from '../model/selectors'
import { validateProject } from '../model/validate'
import type { Project } from '../model/types'
import { planText } from './plan'
import { processToText } from './serialize'

beforeEach(() => useDeterministicIds(true))

/** Nimipohjainen sormenjälki: vertailukelpoinen vaikka tunnisteet eroavat. */
function signature(p: Project, processId: string): string[] {
  const nm = (id?: string) => (id ? p.entities[id]?.name : '')
  const lines: string[] = []
  for (const n of nodesOf(p, processId)) {
    lines.push(
      `N ${n.kind} ${n.label} | role=${nm(n.roleId)} | sys=${n.systemIds.map(nm).sort().join(',')} | in=${n.inputIds.map(nm).sort().join(',')} | out=${n.outputIds.map(nm).sort().join(',')} | ${n.confidence}`,
    )
    if (n.childProcessId)
      lines.push(...signature(p, n.childProcessId).map((l) => `  [${n.label}] ${l}`))
  }
  for (const e of edgesOf(p, processId)) {
    // Haaran nimi säilyy vain päätöksen jälkeen
    const from = p.nodes[e.from]
    lines.push(
      `E ${from.label} -${from.kind === 'decision' ? (e.label ?? '') : ''}-> ${p.nodes[e.to].label}`,
    )
  }
  return lines.sort()
}

function fromText(text: string): Project {
  const empty = createProject()
  return applyOperations(empty, planText(empty, text, { processId: empty.rootProcessId }).ops)
}

function roundTrip(p: Project): Project {
  return fromText(processToText(p, p.rootProcessId))
}

describe('processToText', () => {
  it('tuottaa luettavan tekstin päätöksestä ja yhtymäkohdasta', () => {
    const empty = createProject()
    const plan = planText(
      empty,
      '- Vastaanota @Myynti [CRM]\n? Raja ylittyy?\n  kyllä: Pyydä maksu\n  ei: jatka\n- Vahvista ~arvaus',
      { processId: empty.rootProcessId },
    )
    const p = applyOperations(empty, plan.ops)
    expect(processToText(p, p.rootProcessId)).toBe(
      [
        'alku',
        '- Vastaanota @Myynti [CRM]',
        '? Raja ylittyy?',
        '  kyllä:',
        '    - Pyydä maksu',
        '  ei: jatka',
        '- Vahvista ~arvaus',
        'loppu',
      ].join('\n'),
    )
  })

  it('lisää otsikon pyydettäessä', () => {
    const p = createProject('X', 'Ostot')
    expect(processToText(p, p.rootProcessId, { title: true })).toBe('# Ostot')
  })

  it('esimerkkiprojekti säilyy tekstikierrossa (silmukat, alaprosessi, haarat)', () => {
    const sample = buildSampleProject()
    const text = processToText(sample, sample.rootProcessId)
    const back = roundTrip(sample)
    expect(validateProject(back)).toEqual([])
    expect(signature(back, back.rootProcessId)).toEqual(signature(sample, sample.rootProcessId))
    expect(text).toContain('+ Hyväksyntäkierto')
    expect(text).toContain('-> ')
  })

  it('tekstikierto on stabiili: toinen vienti on sama kuin ensimmäinen', () => {
    const sample = buildSampleProject()
    const once = processToText(sample, sample.rootProcessId)
    const back = roundTrip(sample)
    expect(processToText(back, back.rootProcessId)).toBe(once)
  })

  it('vie irralliset ketjut erottimella eikä yhdistä niitä uudelleen tuotaessa', () => {
    const empty = createProject()
    const plan = planText(empty, '- A\n- B\n---\n- C\n- D', {
      processId: empty.rootProcessId,
      mode: 'standalone',
    })
    // Tyhjään prosessiin lisättäessä alku/loppu luodaan ketjun ympärille; erotin pitää C-D:n irrallaan
    const p = applyOperations(empty, plan.ops)
    const edges = edgesOf(p, p.rootProcessId).map(
      (e) => `${p.nodes[e.from].label}>${p.nodes[e.to].label}`,
    )
    expect(edges).not.toContain('B>C')
    const text = processToText(p, p.rootProcessId)
    expect(text).toContain('---')
    const back = fromText(text)
    expect(signature(back, back.rootProcessId)).toEqual(signature(p, p.rootProcessId))
  })

  it('käsittelee sisäkkäiset päätökset ja haarat, jotka eivät yhdy', () => {
    const src = [
      'alku',
      '- A',
      '? Q1',
      '  x:',
      '    ? Q2',
      '      a: Eka',
      '      b: loppu',
      '  y: Toka',
      'loppu',
    ].join('\n')
    const empty = createProject()
    const p = applyOperations(empty, planText(empty, src, { processId: empty.rootProcessId }).ops)
    expect(validateProject(p)).toEqual([])
    const back = roundTrip(p)
    expect(signature(back, back.rootProcessId)).toEqual(signature(p, p.rootProcessId))
  })

  it('monisanaiset nimet ja kuvaukset säilyvät', () => {
    const src =
      '- Vaihe @(Ostoreskontra tiimi) [ERP, Verkkolaskuoperaattori] < Ostolasku > Tarkistettu lasku ~vahvistettu\n  lisätieto yksi\n  lisätieto kaksi'
    const empty = createProject()
    const p = applyOperations(empty, planText(empty, src, { processId: empty.rootProcessId }).ops)
    const back = roundTrip(p)
    expect(signature(back, back.rootProcessId)).toEqual(signature(p, p.rootProcessId))
    const step = Object.values(back.nodes).find((n) => n.label === 'Vaihe')!
    expect(step.description).toBe('lisätieto yksi\nlisätieto kaksi')
  })
})
