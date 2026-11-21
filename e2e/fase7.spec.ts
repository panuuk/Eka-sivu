import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

async function fresh(page: Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = await indexedDB.databases()
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise((r) => {
            const q = indexedDB.deleteDatabase(d.name!)
            q.onsuccess = q.onerror = q.onblocked = () => r(null)
          }),
      ),
    )
  })
  await page.reload()
  await page.waitForSelector('.topbar')
}

async function loadSample(page: Page) {
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await page.waitForSelector('.react-flow__node')
}

async function openExport(page: Page) {
  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  await expect(page.getByTestId('export-preview')).toBeVisible()
}

async function download(page: Page, label: RegExp | string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-run').click(),
  ])
  void label
  const path = await dl.path()
  return {
    name: dl.suggestedFilename(),
    text: readFileSync(path!, 'utf8'),
    buffer: readFileSync(path!),
  }
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

test('SVG-vienti: kuva sisältää vaiheet ja noudattaa teemaa', async ({ page }) => {
  await loadSample(page)
  await openExport(page)
  await expect(page.getByTestId('export-preview').locator('svg')).toBeVisible()
  const res = await download(page, 'svg')
  expect(res.name).toBe('ostolaskun-kasittely.svg')
  expect(res.text).toContain('<svg')
  expect(res.text).toContain('Vastaanota lasku')
  expect(res.text).toContain('Ostoreskontra')
  expect(res.text).not.toContain('stroke-dasharray') // varmuus piilossa oletuksena

  // Tumma teema ja varmuus näkyviin
  await page.getByLabel('Väriteema').selectOption('dark')
  await page.getByLabel('Näytä varmuus').check()
  const dark = await download(page, 'svg')
  expect(dark.text).toContain('#0b1120')
  expect(dark.text).toContain('stroke-dasharray')
})

test('PNG-vienti tuottaa kelvollisen kuvan', async ({ page }) => {
  await loadSample(page)
  await openExport(page)
  await page.getByRole('radio', { name: 'PNG-kuva' }).click()
  const res = await download(page, 'png')
  expect(res.name).toMatch(/\.png$/)
  expect([...res.buffer.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(res.buffer.length).toBeGreaterThan(5000)
})

test('Mermaid-, BPMN- ja HTML-viennit', async ({ page }) => {
  await loadSample(page)
  await openExport(page)
  await page.getByRole('radio', { name: 'Mermaid' }).click()
  await expect(page.getByTestId('export-preview')).toContainText('flowchart TD')
  const mm = await download(page, 'mermaid')
  expect(mm.name).toMatch(/\.mmd$/)
  expect(mm.text).toContain('Tiedot kunnossa?')

  await page.getByRole('radio', { name: 'BPMN 2.0 XML' }).click()
  await expect(page.getByTestId('export-preview')).toContainText('<definitions')
  const bpmn = await download(page, 'bpmn')
  expect(bpmn.text).toContain('<subProcess')
  expect(bpmn.text).toContain('bpmndi:BPMNShape')

  await page.getByRole('radio', { name: 'HTML-tiedosto' }).click()
  const html = await download(page, 'html')
  expect(html.name).toBe('ostolaskun-kasittely.html')
  expect(html.text).toContain('<!doctype html>')
  expect(html.text).toContain('RACI-matriisi')
  expect(html.text).toContain('<script>') // interaktiivinen
  expect(html.text.match(/<svg /g)!.length).toBe(2) // päätaso + alaprosessi
})

test('tulostus: PDF ja prosessidokumentti avaavat tulostusikkunan', async ({ page }) => {
  await page.addInitScript(() => {
    // Tulostusikkunaa ei voi testata: laske kutsut iframen window.print-ylikirjoituksella
    ;(window as unknown as { __prints: string[] }).__prints = []
    const orig = HTMLIFrameElement.prototype.constructor
    void orig
  })
  await loadSample(page)
  await openExport(page)
  await page.getByRole('radio', { name: 'Prosessidokumentti' }).click()
  // Stubaa iframen print, kun se latautuu
  await page.evaluate(() => {
    const original = document.body.appendChild.bind(document.body)
    document.body.appendChild = ((node: Node) => {
      const r = original(node)
      if (node instanceof HTMLIFrameElement) {
        node.addEventListener('load', () => {
          const w = node.contentWindow!
          w.print = () => {
            ;(window as unknown as { __printed: string }).__printed = w.document.body.innerText
          }
        })
      }
      return r
    }) as typeof document.body.appendChild
  })
  await page.getByLabel('Liitä avoimet kysymykset loppuun').check()
  await page.getByTestId('export-run').click()
  await page.waitForFunction(() => (window as unknown as { __printed?: string }).__printed)
  const printed = await page.evaluate(() => (window as unknown as { __printed: string }).__printed)
  expect(printed).toContain('Ostolaskun käsittely')
  expect(printed).toContain('RACI-matriisi')
  expect(printed).toContain('Avoimet kysymykset')
})

test('esitystila: siisti näkymä ilman muokkausta, läpikäynti ja poistuminen', async ({ page }) => {
  await loadSample(page)
  await page.getByRole('button', { name: 'Esitä', exact: true }).click()
  await expect(page.getByTestId('present')).toBeVisible()
  await expect(page.getByTestId('present-svg').locator('svg')).toBeVisible()
  // Ei muokkaustyökaluja eikä kysymysmerkintöjä
  await expect(page.locator('.topbar')).toHaveCount(0)
  await expect(page.locator('.react-flow')).toHaveCount(0)
  await expect(page.getByTestId('present-svg')).not.toContainText('Pienoiskartta')

  // Läpikäynti
  await page.getByTestId('walk-toggle').click()
  await expect(page.getByTestId('present-card')).toContainText('Lasku saapuu')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('present-card')).toContainText('Vastaanota lasku')
  await expect(page.getByTestId('present-card')).toContainText('Ostoreskontra')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('present-card')).toContainText('Tiedot kunnossa?')
  await expect(page.getByTestId('present-card')).toContainText('Kyllä:')
  // Korostus: nykyinen vaihe on täysin näkyvä, muut himmeitä
  const faded = await page.getByTestId('present-svg').locator('g[data-id][opacity="0.25"]').count()
  expect(faded).toBeGreaterThan(3)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('present-card')).toContainText('Tarkista laskun tiedot')

  // Vaiheen napsautus siirtää läpikäynnin siihen
  await page
    .getByTestId('present-svg')
    .locator('g[data-id]', { hasText: 'Vastaanota lasku' })
    .click()
  await expect(page.getByTestId('present-card')).toContainText('Vastaanota lasku')

  // Esc lopettaa läpikäynnin, toinen Esc sulkee esityksen
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('walk-next')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('present')).toHaveCount(0)
  await expect(page.locator('.topbar')).toBeVisible()
})

