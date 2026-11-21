import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import type { Plugin, ResolvedConfig } from 'vite'

/** Palvelutyöntekijän lähdekoodi. `__PRECACHE__` ja `__VERSION__` korvataan koontivaiheessa. */
const TEMPLATE = `/* Prosessikartta: offline-välimuisti. Tuotettu automaattisesti koonnissa. */
const VERSION = '__VERSION__'
const CACHE = 'prosessikartta-' + VERSION
const PRECACHE = __PRECACHE__
const scope = self.registration.scope
const INDEX = new URL('./index.html', scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 'reload' ohittaa HTTP-välimuistin, jotta koko versio on varmasti yhtenäinen.
      await Promise.all(
        PRECACHE.map(async (path) => {
          const res = await fetch(new Request(new URL(path, scope), { cache: 'reload' }))
          if (!res.ok) throw new Error('Esilataus epäonnistui: ' + path)
          await cache.put(new URL(path, scope), res)
        }),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('prosessikartta-') && key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

// Uusi versio odottaa, kunnes käyttäjä hyväksyy päivityksen. Näin kesken oleva työ ei katkea.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      if (req.mode === 'navigate') {
        const page = await cache.match(INDEX)
        if (page) return page
        try {
          return await fetch(req)
        } catch {
          return Response.error()
        }
      }
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true })
      if (hit) return hit
      try {
        return await fetch(req)
      } catch {
        return Response.error()
      }
    })(),
  )
})
`

/** Tuottaa koontiin `sw.js`:n, joka esilataa kaikki sovelluksen tiedostot. */
export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'prosessikartta-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c
    },
    generateBundle(_options, bundle) {
      // index.html lisätään erikseen: HTML-liitännäinen tuottaa sen vasta tämän jälkeen.
      const files = new Set<string>(['index.html'])
      for (const name of Object.keys(bundle)) {
        if (name.endsWith('.map') || name === 'sw.js') continue
        files.add(name)
      }
      // public-hakemiston tiedostot kopioidaan koontiin sellaisenaan
      for (const entry of readdirSync(config.publicDir, { withFileTypes: true })) {
        if (entry.isFile()) files.add(entry.name)
      }
      const list = [...files].sort()
      const version = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12)
      // Sisältö riippuu tiedostonimistä, jotka sisältävät sisältöhajautteen: sisältö vaihtuu
      // aina, kun jokin sovelluksen tiedosto vaihtuu.
      const hashes = Object.values(bundle)
        .map((o) => (o.type === 'chunk' ? o.code : String(o.source).length))
        .join('|')
      const full = createHash('sha256')
        .update(version + hashes)
        .digest('hex')
        .slice(0, 12)
      const source = TEMPLATE.replace('__VERSION__', full).replace(
        '__PRECACHE__',
        JSON.stringify(
          list.map((f) => (f === './' ? './' : `./${f}`)),
          null,
          2,
        ),
      )
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
