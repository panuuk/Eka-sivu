import { describe, expect, it } from 'vitest'
import { createEntity, createProject } from '../model/factory'
import { applyOperations } from '../model/operations'
import { discoverEntities } from './discover'
import { REKRYTOINTI_TEKSTI } from './eval/rekrytointi'

const names = (c: ReturnType<typeof discoverEntities>, kind: 'role' | 'system') =>
  c.filter((x) => x.kind === kind).map((x) => x.name)

describe('discoverEntities', () => {
  const p = createProject()

  it('löytää rekrytointikuvauksen roolit', () => {
    const roles = names(discoverEntities(p, REKRYTOINTI_TEKSTI), 'role')
    for (const r of [
      'Esimies',
      'HR-asiantuntija',
      'Talousjohtaja',
      'IT-tuki',
      'Palkka-asiantuntija',
    ])
      expect(roles, r).toContain(r)
  })

  it('löytää järjestelmät ja perusmuodot taivutuksista', () => {
    const systems = names(discoverEntities(p, REKRYTOINTI_TEKSTI), 'system')
    expect(systems).toContain('Rekrysysteemi')
    expect(systems).toContain('Palkanlaskentajärjestelmä')
    expect(systems).toContain('Sähköposti')
  })

  it('ei ehdota tunnettuja entiteettejä taivutettuinakaan', () => {
    const known = applyOperations(p, [
      { type: 'addEntity', entity: createEntity('role', 'Esimies') },
      { type: 'addEntity', entity: createEntity('system', 'Rekrysysteemi') },
    ])
    const c = discoverEntities(known, REKRYTOINTI_TEKSTI)
    expect(names(c, 'role')).not.toContain('Esimies')
    expect(names(c, 'system')).not.toContain('Rekrysysteemi')
    expect(names(c, 'role')).toContain('HR-asiantuntija')
  })

  it('passiivin ja ei-toimijoiden subjekteja ei ehdoteta rooleiksi', () => {
    const text =
      'Lasku lähetetään esimiehelle. Lasku kirjataan. Lasku saapuu ostoreskontraan. Lasku tarkistetaan. Lasku maksetaan.'
    const roles = names(discoverEntities(p, text), 'role')
    expect(roles).not.toContain('Lasku')
    expect(roles).toContain('Esimies')
  })

  it('yksittäinen subjekti ilman roolisanaa ei riitä, toistuva riittää', () => {
    const once = names(discoverEntities(p, 'Kassa tarkistaa maksun.'), 'role')
    expect(once).not.toContain('Kassa')
    const twice = names(
      discoverEntities(p, 'Kassa tarkistaa maksun. Kassa kuittaa maksun.'),
      'role',
    )
    expect(twice).toContain('Kassa')
  })

  it('ehdotettujen entiteettien lisäys antaa ehdotuksille roolit', async () => {
    const { ruleExtractor } = await import('./suggest')
    const cands = discoverEntities(p, REKRYTOINTI_TEKSTI)
    const withEntities = applyOperations(
      p,
      cands.map((c) => ({ type: 'addEntity' as const, entity: createEntity(c.kind, c.name) })),
    )
    const sugg = ruleExtractor.suggest(withEntities, 's', REKRYTOINTI_TEKSTI)
    const steps = sugg.filter((s) => s.kind === 'step')
    const withRole = steps.filter((s) => s.roleId).length
    expect(withRole / steps.length).toBeGreaterThan(0.7)
  })
})
