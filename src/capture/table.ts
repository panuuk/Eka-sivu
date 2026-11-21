import { parseDuration } from '../model/duration'

/**
 * Taulukkotuonti: CSV, TSV, leikepöydältä liitetty taulukko ja Excel (.xlsx). Taulukon sarakkeet
 * yhdistetään vaiheen kenttiin, ja rivit muunnetaan pikasyötteen tekstiksi, jolloin ne kulkevat
 * saman esikatselun ja suunnittelijan kautta kuin käsin kirjoitettu teksti.
 */

export type Table = string[][]

// --- CSV ---

/** Purkaa tavut tekstiksi: UTF-8, ja jos se ei kelpaa, Windows-1252 (suomalaisen Excelin CSV). */
export function decodeTextBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Arvaa erottimen otsikkorivin perusteella: tabulaattori, puolipiste tai pilkku (se, jota on eniten lainausten ulkopuolella). */
export function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5)
  let best = ','
  let bestCount = -1
  for (const d of ['\t', ';', ',']) {
    let count = 0
    for (const line of firstLines) {
      let inQuotes = false
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes
        else if (ch === d && !inQuotes) count++
      }
    }
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/** RFC 4180 -tyylinen jäsennin: lainausmerkit, kaksinkertaiset lainausmerkit ja rivinvaihdot kentissä. */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): Table {
  const rows: Table = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return trimTable(rows)
}

/** Poistaa tyhjät rivit ja tyhjät loppusarakkeet, ja siistii solujen välilyönnit. */
export function trimTable(rows: Table): Table {
  const cleaned = rows
    .map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()))
    .filter((r) => r.some((c) => c !== ''))
  const width = cleaned.reduce((w, r) => {
    let last = r.length
    while (last > 0 && r[last - 1] === '') last--
    return Math.max(w, last)
  }, 0)
  return cleaned.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
}

// --- Excel (.xlsx) ---

export interface Workbook {
  sheets: { name: string; rows: Table }[]
}

const xmlDecode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

/** Sarakekirjain -> indeksi: A=0, Z=25, AA=26. */
export function columnIndex(ref: string): number {
  let n = 0
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '')
    n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join('')

/** Excelin päivämääräsarjaluku -> ISO-päivä (1900-järjestelmä). */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(ms).toISOString().slice(0, 10)
}

/** Lukee .xlsx-työkirjan: jaetut merkkijonot, sisäkkäiset merkkijonot, luvut ja totuusarvot. */
export async function parseXlsx(data: ArrayBuffer): Promise<Workbook> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const read = async (name: string) => (zip.files[name] ? zip.files[name].async('string') : '')
  const workbook = await read('xl/workbook.xml')
  if (!workbook) throw new Error('Tiedosto ei ole Excel-työkirja (.xlsx)')
  const rels = await read('xl/_rels/workbook.xml.rels')
  const relTarget = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1]
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1]
    if (id && target) relTarget.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'))
  }
  const shared: string[] = []
  const ss = await read('xl/sharedStrings.xml')
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]))

  // Päivämäärätyylit: solun tyyli, jonka numeromuoto on päivämäärä
  const styles = await read('xl/styles.xml')
  const dateFmtIds = new Set<number>([14, 15, 16, 17, 22])
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    if (/[dmyh]/i.test(xmlDecode(m[2]).replace(/\[[^\]]*\]|"[^"]*"/g, '')))
      dateFmtIds.add(Number(m[1]))
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
  const xfIsDate = [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((m) =>
    dateFmtIds.has(Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? -1)),
  )

  const sheets: Workbook['sheets'] = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlDecode(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? 'Taulukko')
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1]
    const target = rid ? relTarget.get(rid) : undefined
    const xml = target ? await read(target) : ''
    if (!xml) continue
    const rows: Table = []
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowNo = Number(/\br="(\d+)"/.exec(rm[0])?.[1] ?? rows.length + 1)
      const cells: string[] = []
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1]
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1]
        if (!ref) continue
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
        const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1)
        const inner = cm[2] ?? ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        let value = ''
        if (type === 's') value = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') value = textOf(inner)
        else if (type === 'b') value = v === '1' ? 'tosi' : 'epätosi'
        else if (type === 'str' || type === 'e') value = xmlDecode(v ?? '')
        else if (v !== undefined) {
          const num = Number(v)
          value = xfIsDate[style] && Number.isFinite(num) ? excelDate(num) : xmlDecode(v)
        }
        cells[columnIndex(ref)] = value
      }
      // Tyhjät rivit säilytetään paikoillaan, jotta rivinumerot täsmäävät
      while (rows.length < rowNo - 1) rows.push([])
      rows.push(Array.from(cells, (c) => c ?? ''))
    }
    sheets.push({ name, rows: trimTable(rows.map((r) => r.map((c) => c ?? ''))) })
  }
  if (sheets.length === 0) throw new Error('Työkirjassa ei ole taulukoita')
  return { sheets }
}