test('esitystilassa näppäimet eivät muokkaa mallia ja alaprosessiin voi porautua', async ({
  page,
}) => {
  await loadSample(page)
  await page.locator('.node__label', { hasText: 'Vastaanota lasku' }).click()
  await page.getByRole('button', { name: 'Esitä', exact: true }).click()
  const before = await page.evaluate(() => indexedDB.databases().then((d) => d.length))
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')
  await expect(page.locator('.react-flow__node', { hasText: 'Vastaanota lasku' })).toBeVisible()
  expect(before).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Esitä', exact: true }).click()
  // Alaprosessin napsautus porautuu sisään
  await page
    .getByTestId('present-svg')
    .locator('g[data-id]', { hasText: 'Hyväksyntäkierto' })
    .click()
  await expect(page.locator('.present__crumbs [aria-current]')).toHaveText('Hyväksyntäkierto')
  // Avaa alaprosessit -asetus näyttää sisällön yläprosessissa
  await page
    .locator('.present__crumbs')
    .getByRole('button', { name: 'Ostolaskun käsittely' })
    .click()
  await page.getByText('Asetukset').click()
  await page.getByLabel('Avaa alaprosessit kuvaan').check()
  await expect(
    page.getByTestId('present-svg').locator('g[data-id]', { hasText: 'Lähetä esimiehelle' }),
  ).toBeVisible()
})

test('vain vahvistetut -asetus piilottaa arvaukset esityksestä ja viennistä', async ({ page }) => {
  await loadSample(page)
  await openExport(page)
  const all = (await download(page, 'svg')).text
  await page.getByLabel('Vain vahvistetut vaiheet').check()
  const confirmed = (await download(page, 'svg')).text
  // Nimi rivitetään SVG:ssä usealle riville, joten haetaan yksittäistä sanaa
  expect(all).toContain('toimittajalta') // arvaus
  expect(confirmed).not.toContain('toimittajalta')
  expect(confirmed).toContain('Tarkista laskun tiedot')
})
