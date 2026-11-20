import { normalizeText } from './text'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_TEXT_CHARS = 2_000_000

export interface ImportedDocument {
  title: string
  text: string
  fileName: string
}

export class FileImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileImportError'
  }
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')
const extOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase()

export const SUPPORTED_EXTENSIONS = ['txt', 'md', 'markdown', 'docx', 'pdf']

/** Lukee tiedoston tekstiksi. Raskaat kirjastot (docx, pdf) ladataan vasta tarvittaessa. */
export async function importFile(file: File): Promise<ImportedDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new FileImportError(
      `Tiedosto on liian suuri (${Math.round(file.size / 1024 / 1024)} Mt, enintään ${MAX_FILE_BYTES / 1024 / 1024} Mt)`,
    )
  }
  const ext = extOf(file.name)
  let text: string
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    text = await file.text()
  } else if (ext === 'docx') {
    text = await readDocx(await file.arrayBuffer())
  } else if (ext === 'pdf') {
    text = await readPdf(await file.arrayBuffer())
  } else {
    throw new FileImportError(
      `Tiedostotyyppiä ".${ext || '?'}" ei tueta. Tuetut: ${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(', ')}`,
    )
  }
  text = normalizeText(text)
  if (!text)
    throw new FileImportError(
      'Tiedostosta ei löytynyt tekstiä (kuvapohjaiselle PDF:lle tarvittaisiin tekstintunnistus)',
    )
  if (text.length > MAX_TEXT_CHARS) {
    throw new FileImportError(
      `Teksti on liian pitkä (${text.length.toLocaleString('fi-FI')} merkkiä, enintään ${MAX_TEXT_CHARS.toLocaleString('fi-FI')})`,
    )
  }
  return { title: baseName(file.name), text, fileName: file.name }
}

async function readDocx(data: ArrayBuffer): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const api = (mammoth as unknown as { default?: typeof mammoth }).default ?? mammoth
    const res = await api.extractRawText({ arrayBuffer: data })
    return res.value
  } catch (e) {
    throw new FileImportError(`Word-tiedoston lukeminen epäonnistui: ${(e as Error).message}`)
  }
}

interface PdfItem {
  str: string
  transform: number[]
  hasEOL?: boolean
}

/** Yhdistää PDF-sivun tekstinpalat riveiksi ja kappaleiksi sijainnin perusteella. */
export function joinPdfItems(items: PdfItem[]): string {
  let out = ''
  let lastY: number | undefined
  let lastH = 10
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue
    const y = it.transform[5]
    const h = Math.abs(it.transform[3]) || lastH
    if (lastY !== undefined) {
      const dy = Math.abs(lastY - y)
      if (dy > h * 1.9) out += '\n\n'
      else if (dy > h * 0.5) out += '\n'
      else if (it.str && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' '
    }
    out += it.str
    lastY = y
    lastH = h
  }
  return out
}

async function readPdf(data: ArrayBuffer): Promise<string> {
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
    await task.destroy()
    return pages.join('\n\n')
  } catch (e) {
    throw new FileImportError(`PDF-tiedoston lukeminen epäonnistui: ${(e as Error).message}`)
  }
}