// --- Sarakkeiden yhdistäminen ---

export type Field =
  | 'step'
  | 'type'
  | 'role'
  | 'systems'
  | 'inputs'
  | 'outputs'
  | 'duration'
  | 'waiting'
  | 'description'
  | 'confidence'
  | 'group'
  | 'next'

export const FIELD_LABELS: Record<Field, string> = {
  step: 'Vaihe',
  type: 'Tyyppi (vaihe/päätös)',
  role: 'Rooli',
  systems: 'Järjestelmät',
  inputs: 'Syötteet',
  outputs: 'Tuotokset',
  duration: 'Työaika',
  waiting: 'Odotusaika',
  description: 'Kuvaus',
  confidence: 'Varmuus',
  group: 'Alaprosessi (ryhmä)',
  next: 'Seuraava vaihe',
}

/** Otsikkosanat, joista kenttä tunnistetaan (suomi ja englanti). */
const SYNONYMS: Record<Field, RegExp> = {
  step: /^(vaihe|työvaihe|toimenpide|tehtävä|askel|aktiviteetti|toiminto|nimi|step|task|activity|action|name)$/i,
  type: /^(tyyppi|laji|type|kind)$/i,
  role: /^(rooli|vastuu|vastuuhenkilö|vastuutaho|tekijä|toteuttaja|osasto|tiimi|role|owner|responsible|actor|team|department)$/i,
  systems:
    /^(järjestelmä|järjestelmät|sovellus|työkalu|ohjelma|system|systems|tool|tools|application|app)$/i,
  inputs: /^(syöte|syötteet|tulo|tulot|input|inputs)$/i,
  outputs: /^(tuotos|tuotokset|tulos|lopputulos|output|outputs|deliverable)$/i,
  duration: /^(kesto|työaika|aika|käsittelyaika|duration|effort|time)$/i,
  waiting: /^(odotus|odotusaika|jonotus|viive|waiting|wait|delay|lead time)$/i,
  description:
    /^(kuvaus|selite|lisätiedot|huomiot|kommentti|muistiinpano|description|notes?|comment)$/i,
  confidence: /^(varmuus|luotettavuus|vahvistus|tila|confidence|status)$/i,
  group:
    /^(alaprosessi|prosessi|vaihe ?ryhmä|ryhmä|osaprosessi|vaihe-?alue|subprocess|process|group|phase)$/i,
  next: /^(seuraava|seuraava vaihe|jatko|siirtyy|seuraavat|next|next step|successor)$/i,
}

export type Mapping = Partial<Record<Field, number>>

