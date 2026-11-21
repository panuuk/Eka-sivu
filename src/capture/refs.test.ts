import { beforeEach, describe, expect, it } from 'vitest'
import { createNode, createProject } from '../model/factory'
import { useDeterministicIds } from '../model/ids'
import { applyOperations } from '../model/operations'
import { validateProject } from '../model/validate'
import { joinPdfItems } from './importers'
import {
  opsAddRef,
  opsRemoveRef,
  opsUpdateSourceText,
  reanchorRef,
  refIsStale,
  refsOfSource,
} from './refs'

beforeEach(() => useDeterministicIds(true))

function setup(text = 'Alku. Lasku tarkistetaan. Loppu.') {
  let p = createProject()
  const n = createNode(p.rootProcessId, { label: 'Tarkista' })
  const quote = 'Lasku tarkistetaan.'
  const start = text.indexOf(quote)
  p = applyOperations(p, [
    { type: 'addSource', source: { id: 's1', title: 'Muistio', kind: 'note', text, addedAt: 1 } },
    { type: 'addNode', node: n },
    {
      type: 'updateNode',
      id: n.id,
      patch: { sources: [{ sourceId: 's1', start, end: start + quote.length, quote }] },
    },
  ])
  return { p, nodeId: n.id, quote }
}

describe('lähdeviitteet', () => {
  it('tunnistaa vanhentuneen viitteen', () => {
    const { p, nodeId } = setup()
    const ref = p.nodes[nodeId].sources[0]
    expect(refIsStale(p.sources.s1, ref)).toBe(false)
    expect(refIsStale({ ...p.sources.s1, text: 'Muuta tekstiä' }, ref)).toBe(true)
  })

  it('siirtää viitteen uuteen paikkaan, kun tekstiä lisätään sen eteen', () => {
    const { p, nodeId } = setup()
    const newText = 'Uusi johdanto tähän. ' + p.sources.s1.text
    const p2 = applyOperations(p, opsUpdateSourceText(p, 's1', newText))
    const ref = p2.nodes[nodeId].sources[0]
    expect(newText.slice(ref.start, ref.end)).toBe('Lasku tarkistetaan.')
    expect(refIsStale(p2.sources.s1, ref)).toBe(false)
    expect(validateProject(p2)).toEqual([])
  })

  it('valitsee useasta osumasta alkuperäistä sijaintia lähimmän', () => {
    const ref = { sourceId: 's', start: 100, end: 105, quote: 'abcde' }
    const text = 'abcde' + ' '.repeat(100) + 'abcde' + ' '.repeat(100) + 'abcde'
    expect(reanchorRef(text, ref)?.start).toBe(105)
  })

  it('jättää viitteen vanhentuneeksi, jos lainausta ei enää löydy', () => {
    const { p, nodeId } = setup()
    const p2 = applyOperations(p, opsUpdateSourceText(p, 's1', 'Täysin eri teksti.'))
    expect(refIsStale(p2.sources.s1, p2.nodes[nodeId].sources[0])).toBe(true)
    expect(refsOfSource(p2, 's1')[0].stale).toBe(true)
    expect(reanchorRef('x', { sourceId: 's', start: 0, end: 0, quote: '' })).toBeNull()
  })

  it('refsOfSource järjestää sijainnin mukaan', () => {
    const { p, nodeId } = setup()
    const other = createNode(p.rootProcessId, { label: 'Muu' })
    const withNode = applyOperations(p, [{ type: 'addNode', node: other }])
    const p2 = applyOperations(
      withNode,
      opsAddRef(withNode, other.id, { sourceId: 's1', start: 0, end: 5, quote: 'Alku.' }),
    )
    const refs = refsOfSource(p2, 's1')
    expect(refs.map((r) => r.node.label)).toEqual(['Muu', 'Tarkista'])
    expect(nodeId).toBeDefined()
  })

  it('opsAddRef ei lisää samaa viitettä kahdesti, opsRemoveRef poistaa', () => {
    const { p, nodeId } = setup()
    const ref = p.nodes[nodeId].sources[0]
    expect(opsAddRef(p, nodeId, ref)).toEqual([])
    expect(opsAddRef(p, 'puuttuu', ref)).toEqual([])
    const p2 = applyOperations(p, opsRemoveRef(p, nodeId, ref))
    expect(p2.nodes[nodeId].sources).toEqual([])
    expect(opsRemoveRef(p2, nodeId, ref)).toEqual([])
  })
})

describe('joinPdfItems', () => {
  const item = (str: string, y: number, h = 12) => ({ str, transform: [h, 0, 0, h, 0, y] })

  it('yhdistää saman rivin palat välilyönnillä ja erottaa rivit ja kappaleet', () => {
    const text = joinPdfItems([
      item('Lasku', 700),
      item('saapuu', 700),
      item('ja tarkistetaan.', 686),
      item('Uusi kappale', 640),
    ])
    expect(text).toBe('Lasku saapuu\nja tarkistetaan.\n\nUusi kappale')
  })

  it('ohittaa tyhjät palat', () => {
    expect(joinPdfItems([item('', 700), item('a', 700)])).toBe('a')
  })
})

describe('joinPdfItems: rakenne', () => {
  const it2 = (str: string, x: number, y: number, h = 11, w = str.length * 5) => ({
    str,
    transform: [h, 0, 0, h, x, y],
    width: w,
  })

  it('suurempi lyhyt rivi on otsikko', () => {
    const text = joinPdfItems([
      it2('Vaiheet', 50, 700, 16),
      it2('Esimies tarkistaa laskun.', 50, 680),
      it2('Talous maksaa.', 50, 667),
    ])
    expect(text).toBe('## Vaiheet\n\nEsimies tarkistaa laskun.\nTalous maksaa.')
  })

  it('rivi, jossa on leveitä sarakevälejä, on taulukon rivi', () => {
    const row = (y: number, a: string, b: string, c: string) => [
      it2(a, 50, y),
      it2(' ', 90, y, 11, 60),
      it2(b, 150, y),
      it2(' ', 190, y, 11, 60),
      it2(c, 250, y),
    ]
    const text = joinPdfItems([
      ...row(600, 'Vaihe', 'Rooli', 'Järjestelmä'),
      ...row(587, 'Maksu', 'Talous', 'ERP'),
    ])
    expect(text).toBe('| Vaihe | Rooli | Järjestelmä |\n| Maksu | Talous | ERP |')
  })
})
