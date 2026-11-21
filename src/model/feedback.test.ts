import { beforeEach, describe, expect, it } from 'vitest'
import { FeedbackError, feedbackOps, parseFeedback } from './feedback'
import { useDeterministicIds } from './ids'
import { applyOperations } from './operations'
import { buildSampleProject } from './sample'

beforeEach(() => useDeterministicIds(true))

const p = buildSampleProject()
const node = Object.values(p.nodes).find((n) => n.label === 'Tarkista laskun tiedot')!

const file = (items: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    app: 'prosessikartta-palaute',
    version: 1,
    projectId: p.id,
    projectName: p.name,
    reviewer: 'Liisa',
    createdAt: 1000,
    items,
    ...extra,
  })

describe('parseFeedback', () => {
  it('hyväksyy kelvollisen palautteen ja siivoaa kohteet', () => {
    const fb = parseFeedback(
      file([
        {
          id: 'c0',
          type: 'comment',
          nodeId: node.id,
          nodeLabel: node.label,
          text: '  Liian hidas  ',
        },
        { id: 'x', type: 'tuntematon', text: 'pois' },
        { id: 'tyhjä', type: 'comment', text: '   ' },
        { id: 'a1', type: 'answer', questionKey: 'k', questionText: 'Kuka?', text: 'Esimies' },
      ]),
    )
    expect(fb.items.map((i) => [i.id, i.text])).toEqual([
      ['c0', 'Liian hidas'],
      ['a1', 'Esimies'],
    ])
    expect(fb.reviewer).toBe('Liisa')
  })

  it('hylkää väärän tiedoston ja rajaa kohteiden määrän', () => {
    expect(() => parseFeedback('ei json')).toThrow(FeedbackError)
    expect(() => parseFeedback(JSON.stringify({ app: 'muu', items: [] }))).toThrow(
      /palautetiedosto/,
    )
    expect(() =>
      parseFeedback(JSON.stringify({ app: 'prosessikartta-palaute', items: [] })),
    ).toThrow(/tunniste/)
    const many = Array.from({ length: 800 }, (_, i) => ({
      id: `c${i}`,
      type: 'comment',
      text: 'x',
    }))
    expect(parseFeedback(file(many)).items).toHaveLength(500)
  })
})

describe('feedbackOps', () => {
  const fb = parseFeedback(
    file([
      { id: 'c0', type: 'comment', nodeId: node.id, nodeLabel: node.label, text: 'Liian hidas' },
      {
        id: 'a1',
        type: 'answer',
        questionKey: 'k',
        questionText: 'Kuka hyväksyy?',
        text: 'Esimies',
      },
      {
        id: 'c2',
        type: 'comment',
        nodeId: 'poistettu',
        nodeLabel: 'Vanha vaihe',
        text: 'Entä tämä?',
      },
    ]),
  )

  it('hyväksytyistä riveistä tulee avoimia omia kysymyksiä oikeaan vaiheeseen', () => {
    const ops = feedbackOps(p, fb, new Set(['c0', 'a1', 'c2']))
    const after = applyOperations(p, ops)
    const qs = Object.values(after.questions).filter((q) => q.key.startsWith('fb:'))
    expect(qs).toHaveLength(3)
    const c0 = qs.find((q) => q.text.includes('Liian hidas'))!
    expect(c0.targetId).toBe(node.id)
    expect(c0.processId).toBe(node.processId)
    expect(c0.status).toBe('open')
    expect(c0.text).toContain('Liisa')
    expect(qs.find((q) => q.text.includes('Vastaus (Liisa): Esimies'))!.text).toContain(
      'Kuka hyväksyy?',
    )
    // Poistettuun vaiheeseen viittaava kommentti säilyy ilman kohdetta
    const c2 = qs.find((q) => q.text.includes('Entä tämä?'))!
    expect(c2.targetId).toBeUndefined()
    expect(c2.text).toContain('Vanha vaihe')
  })

  it('vain hyväksytyt otetaan, ja uudelleentuonti ei tee kaksoiskappaleita', () => {
    const once = applyOperations(p, feedbackOps(p, fb, new Set(['c0'])))
    expect(Object.values(once.questions).filter((q) => q.key.startsWith('fb:'))).toHaveLength(1)
    expect(feedbackOps(once, fb, new Set(['c0']))).toEqual([])
    const more = applyOperations(once, feedbackOps(once, fb, new Set(['c0', 'a1'])))
    expect(Object.values(more.questions).filter((q) => q.key.startsWith('fb:'))).toHaveLength(2)
  })
})
