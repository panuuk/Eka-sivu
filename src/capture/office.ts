/**
 * PowerPoint- ja sähköpostitiedostojen tekstin poiminta. Ei ulkoisia palveluja: .pptx luetaan
 * JSZipillä (zip + XML) ja .eml jäsennetään itse (RFC 5322 / MIME).
 */

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return entities[e.toLowerCase()] ?? m
  })
}

/** Dian tai muistiinpanosivun XML:stä kappaleet (`a:p`), joissa tekstit ovat `a:t`-elementeissä. */
export function paragraphsOfSlideXml(xml: string): string[] {
  const out: string[] = []
  for (const p of xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? []) {
    let line = ''
    // tekstipalat, rivinvaihdot (a:br) ja tabulaattorit järjestyksessä
    for (const m of p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/?>/g)) {
      line += m[1] !== undefined ? decodeXmlEntities(m[1]) : '\n'
    }
    line = line.trim()
    if (line) out.push(line)
  }
  return out
}

const slideNo = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0)

/** PowerPoint (.pptx) tekstiksi: jokaisesta diasta otsikko “Dia n”, sen tekstit ja puhujan muistiinpanot. */
export async function pptxToText(data: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const names = Object.keys(zip.files)
  const slides = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b))
  if (slides.length === 0) throw new Error('Tiedostosta ei löytynyt diaa')
  const out: string[] = []
  for (const name of slides) {
    const n = slideNo(name)
    const body = paragraphsOfSlideXml(await zip.files[name].async('string'))
    const notesName = `ppt/notesSlides/notesSlide${n}.xml`
    const notes = zip.files[notesName]
      ? paragraphsOfSlideXml(await zip.files[notesName].async('string')).filter(
          // Muistiinpanosivun dian numerokenttä on yksinään numero
          (l) => !/^\d+$/.test(l),
        )
      : []
    out.push(
      [`Dia ${n}`, ...body, ...(notes.length ? ['Muistiinpanot:', ...notes] : [])].join('\n'),
    )
  }
  return out.join('\n\n')
}

// --- Sähköposti (.eml) ---

function utf8OfBinary(s: string): string {
  return /[\u0080-\uffff]/.test(s) ? new TextDecoder('utf-8').decode(binaryString(s)) : s
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase().replace(/^"|"$/g, '') || 'utf-8').decode(
      bytes,
    )
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function binaryString(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const joined = s.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i]
    if (c === '=' && /^[0-9a-fA-F]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(joined.charCodeAt(i) & 0xff)
  }
  return Uint8Array.from(bytes)
}

function decodeBase64(s: string): Uint8Array {
  try {
    const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))
    return binaryString(bin)
  } catch {
    return new Uint8Array()
  }
}

/** RFC 2047 -koodatut otsikkoarvot: =?UTF-8?B?...?= ja =?ISO-8859-1?Q?...?= */
export function decodeMimeWords(s: string): string {
  return s
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
      (_m, charset: string, enc: string, text: string) => {
        const bytes =
          enc.toLowerCase() === 'b'
            ? decodeBase64(text)
            : decodeQuotedPrintable(text.replace(/_/g, ' '))
        return decodeBytes(bytes, charset)
      },
    )
}

interface MimePart {
  headers: Record<string, string>
  body: string
}

function splitHeadersBody(raw: string): MimePart {
  const m = /\r?\n\r?\n/.exec(raw)
  const head = m ? raw.slice(0, m.index) : raw
  const body = m ? raw.slice(m.index + m[0].length) : ''
  const headers: Record<string, string> = {}
  // Jatkorivit (alkavat välilyönnillä tai tabulaattorilla) kuuluvat edelliseen otsikkoon
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return { headers, body }
}

const param = (header: string | undefined, name: string): string | undefined =>
  new RegExp(`${name}="?([^";]+)"?`, 'i').exec(header ?? '')?.[1]

function stripHtml(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' '),
  )
}

/** Poimii viestin tekstiosan: text/plain ensisijaisesti, muuten text/html ilman merkintöjä. */
function bodyText(part: MimePart): string {
  const type = (part.headers['content-type'] ?? 'text/plain').toLowerCase()
  if (type.startsWith('multipart/')) {
    const boundary = param(part.headers['content-type'], 'boundary')
    if (!boundary) return ''
    const pieces = part.body
      .split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\r?\\n?`))
      .slice(1)
      .map(splitHeadersBody)
    const texts = pieces.map((p) => ({
      type: (p.headers['content-type'] ?? '').toLowerCase(),
      text: bodyText(p),
    }))
    const plain = texts.find((t) => t.type.startsWith('text/plain') && t.text.trim())
    const html = texts.find((t) => t.type.startsWith('text/html') && t.text.trim())
    const nested = texts.find((t) => t.type.startsWith('multipart/') && t.text.trim())
    return (plain ?? nested ?? html)?.text ?? ''
  }
  if (!type.startsWith('text/')) return ''
  const encoding = (part.headers['content-transfer-encoding'] ?? '7bit').toLowerCase()
  const charset = param(part.headers['content-type'], 'charset') ?? 'utf-8'
  const bytes =
    encoding === 'base64'
      ? decodeBase64(part.body)
      : encoding === 'quoted-printable'
        ? decodeQuotedPrintable(part.body)
        : binaryString(part.body)
  const text = decodeBytes(bytes, charset)
  return type.startsWith('text/html') ? stripHtml(text) : text
}

export interface ParsedEmail {
  subject: string
  text: string
}

/** Tavut merkkijonoksi (yksi merkki per tavu), jotta merkistö puretaan osakohtaisesti. */
export function bytesToBinaryString(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return out
}

/**
 * Sähköpostitiedosto (.eml) tekstiksi: otsikkotiedot ja viestin teksti. `raw` on tiedoston tavut
 * merkkijonona (`bytesToBinaryString`), koska eri osilla voi olla eri merkistö.
 */
export function emlToText(raw: string): ParsedEmail {
  const root = splitHeadersBody(raw)
  // Otsikoiden raakatavut ovat yleensä ASCII-merkkejä tai UTF-8:aa
  const h = (k: string) => decodeMimeWords(utf8OfBinary(root.headers[k] ?? ''))
  const subject = h('subject') || 'Sähköposti'
  const head = [
    h('from') && `Lähettäjä: ${h('from')}`,
    h('to') && `Vastaanottaja: ${h('to')}`,
    h('cc') && `Kopio: ${h('cc')}`,
    root.headers['date'] && `Päivä: ${root.headers['date']}`,
    `Aihe: ${subject}`,
  ].filter(Boolean)
  const body = bodyText(root).replace(/\r\n?/g, '\n').trim()
  return { subject, text: `${head.join('\n')}\n\n${body}`.trim() }
}