/** Tunnistaa sarakkeet otsikkorivin perusteella. Kukin sarake yhdistetään enintään yhteen kenttään. */
export function detectMapping(header: string[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<number>()
  for (const field of Object.keys(SYNONYMS) as Field[]) {
    const i = header.findIndex((h, idx) => !used.has(idx) && SYNONYMS[field].test(h.trim()))
    if (i >= 0) {
      mapping[field] = i
      used.add(i)
    }
  }
  return mapping
}

/** Onko ensimmäinen rivi otsikko? Kyllä, jos siitä tunnistuu vähintään kaksi kenttää tai vaihe-sarake. */
export function looksLikeHeader(first: string[]): boolean {
  const m = detectMapping(first)
  return m.step !== undefined || Object.keys(m).length >= 2
}

// --- Taulukosta pikasyötteen tekstiksi ---

const splitList = (s: string) =>
  s
    .split(/[,;/\n]| ja /i)
    .map((x) => x.trim())
    .filter(Boolean)

const CONFIDENCE_WORDS: Record<string, string> = {
  arvaus: 'arvaus',
  oletus: 'arvaus',
  epävarma: 'arvaus',
  guess: 'arvaus',
  vahvistettu: 'vahvistettu',
  varma: 'vahvistettu',
  confirmed: 'vahvistettu',
  ok: 'vahvistettu',
}

const roleToken = (name: string) =>
  /[\s@[\]<>~,;"()]/.test(name) ? `@(${name.replace(/[()]/g, '')})` : `@${name}`

/** Merkintätekstistä poistetaan DSL:n erottimet, jotta solun sisältö ei tulkitse itseään merkinnäksi. */
const plain = (s: string) =>
  s
    .replace(/[[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-*•–+?>#]+\s*/, '')
    .replace(/(^|\s)[@~<>=^%#!]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

export interface TableDslResult {
  text: string
  /** Muunnettujen vaiheiden määrä. */
  steps: number
  warnings: string[]
}

/** Muuntaa taulukon rivit pikasyötteen tekstiksi. Rivin järjestys on prosessin kulku. */
export function tableToDsl(rows: Table, mapping: Mapping): TableDslResult {
  const warnings: string[] = []
  const col = (r: string[], f: Field) =>
    mapping[f] !== undefined ? (r[mapping[f]!] ?? '').trim() : ''
  const lines: string[] = []
  const names = new Map<string, number>() // vaiheen nimi -> rivi (seuraava-viittauksia varten)
  const items = rows.filter((r) => col(r, 'step') !== '')
  items.forEach((r, i) => names.set(plain(col(r, 'step')).toLocaleLowerCase('fi'), i))

  let group: string | undefined
  let steps = 0
  items.forEach((r, i) => {
    const rowNo = rows.indexOf(r) + 1
    const g = col(r, 'group')
    const indent = g ? '  ' : ''
    if (g !== (group ?? '')) {
      // Ryhmä vaihtuu: uusi alaprosessi tai paluu päätasolle
      group = g || undefined
      if (g) lines.push(`+ ${plain(g)}`)
    }
    const label = plain(col(r, 'step'))
    if (!label) return
    const isDecision = /^(päätös|decision|gateway|ehto|haara)/i.test(col(r, 'type'))
    const parts: string[] = []
    const role = plain(col(r, 'role'))
    if (role) parts.push(roleToken(role))
    const systems = splitList(col(r, 'systems')).map(plain).filter(Boolean)
    if (systems.length) parts.push(`[${systems.join(', ')}]`)
    if (!isDecision) {
      const ins = splitList(col(r, 'inputs')).map(plain).filter(Boolean)
      if (ins.length) parts.push(`< ${ins.join(', ')}`)
      const outs = splitList(col(r, 'outputs')).map(plain).filter(Boolean)
      if (outs.length) parts.push(`> ${outs.join(', ')}`)
    }
    for (const [field, mark] of [
      ['duration', '='],
      ['waiting', '^'],
    ] as const) {
      const raw = col(r, field)
      if (!raw) continue
      const norm = raw.replace(/,/g, '.').replace(/(\d)\s*([a-zäö]+)/i, '$1 $2')
      if (parseDuration(norm) || parseDuration(raw))
        parts.push(`${mark}${norm.replace(/\./g, ',')}`)
      else warnings.push(`Rivi ${rowNo}: “${raw}” ei ole kesto (esim. “2 pv”, “30 min”)`)
    }
    const conf = CONFIDENCE_WORDS[col(r, 'confidence').toLocaleLowerCase('fi')]
    if (conf) parts.push(`~${conf}`)
    const annotations = parts.length ? ` ${parts.join(' ')}` : ''
    const next = col(r, 'next')
    if (isDecision) {
      lines.push(`${indent}? ${label.replace(/\?*$/, '')}${annotations}`)
      // Seuraava-sarake: "Kyllä: Vaihe A; Ei: Vaihe B"
      const branches = next
        .split(/[;\n]/)
        .map((b) => b.trim())
        .filter(Boolean)
      for (const b of branches) {
        const m = /^([^:]{1,30}):\s*(.+)$/.exec(b)
        if (m) lines.push(`${indent}  ${plain(m[1])}: -> ${plain(m[2])}`)
        else lines.push(`${indent}  ${plain(b)}: jatka`)
      }
      if (!branches.length)
        warnings.push(`Rivi ${rowNo}: päätöksellä “${label}” ei ole haaroja (Seuraava-sarake)`)
    } else {
      lines.push(`${indent}- ${label}${annotations}`)
      const desc = col(r, 'description')
      if (desc) lines.push(`${indent}  ${plain(desc)}`)
      // Seuraava poikkeaa peräkkäisestä: hyppy nimettyyn vaiheeseen ja uusi ketju
      if (next) {
        const target = plain(next.split(/[;,]/)[0])
        const t = names.get(target.toLocaleLowerCase('fi'))
        if (t === undefined)
          warnings.push(`Rivi ${rowNo}: seuraavaa vaihetta “${target}” ei löydy taulukosta`)
        else if (t !== i + 1) {
          lines.push(`${indent}-> ${target}`)
          lines.push('---')
        }
      }
    }
    steps++
  })
  if (mapping.step === undefined) warnings.push('Valitse sarake, jossa vaiheen nimi on')
  return { text: lines.join('\n'), steps, warnings }
}
