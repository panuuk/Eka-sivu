import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const tmp = (name: string) => join(tmpdir(), `pk-review-${process.pid}-${name}`)

async function fresh(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.topbar')
}

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

test('katselmointikierros: vienti palautetilassa, kommentointi tiedostossa ja palautteen tuonti', async ({
  page,
  browser,
}) => {
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await page.waitForSelector('.react-flow__node')

  // 1. Vie interaktiivinen HTML palautetilassa
  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  await page.getByRole('radio', { name: 'HTML-tiedosto' }).click()
  await page.getByTestId('export-review').check()
  const htmlPath = tmp('katselmointi.html')
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Lataa/ }).click(),
  ])
  expect(dl.suggestedFilename()).toMatch(/\.palaute\.html$/)
  await dl.saveAs(htmlPath)
  await page.keyboard.press('Escape')

  // 2. Lukija avaa tiedoston omassa selaimessaan: kommentoi vaihetta ja vastaa kysymykseen
  const reviewer = await browser.newContext({ acceptDownloads: true })
  const rp = await reviewer.newPage()
  rp.on('pageerror', (e) => {
    throw e
  })
  await rp.goto('file://' + htmlPath)
  await rp.locator('svg g[data-id]', { hasText: 'Tarkista laskun tiedot' }).first().click()
  await rp.locator('#pk-comment').fill('Tarkistus kestää liian kauan')
  await rp.locator('#pk-comment-add').click()
  await rp.locator('#pk-reviewer').fill('Liisa')
  await rp.locator('#pk-fb-open').click()
  await expect(rp.locator('#pk-fb-comments li')).toHaveCount(1)
  const answerBox = rp.locator('#pk-fb-questions textarea').first()
  if (await answerBox.count()) await answerBox.fill('Vastaus Liisalta')
  const fbPath = tmp('palaute.json')
  const [fbDl] = await Promise.all([rp.waitForEvent('download'), rp.locator('#pk-fb-save').click()])
  await fbDl.saveAs(fbPath)
  await reviewer.close()

  // 3. Laatija tuo palautteen: rivit tulevat kysymyksiksi oikeisiin vaiheisiin
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Jaa ja yhdistä…' }).click()
  await page.getByTestId('feedback-file').setInputFiles(fbPath)
  const plan = page.getByTestId('feedback-plan')
  await expect(plan).toContainText('Liisa')
  await expect(plan).toContainText('Tarkistus kestää liian kauan')
  await page.getByTestId('feedback-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const panel = page.locator('.workspace__right')
  await expect(panel).toContainText('Tarkistus kestää liian kauan')
  await expect(panel).toContainText('Liisa')

  // Sama tiedosto uudelleen ei tuo kaksoiskappaleita
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Jaa ja yhdistä…' }).click()
  await page.getByTestId('feedback-file').setInputFiles(fbPath)
  await page.getByTestId('feedback-apply').click()
  await expect(
    page.locator('.workspace__right').getByText('Tarkistus kestää liian kauan'),
  ).toHaveCount(1)
})

test('toisen projektin palaute hylätään', async ({ page }) => {
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Jaa ja yhdistä…' }).click()
  const path = tmp('vieras.json')
  const fs = await import('node:fs')
  fs.writeFileSync(
    path,
    JSON.stringify({
      app: 'prosessikartta-palaute',
      version: 1,
      projectId: 'toinen',
      projectName: 'Toinen',
      reviewer: 'X',
      createdAt: 1,
      items: [{ id: 'c0', type: 'comment', text: 'hei' }],
    }),
  )
  await page.getByTestId('feedback-file').setInputFiles(path)
  await expect(page.getByText(/koskee toista projektia/)).toBeVisible()
  await expect(page.getByTestId('feedback-plan')).toHaveCount(0)
})
