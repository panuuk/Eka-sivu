// Tuottaa PWA-kuvakkeet (PNG) SVG-lähteistä. Ajo: node scripts/make-icons.mjs
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'

const preinstalled = '/opt/pw-browsers/chromium'
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled, args: ['--no-sandbox'] } : {},
)
const jobs = [
  ['public/favicon.svg', 'public/icon-192.png', 192],
  ['public/favicon.svg', 'public/icon-512.png', 512],
  ['scripts/icon-maskable.svg', 'public/icon-maskable-512.png', 512],
  ['public/favicon.svg', 'public/apple-touch-icon.png', 180],
]
for (const [src, out, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  const svg = readFileSync(src, 'utf8')
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  await page.screenshot({ path: out, omitBackground: true })
  await page.close()
}
await browser.close()
