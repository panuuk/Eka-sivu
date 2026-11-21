import { normalizeText } from './text'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_TEXT_CHARS = 2_000_000

export interface ImportedDocument {
  title: string
  text: string
  fileName: string
}

export class FileImportError extends Error {
  /** `needs-ocr`: tiedostosta ei löytynyt tekstiä, mutta tekstintunnistus voisi auttaa. */
  code?: 'needs-ocr'
  constructor(message: string, code?: 'needs-ocr') {
    super(message)
    this.name = 'FileImportError'
    this.code = code
  }
}

export interface ImportOptions {
  /**
   * Kutsutaan, kun PDF:n sivuilta puuttuu teksti ja tunnistus olisi mahdollinen. Palauttaa true, jos
   * tunnistus tehdään. Ilman tätä tekstitöntä PDF:ää ei yritetä tunnistaa.
   */
  confirmOcr?: (info: { pages: number; total: number }) => Promise<boolean>
  onProgress?: (p: import('./ocr').OcrProgress) => void
  signal?: AbortSignal
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')
const extOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase()

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
export const SUPPORTED_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'docx',
  'pdf',
  'pptx',
  'eml',
  ...IMAGE_EXTENSIONS,
]

/** Lukee tiedoston tekstiksi. Raskaat kirjastot (docx, pdf) ladataan vasta tarvittaessa. */
export async function importFile(
  file: File,
  options: ImportOptions = {},
): Promise<ImportedDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new FileImportError(
      `Tiedosto on liian suuri (${Math.round(file.size / 1024 / 1024)} Mt, enintään ${MAX_FILE_BYTES / 1024 / 1024} Mt)`,
    )
  }
  const ext = extOf(file.name)
  let text: string
  let title = baseName(file.name)
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    text = await file.text()
  } else if (ext === 'docx') {
    text = await readDocx(await file.arrayBuffer())
  } else if (ext === 'pdf') {
    text = await readPdf(await file.arrayBuffer(), options)
  } else if (IMAGE_EXTENSIONS.includes(ext)) {
    // Kuva (skannattu paperi tai valokuva): vain tekstintunnistuksella
    const ok = options.confirmOcr ? await options.confirmOcr({ pages: 1, total: 1 }) : false
    if (!ok)
      throw new FileImportError(
        'Kuvasta voi lukea tekstin vain tekstintunnistuksella (OCR).',
        'needs-ocr',
      )
    const { recognizeImages } = await import('./ocr')
    text = (await recognizeImages([async () => file], options))[0] ?? ''
  } else if (ext === 'pptx') {
    try {
      text = (await (await import('./office')).pptxToText(await file.arrayBuffer())) ?? ''
    } catch (e) {
      throw new FileImportError(
        `PowerPoint-tiedoston lukeminen epäonnistui: ${(e as Error).message}`,
      )
    }
  } else if (ext === 'eml') {
    const office = await import('./office')
    const mail = office.emlToText(
      office.bytesToBinaryString(new Uint8Array(await file.arrayBuffer())),
    )
    text = mail.text
    title = mail.subject
  } else if (ext === 'msg' || ext === 'ppt' || ext === 'doc' || ext === 'xls') {
    throw new FileImportError(
      `Vanha Office-muoto “.${ext}” ei ole tuettu. Tallenna tiedosto uudempaan muotoon (.docx, .pptx, .xlsx) tai sähköposti .eml-muotoon.`,
    )
  } else {
    throw new FileImportError(
      `Tiedostotyyppiä ".${ext || '?'}" ei tueta. Tuetut: ${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(', ')}`,
    )
  }
  text = normalizeText(text)
  if (!text)
    throw new FileImportError(
      'Tiedostosta ei löytynyt tekstiä',
      ext === 'pdf' ? 'needs-ocr' : undefined,
    )
  if (text.length > MAX_TEXT_CHARS) {
    throw new FileImportError(
      `Teksti on liian pitkä (${text.length.toLocaleString('fi-FI')} merkkiä, enintään ${MAX_TEXT_CHARS.toLocaleString('fi-FI')})`,
    )
  }
  return { title, text, fileName: file.name }
}

async function readDocx(data: ArrayBuffer): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const api = (mammoth as unknown as { default?: typeof mammoth }).default ?? mammoth
    try {
      // HTML-muunnos säilyttää otsikot, luettelot ja taulukot, jotka raakateksti hävittäisi
      const { htmlToStructuredText } = await import('./office')
      const html = (await api.convertToHtml({ arrayBuffer: data })).value
      const text = htmlToStructuredText(html, (h) =>
        new DOMParser().parseFromString(h, 'text/html'),
      )
      if (text) return text
    } catch {
      // Jos rakenteen luku epäonnistuu, käytetään raakatekstiä
    }
    const res = await api.extractRawText({ arrayBuffer: data })
    return res.value
  } catch (e) {
    throw new FileImportError(`Word-tiedoston lukeminen epäonnistui: ${(e as Error).message}`)
  }
}

