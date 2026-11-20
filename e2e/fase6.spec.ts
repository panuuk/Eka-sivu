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

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

test('uimaradat: rooleittain riveillä, ei-rooli-rata näkyy ja asettelu on automaattinen', async ({
  page,
}) => {
  await loadSample(page)
  await page.getByRole('radio', { name: 'Uimaradat' }).click()
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'lanes')
  // Esimerkissä: Ostoreskontra, Esimies ja "Ei roolia" (Pyydä korjaus toimittajalta)
  await expect(page.getByTestId('lane')).toHaveCount(3)
  await expect(page.locator('.lane__label', { hasText: 'Ostoreskontra' })).toBeVisible()
  await expect(page.locator('.lane__label', { hasText: 'Ei roolia' })).toBeVisible()
  await expect(page.locator('.lane--missing')).toHaveCount(1)
  // Solmut ovat samat kuin vapaassa tilassa
  await expect(
    page.locator('.react-flow__node[data-id]').filter({ has: page.locator('.node') }),
  ).toHaveCount(10)
  // Valinta toimii, siirtäminen ei
  await page.locator('.node__label', { hasText: 'Vastaanota lasku' }).click()
  await expect(page.getByTestId('inspector-node')).toBeVisible()
  // Solmua ei voi vetää: veto panoroi näkymää, joten solmun paikka radan suhteen ei muutu.
  const node = page.locator('.react-flow__node', { hasText: 'Vastaanota lasku' })
  const lane = page.getByTestId('lane').first()
  const offset = async () => {
    const n = (await node.boundingBox())!
    const l = (await lane.boundingBox())!
    return { dx: Math.round(n.x - l.x), dy: Math.round(n.y - l.y) }
  }
  const before = await offset()
  const box = (await node.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 80, { steps: 5 })
  await page.mouse.up()
  expect(await offset()).toEqual(before)
  // Tila säilyy uudelleenlatauksessa
  await page.reload()
  await page.waitForSelector('.react-flow__node')
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'lanes')
})

test('kokonaiskuva: alaprosessi avautuu ryhmäksi, jonka sisällä vaiheet näkyvät', async ({
  page,
}) => {
  await loadSample(page)
  await expect(page.locator('.react-flow__node', { hasText: 'Lähetä esimiehelle' })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Kokonaiskuva' }).click()
  await expect(page.getByTestId('group-box')).toHaveCount(1)
  await expect(page.locator('.react-flow__node', { hasText: 'Lähetä esimiehelle' })).toBeVisible()
  // Sisäkkäinen solmu on ryhmän sisällä
  const group = (await page.getByTestId('group-box').boundingBox())!
  const inner = (await page
    .locator('.react-flow__node', { hasText: 'Lähetä esimiehelle' })
    .boundingBox())!
  expect(inner.x).toBeGreaterThan(group.x)
  expect(inner.y).toBeGreaterThan(group.y)
  expect(inner.x + inner.width).toBeLessThan(group.x + group.width)
  expect(inner.y + inner.height).toBeLessThan(group.y + group.height)
  // Sisäisen vaiheen valinta avaa sen tiedot
  await page.locator('.node__label', { hasText: 'Lähetä esimiehelle' }).click()
  await expect(page.getByTestId('inspector-node')).toBeVisible()
  // Ryhmän avaus-painike siirtyy alaprosessiin
  await page.getByRole('button', { name: /Avaa alaprosessi Hyväksyntäkierto/ }).click()
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('Hyväksyntäkierto')
})

test('suuren prosessin kokonaiskuva ja uimaradat renderöityvät ilman virheitä', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Pikasyöte' }).click()
  const lines = ['alku']
  for (let i = 1; i <= 40; i++) lines.push(`- Vaihe ${i} @Rooli${(i % 5) + 1}`)
  lines.push('+ Alaprosessi @Rooli1', '  - Sisällä A', '  - Sisällä B', 'loppu')
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(lines.join('\n'))
  await page.getByTestId('quick-apply').click()
  await page.getByRole('radio', { name: 'Uimaradat' }).click()
  await expect(page.getByTestId('lane')).toHaveCount(5)
  await page.getByRole('radio', { name: 'Kokonaiskuva' }).click()
  await expect(page.getByTestId('group-box')).toHaveCount(1)
  await page.getByRole('radio', { name: 'Vapaa' }).click()
  await expect(page.getByTestId('group-box')).toHaveCount(0)
})

test('ristiviittaus: entiteetin käyttökohdista pääsee suoraan vaiheeseen', async ({ page }) => {
  await loadSample(page)
  await page.getByRole('button', { name: 'Roolit, järjestelmät ja tuotokset' }).click()
  const row = page.locator('.entity-row', { has: page.getByLabel('Nimi: Esimies') })
  await row.getByRole('button', { name: /käyttöä/ }).click()
  const usage = page.getByRole('list', { name: 'Käyttökohdat: Esimies' })
  await expect(usage).toContainText('Esimies hyväksyy')
  await expect(usage).toContainText('Hyväksyntäkierto')
  await usage.getByRole('button', { name: /Esimies hyväksyy/ }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('Hyväksyntäkierto')
  await expect(page.getByTestId('inspector-node')).toBeVisible()
})

test('kokonaiskuvassa uusi vaihe liitetään valitun alaprosessin vaiheen perään omaan prosessiinsa', async ({
  page,
}) => {
  await loadSample(page)
  await page.getByRole('radio', { name: 'Kokonaiskuva' }).click()
  await page.locator('.node__label', { hasText: 'Lähetä esimiehelle' }).click()
  await page.getByRole('button', { name: 'Vaihe', exact: true }).click()
  await expect(page.locator('.node__edit')).toBeFocused()
  await page.keyboard.type('Uusi sisävaihe')
  await page.keyboard.press('Enter')
  await expect(page.locator('.react-flow__node', { hasText: 'Uusi sisävaihe' })).toBeVisible()
  // Se on ryhmän sisällä, ei päätason prosessissa
  const group = (await page.getByTestId('group-box').boundingBox())!
  const added = (await page
    .locator('.react-flow__node', { hasText: 'Uusi sisävaihe' })
    .boundingBox())!
  expect(added.x).toBeGreaterThan(group.x)
  expect(added.y + added.height).toBeLessThan(group.y + group.height + 1)
})
