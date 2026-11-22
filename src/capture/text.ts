/** Tekstin perusrutiinit lähdetekstien käsittelyyn. Kaikki sijainnit ovat merkkipaikkoja alkuperäisessä tekstissä. */

export interface Span {
  start: number
  end: number
  /** Alkuperäinen teksti välilyönteineen. */
  text: string
  /** Rivi oli luettelomerkillä alkava kohta. */
  listItem: boolean
}

const LIST_PREFIX = /^(\s*)(?:[-*•–·]|\d{1,3}[.)])\s+/

/** Yhtenäistää rivinvaihdot ja poistaa ohjausmerkit, mutta säilyttää rivirakenteen. */
export function normalizeText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      // Wordin ja PDF:n luettelomerkkien erikoismerkit (Symbol-fontin ) tavalliseksi luetteloviivaksi
      .replace(
        /^([ \t]*)[\uF0B7\uF0A7\uF0D8\uF076\uF02D\u25AA\u25CF\u25E6\u25A0\u2023\u2043][ \t]*/gm,
        '$1- ',
      )
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * Pilkkoo tekstin lauseiksi ja luettelokohdiksi. Luettelomerkillä alkava rivi on oma kohtansa,
 * muut rivit yhdistetään kappaleiksi ja pilkotaan lauseiksi. Lyhenteet ("esim.") ja päivämäärät
 * ("1.5.2024") eivät katkaise lausetta, koska katkaisu vaatii isoa alkukirjainta tai numeroa.
 */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = []
  let para: { start: number; end: number }[] = []

  const flushParagraph = () => {
    if (!para.length) return
    const start = para[0].start
    const end = para[para.length - 1].end
    const region = text.slice(start, end)
    const re = /[.!?…]+["”')\]]*(?=\s+(?:[A-ZÅÄÖ"“(\d]|$)|$)/g
    let from = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(region))) {
      const stop = m.index + m[0].length
      pushSpan(spans, text, start + from, start + stop, false)
      from = stop
      if (m[0].length === 0) re.lastIndex++
    }
    if (from < region.length) pushSpan(spans, text, start + from, end, false)
    para = []
  }

  let offset = 0
  let prev = ''
  for (const line of text.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    if (!line.trim()) {
      flushParagraph()
      prev = ''
      continue
    }
    // Lyhyt, ilman päätemerkkiä oleva rivi isoon alkukirjaimeen alkavan rivin edellä on otsikko
    // (esim. "Vaiheet" ennen lausetta), joten se ei yhdisty seuraavaan riviin.
    if (
      para.length === 1 &&
      prev &&
      isHeadingLike(prev) &&
      /^\s*[A-ZÅÄÖ\d"“(]/.test(prev) &&
      /^\s*[A-ZÅÄÖ\d"“(]/.test(line) &&
      !LIST_PREFIX.test(prev)
    )
      flushParagraph()
    prev = line
    const m = LIST_PREFIX.exec(line)
    if (m) {
      flushParagraph()
      pushSpan(spans, text, lineStart + m[0].length, lineStart + line.length, true)
    } else {
      para.push({ start: lineStart, end: lineStart + line.length })
    }
  }
  flushParagraph()
  return spans
}

/** Otsikon näköinen rivi: enintään seitsemän sanaa eikä lauseen tai luettelon päätemerkkiä. */
function isHeadingLike(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 70) return false
  if (/[.!?…:;,-]$/.test(t)) return false
  return t.split(/\s+/).length <= 7
}

function pushSpan(spans: Span[], text: string, start: number, end: number, listItem: boolean) {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s])) s++
  while (e > s && /\s/.test(text[e - 1])) e--
  if (e - s < 2) return
  spans.push({ start: s, end: e, text: text.slice(s, e), listItem })
}

/** Tiivistää välilyönnit ja rivinvaihdot yhdeksi välilyönniksi. */
export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

export function capitalize(s: string): string {
  return s ? s[0].toLocaleUpperCase('fi') + s.slice(1) : s
}

/** Lyhentää tekstin sanarajalla. */
export function truncate(s: string, max = 90): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`
}
