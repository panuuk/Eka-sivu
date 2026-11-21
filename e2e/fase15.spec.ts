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

// Puhelimen kokoinen kosketusnäyttö
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

const noHorizontalOverflow = async (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0)

test('tyhjä prosessi: aloitusohje vierittyy ja sivu ei leviä sivusuunnassa', async ({ page }) => {
  await noHorizontalOverflow(page)
  const card = page.locator('.canvas__empty')
  await expect(card.getByRole('button', { name: 'Luo alku, vaihe ja loppu' })).toBeVisible()
  // Kortti täyttää kaavion ja kaikki sen sisältö on tavoitettavissa
  const start = page.getByTestId('getting-started')
  await start.scrollIntoViewIfNeeded()
  await expect(start.getByRole('button', { name: 'Kokeile esimerkkiprojektilla' })).toBeVisible()
})

test('yläpalkki mahtuu yhdelle riville ja harvinaisemmat toiminnot ovat valikossa', async ({
  page,
}) => {
  const h = await page.locator('.topbar').evaluate((e) => e.getBoundingClientRect().height)
  expect(h).toBeLessThan(70)
  await expect(page.getByRole('button', { name: 'Vie ja jaa' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Lisää toimintoja' }).click()
  for (const name of [
    'Esitä muille',
    'Vie ja jaa…',
    /Roolit, järjestelmät/,
    /Tallennus ja varmuus/,
  ])
    await expect(page.getByRole('menuitem', { name })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Vie ja jaa…' }).click()
  await expect(page.locator('dialog[open]')).toBeVisible()
})

test('kaavion työkalut ovat Näkymä-paneelissa eivätkä peitä toisiaan', async ({ page }) => {
  await page.getByRole('button', { name: 'Kokeile esimerkkiprojektilla' }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  const tools = page.getByTestId('canvas-tools')
  await expect(tools).toBeHidden()
  await page.getByRole('button', { name: 'Näkymä', exact: true }).click()
  await expect(tools).toBeVisible()
  await expect(tools.getByPlaceholder(/Hae vaiheita/)).toBeVisible()
  await expect(tools.getByRole('radio', { name: 'Uimaradat' })).toBeVisible()
  // Paneeli ei mene työkalupalkin päälle eikä ylitä näyttöä
  const t = await tools.boundingBox()
  const bar = await page.locator('.canvas__toolbar').boundingBox()
  expect(t!.y).toBeGreaterThan(bar!.y + bar!.height)
  expect(t!.x).toBeGreaterThanOrEqual(0)
  expect(t!.x + t!.width).toBeLessThanOrEqual(390)
  await noHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Näkymä', exact: true }).click()
  await expect(tools).toBeHidden()
})

test('vaiheet yhdistetään napauttamalla: valitse, Yhdistä, napauta kohdetta', async ({ page }) => {
  await page.getByRole('button', { name: 'Luo alku, vaihe ja loppu' }).click()
  await page.getByRole('button', { name: 'Vaihe', exact: true }).click()
  const nodes = page.locator('.react-flow__node')
  await expect(nodes).toHaveCount(4)
  const before = await page.locator('.react-flow__edge').count()
  // Valitse alku ja yhdistä se viimeiseen vaiheeseen (uusi vaihe on irrallinen)
  await nodes.filter({ hasText: 'Alku' }).first().tap()
  await page.getByRole('button', { name: 'Yhdistä' }).tap()
  await expect(page.getByTestId('link-hint')).toBeVisible()
  await nodes.last().tap()
  await expect(page.getByTestId('link-hint')).toBeHidden()
  await expect.poll(() => page.locator('.react-flow__edge').count()).toBe(before + 1)
})

test('sivupaneeli sulkeutuu taustaa napauttamalla', async ({ page }) => {
  await page.getByRole('button', { name: 'Näytä tai piilota prosessilista' }).tap()
  await expect(page.getByTestId('panel-backdrop')).toBeVisible()
  await page.getByTestId('panel-backdrop').tap({ position: { x: 370, y: 300 } })
  await expect(page.locator('.workspace__left')).toHaveCount(0)
})

test('pikasyöte ja lista toimivat kapealla näytöllä ilman sivusuuntaista vierittämistä', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Pikasyöte' }).tap()
  const dlg = page.locator('dialog[open]')
  await expect(dlg).toBeVisible()
  await page
    .getByLabel('Kirjoita tai liitä prosessin kuvaus')
    .fill('- Tarkista lasku @Esimies\n- Maksa lasku')
  await page.getByTestId('quick-apply').tap()
  await expect(dlg).toHaveCount(0)
  await page.getByRole('radio', { name: 'Lista' }).tap()
  await expect(page.getByText('Tarkista lasku').first()).toBeVisible()
  await noHorizontalOverflow(page)
})
