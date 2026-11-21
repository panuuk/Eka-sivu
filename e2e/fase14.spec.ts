import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

async function loadSample(page: Page) {
  await page.getByRole('button', { name: /Projektit/ }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
}

/** Lataa tiedoston Lataa-painikkeella ja tallentaa sen väliaikaiseen hakemistoon. */
async function downloadFile(page: Page): Promise<{ path: string; name: string }> {
  const dl = page.waitForEvent('download')
  await page.getByTestId('export-run').click()
  const d = await dl
  const dir = mkdtempSync(join(tmpdir(), 'pk-'))
  const path = join(dir, d.suggestedFilename())
  copyFileSync((await d.path())!, path)
  return { path, name: d.suggestedFilename() }
}

function inspectPptx(path: string) {
  const out = execFileSync('python3', ['e2e/fixtures/check_pptx.py', path], { encoding: 'utf8' })
  return JSON.parse(out) as {
    count: number
    width: number
    height: number
    slides: {
      pictures: number
      pic_sizes: [number, number][]
      texts: string[]
      tables: string[][][]
      notes: string
    }[]
  }
}

test('PowerPoint-vienti: kaaviot kuvina, taulukot ja puhujan muistiinpanot', async ({ page }) => {
  await loadSample(page)
  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  const dialog = page.getByRole('dialog', { name: /Vie ja jaa/ })
  await dialog.getByRole('radio', { name: 'PowerPoint (.pptx)' }).click()
  await expect(dialog.getByTestId('deck-options')).toBeVisible()
  // Esikatselu luettelee diat
  await expect(dialog.getByTestId('export-preview')).toContainText('diaa')
  await expect(dialog.getByTestId('export-preview')).toContainText('Prosessin mittarit')

  const file = await downloadFile(page)
  expect(file.name).toBe('ostolaskun-kasittely.pptx')
  if (process.env.KEEP_PPTX) copyFileSync(file.path, process.env.KEEP_PPTX)
  const info = inspectPptx(file.path)

  // 16:9
  expect(info.width / info.height).toBeCloseTo(16 / 9, 2)
  // otsikko, yleiskuva, alaprosessi, mittarit, kipupisteet
  expect(info.count).toBeGreaterThanOrEqual(5)
  expect(info.slides[0].texts.join(' ')).toContain('Ostolaskun käsittely')
  const diagrams = info.slides.filter((s) => s.pictures > 0)
  expect(diagrams.length).toBeGreaterThanOrEqual(2)
  // Kuva ei ylitä dian rajoja
  for (const s of diagrams)
    for (const [w, h] of s.pic_sizes) {
      expect(w).toBeLessThanOrEqual(info.width)
      expect(h).toBeLessThanOrEqual(info.height)
    }
  // Puhujan muistiinpanoissa vaiheiden tiedot
  expect(diagrams[0].notes).toContain('Tarkista laskun tiedot')
  expect(diagrams[0].notes).toContain('Rooli: Ostoreskontra')
  // Mittaritaulukko ja kipupisteet
  const tables = info.slides.flatMap((s) => s.tables)
  expect(tables.length).toBeGreaterThanOrEqual(2)
  const flat = JSON.stringify(tables)
  expect(flat).toContain('Läpimenoaika')
  expect(flat).toContain('Laskulta puuttuu usein tilausnumero')
})

async function openSavedViews(page: Page) {
  await page.getByRole('button', { name: /Projektit/ }).click()
  await page.getByRole('menuitem', { name: 'Näkymät ja skenaariot…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Näkymät ja skenaariot' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Esimerkkiprojektissa on päätös "Tiedot kunnossa?" (Kyllä/Ei): tee skenaario Ei-haaran kautta. */
async function createScenario(page: Page, name: string, branch: string) {
  const dialog = await openSavedViews(page)
  await dialog.getByTestId('scenario-new').click()
  const editor = dialog.getByTestId('scenario-editor')
  await editor.getByLabel('Nimi', { exact: true }).fill(name)
  await editor.getByLabel('Haara: Tiedot kunnossa?').selectOption({ label: branch })
  await expect(editor).toContainText('vaihetta')
  await dialog.getByTestId('scenario-save').click()
  await expect(dialog.getByTestId('scenario-row')).toContainText(name)
  return dialog
}

test('skenaario: luonti, tallennettu näkymä ja esitys kulkee valittua polkua', async ({ page }) => {
  await loadSample(page)
  const dialog = await createScenario(page, 'Tiedot virheelliset', 'Ei')

  // Tallenna näkymä, joka korostaa skenaarion
  await dialog.getByLabel('Nimi', { exact: true }).first().fill('Virhepolku')
  await dialog.getByLabel('Korostettava skenaario').selectOption({ label: 'Tiedot virheelliset' })
  await dialog.getByTestId('view-save').click()
  await expect(dialog.getByTestId('view-row')).toContainText('Virhepolku')
  await expect(dialog.getByTestId('view-row')).toContainText('skenaario Tiedot virheelliset')

  // Esitä: polku korostuu ja numeroituu, läpikäynti etenee vain polun vaiheissa
  await dialog.getByTestId('view-row').getByRole('button', { name: 'Esitä' }).click()
  await expect(page.getByTestId('present')).toBeVisible()
  const svg = page.getByTestId('present-svg')
  await expect(svg.locator('g[data-order]').first()).toBeVisible()
  const ordered = await svg.locator('g[data-order]').count()
  const allNodes = await svg.locator('g[data-id]').count()
  expect(ordered).toBeGreaterThan(2)
  expect(ordered).toBeLessThan(allNodes)

  await page.getByTestId('walk-toggle').click()
  const card = page.getByTestId('present-card')
  const seen: string[] = []
  for (let i = 0; i < 8; i++) {
    seen.push(await card.innerText())
    await page.keyboard.press('ArrowRight')
  }
  // Polku kulkee Ei-haaran kautta: korjauspyyntö on mukana, Kyllä-haaran hyväksyntäkierto ei
  expect(seen.join('|')).toContain('Pyydä korjaus toimittajalta')
  expect(seen.join('|')).not.toContain('Hyväksyntäkierto')
})

test('näkymän rajaus valittuihin vaiheisiin ja näkymien järjestys', async ({ page }) => {
  await loadSample(page)
  await page.locator('.react-flow__node', { hasText: 'Tarkista laskun tiedot' }).click()
  const dialog = await openSavedViews(page)
  await dialog.getByLabel('Nimi', { exact: true }).first().fill('Tarkistus lähikuvassa')
  await dialog.getByLabel(/Rajaa valittuihin vaiheisiin/).check()
  await dialog.getByTestId('view-save').click()
  await dialog.getByLabel('Nimi', { exact: true }).first().fill('Toinen')
  await dialog.getByTestId('view-save').click()
  await expect(dialog.getByTestId('view-row')).toHaveCount(2)
  await expect(dialog.getByTestId('view-row').first()).toContainText('rajaus 1 vaihetta')

  await dialog.getByRole('button', { name: 'Siirrä ylös: Toinen' }).click()
  await expect(dialog.getByTestId('view-row').first()).toContainText('Toinen')

  // Esitys käyttää rajausta: kuvassa on vain lähiympäristö
  await dialog
    .getByTestId('view-row')
    .filter({ hasText: 'Tarkistus lähikuvassa' })
    .getByRole('button', { name: 'Esitä' })
    .click()
  await expect(page.getByTestId('present-svg').locator('g[data-id]').first()).toBeVisible()
  const viewBox = await page.getByTestId('present-svg').locator('svg').getAttribute('viewBox')
  expect(viewBox).toBeTruthy()
  // Näkymävalitsin esityksessä
  await expect(page.getByLabel('Näkymä', { exact: true })).toBeVisible()
})

test('PowerPoint: tallennetut näkymät ja skenaariot omina diaoinaan sekä läpikäyntidiat', async ({
  page,
}) => {
  await loadSample(page)
  const dialog = await createScenario(page, 'Virhepolku', 'Ei')
  await dialog.getByLabel('Nimi', { exact: true }).first().fill('Virhepolku-näkymä')
  await dialog.getByLabel('Korostettava skenaario').selectOption({ label: 'Virhepolku' })
  await dialog.getByTestId('view-save').click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  const exp = page.getByRole('dialog', { name: /Vie ja jaa/ })
  await exp.getByRole('radio', { name: 'PowerPoint (.pptx)' }).click()
  await exp.getByLabel('Vaihe vaiheelta -läpikäynti').check()
  await expect(exp.getByTestId('export-preview')).toContainText('Virhepolku-näkymä')
  const file = await downloadFile(page)
  if (process.env.KEEP_PPTX2) copyFileSync(file.path, process.env.KEEP_PPTX2)
  const info = inspectPptx(file.path)
  const titles = info.slides.flatMap((s) => s.texts)
  expect(titles).toContain('Virhepolku-näkymä')
  // Skenaarionäkymä on kuvadia, jonka muistiinpanoissa polun vaiheet järjestyksessä
  const idx = info.slides.findIndex((s) => s.texts.includes('Virhepolku-näkymä'))
  expect(info.slides[idx].pictures).toBe(1)
  expect(info.slides[idx].notes).toMatch(/Skenaario: Virhepolku/)
  expect(info.slides[idx].notes).toContain('Pyydä korjaus toimittajalta')
  expect(info.slides[idx].notes).not.toContain('Kirjaa ja vie maksuun')
  // Läpikäyntidiat: yksi per vaihe sivupaneelilla
  const walk = info.slides.filter((s) => s.texts.some((t) => t.startsWith('Rooli: ')))
  expect(walk.length).toBeGreaterThanOrEqual(3)
  expect(info.count).toBeGreaterThan(8)
})

test('interaktiivinen HTML: haku himmentää, napsautus näyttää tiedot ja alaprosessiin pääsee', async ({
  page,
  browser,
}) => {
  await loadSample(page)
  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  const exp = page.getByRole('dialog', { name: /Vie ja jaa/ })
  await exp.getByRole('radio', { name: 'HTML-tiedosto' }).click()
  const file = await downloadFile(page)
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(file.path, 'utf8')

  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } })
  const doc = await ctx.newPage()
  const errors: string[] = []
  doc.on('pageerror', (e) => errors.push(e.message))
  await doc.setContent(html)

  // Haku himmentää muut vaiheet ja piilottaa rivit
  await doc.getByLabel('Hae vaiheita').fill('ERP')
  await expect(doc.locator('#pk-count')).toContainText('osumaa')
  const dimmed = await doc
    .locator('svg g[data-id]')
    .evaluateAll((els) => els.filter((e) => (e as SVGElement).style.opacity === '0.18').length)
  expect(dimmed).toBeGreaterThan(0)
  await doc.getByLabel('Hae vaiheita').fill('')

  // Napsautus avaa tietopaneelin
  await doc
    .locator('svg g[data-kind="step"]', { hasText: 'Tarkista laskun tiedot' })
    .first()
    .click()
  await expect(doc.locator('#pk-panel')).toBeVisible()
  await expect(doc.locator('#pk-details')).toContainText('Ostoreskontra')
  await expect(doc.locator('#pk-details')).toContainText('Laskulta puuttuu usein tilausnumero')

  // Alaprosessi: tietopaneelin painike vie osioon ja takaisin-painike palauttaa
  await doc.locator('svg g[data-kind="subprocess"]').first().click()
  await expect(doc.locator('#pk-open')).toBeVisible()
  await doc.locator('#pk-open').click()
  await expect(doc.locator('#pk-back')).toBeVisible()
  expect(errors).toEqual([])
  await ctx.close()
})

test('PDF: suuri kaavio jaetaan usealle A4-sivulle', async ({ page }) => {
  await loadSample(page)
  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  const exp = page.getByRole('dialog', { name: /Vie ja jaa/ })
  await exp.getByRole('radio', { name: 'PDF (kaavio)' }).click()
  await expect(exp.getByTestId('print-options')).toBeVisible()
  await exp.getByLabel('Sivukoko').selectOption('A4')
  await exp.getByLabel('Mittakaava').selectOption('actual')
  await exp.getByLabel('Suunta').selectOption('landscape')
  await expect(exp.getByTestId('tile-estimate')).toContainText('sivua')

  await page.evaluate(() => {
    const original = document.body.appendChild.bind(document.body)
    document.body.appendChild = ((node: Node) => {
      const r = original(node)
      if (node instanceof HTMLIFrameElement) {
        node.addEventListener('load', () => {
          const w = node.contentWindow!
          w.print = () => {
            ;(window as unknown as { __tiles: string }).__tiles =
              w.document.documentElement.outerHTML
          }
        })
      }
      return r
    }) as typeof document.body.appendChild
  })
  await exp.getByTestId('export-run').click()
  await page.waitForFunction(() => (window as unknown as { __tiles?: string }).__tiles)
  const html = await page.evaluate(() => (window as unknown as { __tiles: string }).__tiles)
  expect(html).toContain('@page{size:A4 landscape')
  const tiles = (html.match(/class="tile"/g) ?? []).length
  expect(tiles).toBeGreaterThan(1)
  expect(html).toContain(`Sivu ${tiles}/${tiles}`)
})
