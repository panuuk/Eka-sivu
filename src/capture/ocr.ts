/**
 * Tekstintunnistus (OCR) selaimessa: tesseract.js ajetaan työntekijässä, ja sen ydin sekä suomen ja
 * englannin kielitiedot tulevat sovelluksen mukana (`ocr/`). Mitään ei lähetetä verkkoon.
 */

export interface OcrProgress {
  /** Käsiteltävä sivu (1-pohjainen) ja kaikkien tunnistettavien sivujen määrä. */
  page: number
  pages: number
  status: string
  /** Koko työn edistyminen 0..1. */
  fraction: number
}

interface OcrOptions {
  /** Kielet tesseract-koodeina. Oletus: suomi ja englanti. */
  languages?: string[]
  onProgress?: (p: OcrProgress) => void
  signal?: AbortSignal
}

const OCR_LANGUAGES = ['fin', 'eng']

/** Hyphenaation ja rivinvaihtojen siivous: "hyväk-\nsyy" -> "hyväksyy", kappaleet säilyvät. */
function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/([a-zäöå])-\n([a-zäöå])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function ocrBaseUrl(): string {
  return new URL('ocr/', document.baseURI).href
}

type Recognizable = HTMLCanvasElement | Blob

/**
 * Tunnistaa tekstin annetuista kuvista (canvas, Blob). Työntekijä luodaan kerran ja suljetaan lopuksi
 * tai peruutettaessa.
 */
export async function recognizeImages(
  images: (() => Promise<Recognizable>)[],
  opts: OcrOptions = {},
): Promise<string[]> {
  const { createWorker } = await import('tesseract.js')
  const base = ocrBaseUrl()
  const total = images.length
  let page = 0
  const emit = (status: string, within: number) =>
    opts.onProgress?.({
      page: Math.min(page + 1, total),
      pages: total,
      status,
      fraction: Math.min(1, (page + within) / total),
    })
  emit('Ladataan tekstintunnistusta', 0)
  const worker = await createWorker(opts.languages ?? OCR_LANGUAGES, 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    // Palvelutyöntekijä tallentaa tiedostot välimuistiin, joten tesseractin oma välimuisti ei tarvita
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') emit('Tunnistetaan tekstiä', m.progress)
    },
  })
  const abort = () => void worker.terminate()
  opts.signal?.addEventListener('abort', abort)
  try {
    const out: string[] = []
    for (const load of images) {
      if (opts.signal?.aborted) throw new DOMException('Peruttu', 'AbortError')
      emit('Valmistellaan sivua', 0)
      const img = await load()
      const res = await worker.recognize(img)
      out.push(cleanOcrText(res.data.text))
      page++
      emit('Sivu valmis', 0)
    }
    return out
  } finally {
    opts.signal?.removeEventListener('abort', abort)
    await worker.terminate().catch(() => undefined)
  }
}
