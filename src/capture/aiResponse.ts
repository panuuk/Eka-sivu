/**
 * Tekoälyn vastauksen siivous. Chatbotit lisäävät vastaukseen johdannon ("Tässä muotoiltu prosessi:"),
 * koodilohkon merkit, lihavointeja ja loppuselityksen. Siivous poimii niistä pikasyötteen tekstin.
 */

/** Pikasyötteen rivi: luettelomerkki, päätös, alaprosessi, hyppy, otsikko, kommentti, erotin, alku/loppu tai haara. */
const DSL_LINE =
  /^\s*(?:[-*+•–]\s|\d{1,3}[.)]\s|\?\s|\+\s|->|→|#{1,6}\s|:\p{L}+\s|\/\/|-{3,}\s*$|alku\b|loppu\b|(?:kyllä|ei|[^\s:]{1,24}):\s)/iu

const FENCE_LANGS = new Set(['', 'text', 'txt', 'plaintext', 'markdown', 'md', 'dsl', 'pikasyote'])

const isDslLine = (l: string) => DSL_LINE.test(l)

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length)
  const min = indents.length ? Math.min(...indents) : 0
  return min > 0 ? lines.map((l) => l.slice(Math.min(min, /^ */.exec(l)![0].length))) : lines
}

export interface CleanedResponse {
  text: string
  changed: boolean
  /** Siivous poisti johdannon, loppuselityksen tai koodilohkon (ei vain lihavointeja). */
  structural: boolean
  /** Mitä siivottiin, käyttäjälle kerrottavaksi. */
  notes: string[]
}

export function cleanAiResponse(raw: string): CleanedResponse {
  const notes: string[] = []
  let lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/^\t+/, (t) => '  '.repeat(t.length)).replace(/[ \t]+$/, ''))

  // 1. Koodilohko: ensimmäinen tavallisen tekstin lohko (ei Mermaid-kaavio) tai pisin niistä
  const blocks: { lang: string; body: string[]; start: number; end: number }[] = []
  let open: { lang: string; start: number } | undefined
  lines.forEach((l, i) => {
    const m = /^\s*```\s*([\w-]*)\s*$/.exec(l)
    if (!m) return
    if (open) {
      blocks.push({ ...open, body: lines.slice(open.start + 1, i), end: i })
      open = undefined
    } else open = { lang: m[1].toLowerCase(), start: i }
  })
  const usable = blocks.filter(
    (b) => FENCE_LANGS.has(b.lang) && !/^\s*(?:flowchart|graph)\b/i.test(b.body.join('\n')),
  )
  if (usable.length) {
    const best = usable.reduce((a, b) => (b.body.length > a.body.length ? b : a))
    const outside = lines.length - best.body.length - 2
    if (outside > 0)
      notes.push('Koodilohkon ulkopuolinen teksti (johdanto tai selitys) poistettiin.')
    lines = dedent(best.body)
  } else {
    // 2. Ei koodilohkoa: poista johdantorivit alusta ja selityskappale lopusta
    const firstDsl = lines.findIndex(isDslLine)
    if (firstDsl > 0 && firstDsl <= 8 && lines.slice(0, firstDsl).every((l) => !/^\s/.test(l))) {
      const rest = lines.slice(firstDsl).filter((l) => l.trim())
      if (rest.filter(isDslLine).length >= Math.max(2, rest.length / 2)) {
        lines = lines.slice(firstDsl)
        notes.push('Johdantorivit poistettiin.')
      }
    }
    // Loppuselitys: viimeinen kappale, jonka ensimmäinen rivi ei ole pikasyötettä eikä sisennetty
    let end = lines.length
    while (end > 0 && !lines[end - 1].trim()) end--
    let start = end
    while (start > 0 && lines[start - 1].trim()) start--
    const para = lines.slice(start, end)
    if (
      start > 0 &&
      para.length &&
      !isDslLine(para[0]) &&
      !/^\s/.test(para[0]) &&
      !/^\|/.test(para[0])
    ) {
      lines = lines.slice(0, start)
      notes.push('Loppuselitys poistettiin.')
    }
  }

  // 3. Lihavoinnit ja koodimerkit pois (pikasyötteessä ei ole lihavointia)
  let text = lines
    .join('\n')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^(\s*)\*\s/gm, '$1- ')
    .trim()
  const structural = notes.length > 0
  const stripped = text !== lines.join('\n').trim()
  if (stripped) notes.push('Lihavoinnit ja tähtiluettelomerkit muutettiin tavalliseksi tekstiksi.')
  text = text.replace(/\n{3,}/g, '\n\n')
  return { text, changed: notes.length > 0, structural, notes }
}

/** Näyttääkö teksti tekoälyn vastaukselta, jonka siivoamisesta olisi hyötyä? */
export function looksLikeAiResponse(raw: string): boolean {
  if (raw.trim().length < 20) return false
  const r = cleanAiResponse(raw)
  if (!r.structural) return false
  // Siivottu tulos on pikasyötettä: vähintään kaksi tunnistettavaa riviä
  return r.text.split('\n').filter(isDslLine).length >= 2
}
