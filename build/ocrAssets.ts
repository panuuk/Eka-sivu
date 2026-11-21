import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Tekstintunnistuksen (OCR) tiedostot: tesseract.js:n työntekijä, WebAssembly-ydin ja suomen ja
 * englannin kielitiedot kopioidaan sovelluksen mukaan (`ocr/`), jotta tunnistus toimii ilman
 * ulkoisia palveluja eikä mitään lähde verkkoon. Tiedostot ladataan vasta, kun tunnistusta käytetään.
 */
const FILES: [url: string, from: string][] = [
  ['ocr/worker.min.js', 'node_modules/tesseract.js/dist/worker.min.js'],
  ['ocr/tesseract-core-lstm.wasm.js', 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'],
  [
    'ocr/tesseract-core-simd-lstm.wasm.js',
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  ],
  [
    'ocr/tesseract-core-relaxedsimd-lstm.wasm.js',
    'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  [
    'ocr/fin.traineddata.gz',
    'node_modules/@tesseract.js-data/fin/4.0.0_best_int/fin.traineddata.gz',
  ],
  [
    'ocr/eng.traineddata.gz',
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  ],
]

export const OCR_PREFIX = 'ocr/'

export function ocrAssetsPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'prosessikartta-ocr-assets',
    configResolved(c) {
      root = c.root
    },
    configureServer(server) {
      // Kehityspalvelin tarjoaa samat tiedostot samoilla poluilla
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '')
        const hit = FILES.find(([url]) => url === path)
        if (!hit) return next()
        const file = join(root, hit[1])
        if (!existsSync(file)) return next()
        res.setHeader(
          'Content-Type',
          hit[0].endsWith('.js') ? 'text/javascript' : 'application/gzip',
        )
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [fileName, from] of FILES) {
        const file = join(root, from)
        if (!existsSync(file)) {
          this.warn(`OCR-tiedostoa ei löydy: ${from}`)
          continue
        }
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
      }
    },
  }
}
