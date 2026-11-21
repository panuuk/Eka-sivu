import type { Extractor, Suggestion } from '../suggest'
import { createProject } from '../../model/factory'
import type { EvalDoc } from './corpus'

export interface DocResult {
  id: string
  title: string
  suggestions: number
  gold: number
  matchedGold: number
  matchedSuggestions: number
  recall: number
  precision: number
  f1: number
  missed: string[]
  extra: string[]
}

export interface EvalSummary {
  docs: DocResult[]
  recall: number
  precision: number
  f1: number
  /** Kaikkien dokumenttien yhteenlasketut luvut (mikrokeskiarvo). */
  micro: { recall: number; precision: number; f1: number }
}

const hay = (s: Suggestion) => `${s.label} ${s.quote}`.toLowerCase()
const f1 = (p: number, r: number) => (p + r === 0 ? 0 : (2 * p * r) / (p + r))

/** Vertaa ehdotuksia odotettuihin vaiheisiin: odotettu löytyy, kun jokin ehdotus sisältää kaikki sen avaimet. */
export function scoreDoc(doc: EvalDoc, sugg: Suggestion[]): DocResult {
  const found = doc.gold.map((g) => ({
    g,
    hit: sugg.find((s) => g.keys.every((k) => hay(s).includes(k))),
  }))
  const hitSet = new Set(found.map((f) => f.hit).filter((x): x is Suggestion => !!x))
  const recall = doc.gold.length ? found.filter((f) => f.hit).length / doc.gold.length : 1
  const precision = sugg.length ? hitSet.size / sugg.length : 0
  return {
    id: doc.id,
    title: doc.title,
    suggestions: sugg.length,
    gold: doc.gold.length,
    matchedGold: found.filter((f) => f.hit).length,
    matchedSuggestions: hitSet.size,
    recall,
    precision,
    f1: f1(precision, recall),
    missed: found.filter((f) => !f.hit).map((f) => f.g.name),
    extra: sugg.filter((s) => !hitSet.has(s)).map((s) => `${s.kind}:${s.label}`),
  }
}

export function summarize(docs: DocResult[]): EvalSummary {
  const avg = (k: 'recall' | 'precision' | 'f1') =>
    docs.reduce((s, d) => s + d[k], 0) / Math.max(1, docs.length)
  const gold = docs.reduce((s, d) => s + d.gold, 0)
  const sugg = docs.reduce((s, d) => s + d.suggestions, 0)
  const mg = docs.reduce((s, d) => s + d.matchedGold, 0)
  const ms = docs.reduce((s, d) => s + d.matchedSuggestions, 0)
  const r = gold ? mg / gold : 0
  const p = sugg ? ms / sugg : 0
  return {
    docs,
    recall: avg('recall'),
    precision: avg('precision'),
    f1: avg('f1'),
    micro: { recall: r, precision: p, f1: f1(p, r) },
  }
}

/** Ajaa synkronisen tai asynkronisen poimijan koko aineistolla. */
export async function evaluateExtractor(
  corpus: EvalDoc[],
  run: (doc: EvalDoc) => Suggestion[] | Promise<Suggestion[]>,
  onDoc?: (done: number, total: number) => void,
): Promise<EvalSummary> {
  const docs: DocResult[] = []
  for (const doc of corpus) {
    docs.push(scoreDoc(doc, await run(doc)))
    onDoc?.(docs.length, corpus.length)
  }
  return summarize(docs)
}

export const ruleRunner = (extractor: Extractor) => (doc: EvalDoc) =>
  extractor.suggest(createProject(), doc.id, doc.text)
