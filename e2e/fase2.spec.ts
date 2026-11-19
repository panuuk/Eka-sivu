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

test('prosessin rakentaminen kaaviossa ja tallennus säilyy uudelleenlatauksen yli', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Luo alku, vaihe ja loppu' }).click()
  await page.keyboard.type('Vastaanota tilaus')
  await page.keyboard.press('Enter')
  await expect(page.locator('.react-flow__node')).toHaveCount(3)

  // Enter lisää seuraavan vaiheen valitun jälkeen
  await page.keyboard.press('Enter')
  await page.keyboard.type('Tarkista tilaus')
  await page.keyboard.press('Enter')
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(page.locator('.react-flow__edge')).toHaveCount(3)

  // Rooli luodaan ja liitetään inspectorista
  await page.getByRole('combobox', { name: 'Vastuu (rooli)' }).fill('Myynti')
  await page.getByRole('option', { name: /Luo uusi: “Myynti”/ }).click()
  await expect(page.locator('.chip', { hasText: 'Myynti' })).toBeVisible()
  await expect(page.locator('.node__role', { hasText: 'Myynti' })).toBeVisible()

  await expect(page.getByText('Tallennettu')).toBeVisible()
  await page.reload()
  await page.waitForSelector('.react-flow__node')
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(page.locator('.node__role', { hasText: 'Myynti' })).toBeVisible()
})

test('kumoa ja tee uudelleen pikanäppäimillä', async ({ page }) => {
  await page.getByRole('button', { name: 'Lisää yksi vaihe' }).click()
  await page.keyboard.type('Yksinäinen')
  await page.keyboard.press('Enter')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
})

test('alaprosessi: avaaminen, murupolku ja paluu', async ({ page }) => {
  await page.getByRole('button', { name: 'Luo alku, vaihe ja loppu' }).click()
  await page.keyboard.type('Laskutus')
  await page.keyboard.press('Enter')
  await page.locator('#kind-select').selectOption('subprocess')
  await page.getByRole('button', { name: 'Avaa alaprosessi' }).first().click()
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('Laskutus')
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await page.locator('.breadcrumb').getByRole('button', { name: 'Päätason prosessi' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
})

test('listanäkymä ja valinnan jakaminen kaavion kanssa', async ({ page }) => {
  await page.getByRole('button', { name: 'Luo alku, vaihe ja loppu' }).click()
  await page.keyboard.type('Ensimmäinen')
  await page.keyboard.press('Enter')
  await page.getByRole('radio', { name: 'Lista' }).click()
  await expect(page.getByTestId('listview')).toBeVisible()
  await expect(page.locator('.listview tbody tr')).toHaveCount(3)
  await page.getByRole('button', { name: 'Lisää vaihe kohdan Ensimmäinen jälkeen' }).click()
  await expect(page.locator('.listview tbody tr')).toHaveCount(4)
})

test('projektin vienti ja tuonti', async ({ page }) => {
  await page.getByRole('button', { name: 'Lisää yksi vaihe' }).click()
  await page.keyboard.type('Vientitesti')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Projektit' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Vie projekti (JSON)' }).click(),
  ])
  const path = await download.path()
  expect(download.suggestedFilename()).toMatch(/\.prosessikartta\.json$/)
  await page.getByTestId('import-input').setInputFiles(path)
  await expect(page.locator('.topbar')).toContainText('(tuotu)')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
})

test('solmun siirto lukitsee sijainnin ja yhteyden valinta avaa yhteyden tiedot', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Luo alku, vaihe ja loppu' }).click()
  await page.keyboard.type('Siirrettävä')
  await page.keyboard.press('Enter')
  const node = page.locator('.react-flow__node', { hasText: 'Siirrettävä' })
  await page.waitForTimeout(700) // asettelun siirtymäanimaatio
  const box = (await node.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 10, { steps: 8 })
  await page.mouse.up()
  await expect(node.locator('.node__badge--lock')).toBeVisible()
  const moved = (await node.boundingBox())!
  expect(Math.round(moved.x - box.x)).toBeGreaterThan(100)

  // Järjestä-painike vapauttaa lukituksen
  await page.getByRole('button', { name: 'Järjestä' }).click()
  await expect(node.locator('.node__badge--lock')).toHaveCount(0)

  // Yhteyden valinta
  const pt = await page
    .locator('.react-flow__edge-interaction')
    .first()
    .evaluate((el) => {
      const path = el as unknown as SVGPathElement
      const p = path.getPointAtLength(path.getTotalLength() / 2)
      const m = path.getScreenCTM()!
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }
    })
  await page.mouse.click(pt.x, pt.y)
  await expect(page.getByTestId('inspector-edge')).toBeVisible()
})

test('useamman solmun valinta ja ryhmittely alaprosessiksi', async ({ page }) => {
  await page.getByRole('button', { name: 'Pikasyöte' }).click()
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill('- A\n- B\n- C')
  await page.getByTestId('quick-apply').click()
  await page.waitForTimeout(700)
  await page.locator('.node__label', { hasText: /^B$/ }).click()
  await page.locator('.node__label', { hasText: /^C$/ }).click({ modifiers: ['Control'] })
  await expect(page.getByText('2 vaihetta ja 0 yhteyttä valittu')).toBeVisible()
  await page.getByRole('button', { name: 'Ryhmitä' }).first().click()
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('Uusi alaprosessi')
})
