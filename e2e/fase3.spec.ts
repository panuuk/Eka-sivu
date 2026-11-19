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

const TEXT = `- Vastaanota tilaus @Myynti [CRM] > Tilaus
- Tarkista luottotiedot @Talous
? Ylittyykö luottoraja
  kyllä: Pyydä ennakkomaksu @Talous
  ei: jatka
- Lähetä vahvistus @Myynti ~arvaus`

test('pikasyöte: kirjoita teksti, esikatsele ja lisää malliin', async ({ page }) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(TEXT)
  await expect(page.getByTestId('quick-summary')).toContainText('uutta vaihetta')
  await expect(page.getByTestId('quick-summary')).toContainText('2 uutta roolia')
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  // alku, 4 vaihetta, päätös, loppu
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await expect(page.locator('.node__role', { hasText: 'Talous' }).first()).toBeVisible()

  // Toinen lisäys samalla tekstillä ei tee mitään
  await page.keyboard.press('Control+k')
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(TEXT)
  await expect(page.getByTestId('quick-summary')).toContainText('Ei muutoksia')
  await page.keyboard.press('Escape')
})

test('pikasyöte: virhe estää lisäyksen ja rivin voi ohittaa', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const area = page.getByLabel('Kirjoita tai liitä prosessin kuvaus')
  await area.fill('- A\n-> Puuttuva\n- B')
  await expect(page.locator('.issue--error')).toContainText('Puuttuva')
  await expect(page.getByTestId('quick-apply')).toBeDisabled()
  await page.getByLabel('Ota mukaan rivi 2').uncheck()
  await expect(page.getByTestId('quick-apply')).toBeEnabled()
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
})

test('vienti tekstinä ja muokkaus samasta tekstistä', async ({ page }) => {
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await page.waitForSelector('.react-flow__node')
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByRole('tab', { name: 'Vie tekstinä' }).click()
  const exported = page.getByLabel(/tekstinä$/)
  await expect(exported).toHaveValue(/# Ostolaskun käsittely/)
  await expect(exported).toHaveValue(/\+ Hyväksyntäkierto/)
  await page.getByRole('button', { name: 'Muokkaa tästä' }).click()
  // Viety teksti lisättynä takaisin ei muuta mitään
  await expect(page.getByTestId('quick-summary')).toContainText('Ei muutoksia')
})

test('Tab-näppäin sisentää tekstikentässä', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const area = page.getByLabel('Kirjoita tai liitä prosessin kuvaus')
  await area.click()
  await page.keyboard.type('? Kysymys\n')
  await page.keyboard.press('Tab')
  await page.keyboard.type('kyllä: X')
  await expect(area).toHaveValue('? Kysymys\n  kyllä: X')
})
