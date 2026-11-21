import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'

/** Tiedostopolku ilman ääkkösiä: testin tulostekansion nimi sisältää niitä. */
const tmp = (name: string) => join(tmpdir(), `pk-sync-${process.pid}-${name}`)

async function open(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 820 },
    serviceWorkers: 'block',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    throw e
  })
  await page.goto('/')
  await page.waitForSelector('.topbar')
  return { ctx, page }
}

async function quickAdd(page: Page, text: string) {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(text)
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
}

async function exportJson(page: Page, path: string) {
  await page.getByRole('button', { name: 'Projektit' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Vie projekti (JSON)' }).click(),
  ])
  await download.saveAs(path)
}

test('kaksi laitetta: kummankin lisäykset yhdistyvät ja yhdistäminen on kumottavissa', async ({
  browser,
}) => {
  const phone = await open(browser)
  const laptop = await open(browser)
  const f1 = tmp('vaihe1.json')
  const f2 = tmp('vaihe2.json')

  // Puhelimella alkutila, joka siirretään kannettavalle
  await quickAdd(phone.page, '- Vastaanota lasku\n- Tarkista lasku')
  await exportJson(phone.page, f1)
  await laptop.page.getByTestId('import-input').setInputFiles(f1)
  await expect(
    laptop.page.locator('.react-flow__node').filter({ hasText: 'Tarkista lasku' }),
  ).toHaveCount(1)

  // Kumpikin muokkaa omaa kopiotaan
  await quickAdd(phone.page, '- Vastaanota lasku\n- Tarkista lasku\n- Puhelimen vaihe')
  await quickAdd(laptop.page, '- Vastaanota lasku\n- Tarkista lasku\n- Kannettavan vaihe')
  await exportJson(phone.page, f2)

  // Yhdistä puhelimen tiedosto kannettavalle
  await laptop.page.getByRole('button', { name: 'Projektit' }).click()
  await laptop.page.getByRole('menuitem', { name: 'Jaa ja yhdistä…' }).click()
  await laptop.page.getByTestId('sync-file').setInputFiles(f2)
  const plan = laptop.page.getByTestId('sync-plan')
  await expect(plan).toContainText(/\d+ uutta tietuetta tiedostosta/)
  await laptop.page.getByTestId('sync-apply').click()
  await expect(laptop.page.locator('dialog[open]')).toHaveCount(0)
  const nodes = laptop.page.locator('.react-flow__node')
  await expect(nodes.filter({ hasText: 'Puhelimen vaihe' })).toHaveCount(1)
  await expect(nodes.filter({ hasText: 'Kannettavan vaihe' })).toHaveCount(1)

  // Kumoa palauttaa tilan ennen yhdistämistä
  await laptop.page.getByRole('button', { name: 'Kumoa' }).click()
  await expect(nodes.filter({ hasText: 'Puhelimen vaihe' })).toHaveCount(0)
  await expect(nodes.filter({ hasText: 'Kannettavan vaihe' })).toHaveCount(1)

  await phone.ctx.close()
  await laptop.ctx.close()
})

test('toisen projektin tiedostoa ei yhdistetä vaan se tarjotaan tuotavaksi uutena', async ({
  browser,
}) => {
  const a = await open(browser)
  const b = await open(browser)
  const f = tmp('muu.json')
  await quickAdd(a.page, '- Eka vaihe')
  await exportJson(a.page, f)
  await b.page.getByRole('button', { name: 'Projektit' }).click()
  await b.page.getByRole('menuitem', { name: 'Jaa ja yhdistä…' }).click()
  await b.page.getByTestId('sync-file').setInputFiles(f)
  await expect(b.page.getByTestId('sync-other-project')).toBeVisible()
  await a.ctx.close()
  await b.ctx.close()
})

test('Jaa projekti lataa tiedoston, kun jakovalikkoa ei ole', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.topbar')
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Jaa ja yhdistä…' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('sync-share').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.prosessikartta\.json$/)
})