interface PdfItem {
  str: string
  transform: number[]
  width?: number
  hasEOL?: boolean
}

/**
 * Yhdistää PDF-sivun tekstinpalat riveiksi ja kappaleiksi sijainnin perusteella. Tavallista suurempi
 * lyhyt rivi on otsikko (`## `), ja rivi, jonka palojen välissä on useita leveitä välejä, on taulukon rivi
 * (`| a | b | c |`).
 */
export function joinPdfItems(items: PdfItem[]): string {
  interface Line {
    y: number
    h: number
    parts: { x: number; w?: number; str: string }[]
  }
  const lines: Line[] = []
  let lastH = 10
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue
    const y = it.transform[5]
    const h = Math.abs(it.transform[3]) || lastH
    lastH = h
    const cur = lines[lines.length - 1]
    if (cur && Math.abs(cur.y - y) <= Math.max(cur.h, h) * 0.5) {
      if (it.str) cur.parts.push({ x: it.transform[4], w: it.width, str: it.str })
      cur.h = Math.max(cur.h, h)
    } else {
      lines.push({
        y,
        h,
        parts: it.str ? [{ x: it.transform[4], w: it.width, str: it.str }] : [],
      })
    }
  }
  const heights = lines.map((l) => l.h).sort((a, b) => a - b)
  const body = heights[Math.floor(heights.length / 2)] ?? 10

  let out = ''
  let lastY: number | undefined
  let lastH2 = 10
  let lastWasHeading = false
  for (const line of lines) {
    let text = ''
    let gaps = 0
    let prevEnd: number | undefined
    let wideSpace = false
    for (const part of line.parts) {
      // PDF:n sarakevälit ovat usein yksi leveä välilyöntipala, ei tyhjää tilaa palojen välissä
      if (!part.str.trim()) {
        if (part.w !== undefined && part.w > line.h * 1.5) wideSpace = true
        prevEnd = part.w !== undefined ? part.x + part.w : undefined
        continue
      }
      if (text) {
        const wide = wideSpace || (prevEnd !== undefined && part.x - prevEnd > line.h * 1.5)
        if (wide) {
          text += '\t'
          gaps++
        } else if (!text.endsWith(' ') && !part.str.startsWith(' ')) text += ' '
      }
      wideSpace = false
      text += part.str
      prevEnd = part.w !== undefined ? part.x + part.w : undefined
    }
    text = text.replace(/[ ]*\t[ ]*/g, '\t')
    if (gaps >= 2) text = `| ${text.split('\t').join(' | ')} |`
    else text = text.replace(/\t/g, ' ')
    const heading =
      gaps < 2 && line.h > body * 1.2 && text.trim().length > 0 && text.trim().length <= 90
    if (heading) text = `## ${text.trim()}`
    if (lastY !== undefined) {
      const dy = Math.abs(lastY - line.y)
      if (dy > lastH2 * 1.9 || heading || lastWasHeading) out += '\n\n'
      else if (dy > line.h * 0.5) out += '\n'
      else if (text && !out.endsWith(' ') && !text.startsWith(' ')) out += ' '
    }
    out += text
    lastY = line.y
    lastH2 = line.h
    lastWasHeading = heading
  }
  return out
}

/** Sivu katsotaan tekstittömäksi (kuvapohjaiseksi), jos siinä on alle tämän verran kirjaimia. */
export const MIN_PAGE_CHARS = 25

async function readPdf(data: ArrayBuffer, options: ImportOptions = {}): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const task = pdfjs.getDocument({ data: new Uint8Array(data) })
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(joinPdfItems(content.items as unknown as PdfItem[]))
    }
    const blank = pages
      .map((t, i) => (t.replace(/\s/g, '').length < MIN_PAGE_CHARS ? i : -1))
      .filter((i) => i >= 0)
    if (
      blank.length > 0 &&
      options.confirmOcr &&
      (await options.confirmOcr({ pages: blank.length, total: pages.length }))
    ) {
      const { recognizeImages } = await import('./ocr')
      const images = blank.map((idx) => async () => {
        const page = await doc.getPage(idx + 1)
        const base = page.getViewport({ scale: 1 })
        // Noin 2400 px pitkä sivu antaa riittävän tarkkuuden tekstintunnistukselle
        const scale = Math.min(4, Math.max(1.5, 2400 / Math.max(base.width, base.height)))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, canvas, viewport }).promise
        return canvas
      })
      const recognized = await recognizeImages(images, options)
      blank.forEach((idx, k) => (pages[idx] = recognized[k] ?? ''))
    }
    await task.destroy()
    return pages.join('\n\n')
  } catch (e) {
    if (e instanceof FileImportError || (e as Error).name === 'AbortError') throw e
    throw new FileImportError(`PDF-tiedoston lukeminen epäonnistui: ${(e as Error).message}`)
  }
}
