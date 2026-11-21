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

test('analyysinäkymä: läpimeno, luovutukset, kierrokset, kuormitus ja kipupisteet', async ({
  page,
}) => {
  await loadSample(page)
  await page.getByRole('radio', { name: 'Analyysi' }).click()
  const view = page.getByTestId('analysis-view')
  await expect(view).toBeVisible()
  await expect(page.getByTestId('card-lead')).toContainText('pv')
  await expect(page.getByTestId('card-handoffs')).not.toContainText('0')
  await expect(page.getByTestId('handoff-table')).toContainText('Ostoreskontra')
  await expect(page.getByTestId('loop-list')).toContainText('per kierros')
  await expect(page.getByTestId('role-load')).toContainText('Ostoreskontra')
  await expect(page.getByTestId('pain-list')).toContainText('Laskulta puuttuu usein tilausnumero')
  await expect(page.getByTestId('pain-list')).toContainText('Idea: Nimeä varahyväksyjä')

  // Kipupisteestä pääsee vaiheeseen
  await page
    .getByTestId('pain-list')
    .getByRole('button', { name: 'Tarkista laskun tiedot' })
    .click()
  await expect(page.getByTestId('inspector-node')).toBeVisible()
  await expect(page.locator('.react-flow__node.selected')).toContainText('Tarkista laskun tiedot')
})

test('RACI-matriisi: solun napsautus kiertää tilan ja muuttaa mallia', async ({ page }) => {
  await loadSample(page)
  await page.getByRole('radio', { name: 'Analyysi' }).click()
  const matrix = page.getByTestId('raci-matrix')
  await expect(matrix).toBeVisible()
  const cell = matrix.getByRole('button', { name: /Vastaanota lasku, Esimies/ })
  await expect(cell).toHaveText('·')
  // Vaiheella on jo suorittaja, joten kierto alkaa A:sta eikä vaihda suorittajaa
  await cell.click()
  await expect(cell).toHaveText('A')
  await cell.click()
  await expect(cell).toHaveText('C')
  await cell.click()
  await expect(cell).toHaveText('I')
  await cell.click()
  await expect(cell).toHaveText('·')
  // Vastaanota laskun suorittaja Ostoreskontra säilyy R:nä
  await expect(matrix.getByRole('button', { name: /Vastaanota lasku, Ostoreskontra/ })).toHaveText(
    'R',
  )
  await expect(page.getByTestId('system-matrix')).toContainText('ERP')
})

test('inspector: kesto ja odotus kenttinä, virheellinen arvo ei tallennu', async ({ page }) => {
  await loadSample(page)
  await page.locator('.react-flow__node', { hasText: 'Vastaanota lasku' }).click()
  const work = page.getByTestId('work-section')
  await expect(work).toBeVisible()
  const dur = work.getByLabel('Työaika')
  await expect(dur).toHaveValue('5 min')
  await dur.fill('kolme apinaa')
  await dur.blur()
  await expect(work).toContainText('Ei tunnistettu')
  await dur.fill('1-2 h')
  await dur.blur()
  await expect(work).not.toContainText('Ei tunnistettu')
  await expect(
    page.locator('.react-flow__node', { hasText: 'Vastaanota lasku' }).locator('.node__time'),
  ).toHaveText('1-2 h')

  // Kipupiste lisätään
  await work.getByRole('button', { name: '+ Lisää kipupiste' }).click()
  await work.getByRole('textbox', { name: 'Kipupiste' }).fill('Käsin tehtävää')
  await expect(
    page
      .locator('.react-flow__node', { hasText: 'Vastaanota lasku' })
      .locator('.node__badge--pain'),
  ).toBeVisible()
  // Kumoa
  await page.locator('body').click({ position: { x: 5, y: 300 } })
})

test('pikasyötteen merkinnät: kesto, kipupiste ja RACI', async ({ page }) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page
    .getByLabel('Kirjoita tai liitä prosessin kuvaus')
    .fill(
      '- Tarkista pyyntö @HR =2 pv ^1 vk !3 Viivästyy usein => Automatisoi A@Johtaja I@Esimies #rekry',
    )
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const node = page.locator('.react-flow__node', { hasText: 'Tarkista pyyntö' })
  await expect(node.locator('.node__time')).toContainText('2 pv')
  await expect(node.locator('.node__time')).toContainText('⏳ 1 vk')
  await expect(node.locator('.node__badge--pain-3')).toBeVisible()
  await node.click()
  const work = page.getByTestId('work-section')
  await expect(work).toContainText('Johtaja')
  await expect(work.getByLabel('Parannusidea')).toHaveValue('Automatisoi')

  // Teksti vie samat tiedot takaisin
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByRole('tab', { name: 'Vie tekstinä' }).click()
  const exported = page.getByLabel(/tekstinä$/)
  await expect(exported).toHaveValue(/=2 pv/)
  await expect(exported).toHaveValue(/A@Johtaja/)
  await expect(exported).toHaveValue(/!3 Viivästyy usein => Automatisoi/)
})

test('lämpökartta väritys ja vienti: kestot näkyvät SVG:ssä pyydettäessä', async ({ page }) => {
  await loadSample(page)
  await page.getByLabel('Väritys').selectOption('pain')
  await expect(page.locator('.node.has-heat.heat--pain').first()).toBeVisible()
  await page.getByLabel('Väritys').selectOption('off')
  await expect(page.locator('.node.has-heat')).toHaveCount(0)

  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  const dialog = page.getByRole('dialog', { name: /Vie ja jaa/ })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Näytä kestot ja kipupisteet').check()
  await expect(dialog.getByTestId('export-preview')).toContainText('15-60 min')
})
