import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function loadSample(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.topbar')
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await page.waitForSelector('.react-flow__node')
}

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('jokainen roskakori kysyy vahvistuksen: rooli (myös käyttämätön) ja varmuuskopio', async ({
  page,
}) => {
  await loadSample(page)

  // Rooli, jota ei käytetä missään: ennen poistui kysymättä
  await page.getByRole('button', { name: 'Roolit, järjestelmät ja tuotokset' }).click()
  const trash = page.getByRole('button', { name: 'Poista Talousjohtaja' })
  await trash.click()
  const ask = page.getByRole('dialog').last()
  await expect(ask).toContainText('Poistetaanko “Talousjohtaja”?')
  await ask.getByRole('button', { name: 'Peruuta' }).click()
  await expect(trash).toBeVisible()
  await trash.click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Poista' }).click()
  await expect(trash).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Varmuuskopion poisto on pysyvä, joten sen on kysyttävä aina
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Tallennus ja varmuuskopiot…' }).click()
  const rows = page.getByTestId('backup-row')
  await expect(rows.first()).toBeVisible()
  const before = await rows.count()
  await rows.first().getByRole('button', { name: 'Poista varmuuskopio' }).click()
  const confirm = page.getByRole('dialog').last()
  await expect(confirm).toContainText('Poistetaanko varmuuskopio?')
  await confirm.getByRole('button', { name: 'Peruuta' }).click()
  expect(await rows.count()).toBe(before)
})

test('Kysymykset-välilehden luku sisältää omat avoimet kysymykset', async ({ page }) => {
  await loadSample(page)
  const tab = page.getByTestId('questions-tab')
  const n0 = Number((await tab.innerText()).match(/\((\d+)\)/)?.[1] ?? 0)
  await tab.click()
  await page.getByLabel('Oma kysymys').fill('Kuka hyväksyy poikkeukset?')
  await page.getByRole('button', { name: 'Lisää', exact: true }).click()
  await expect(tab).toContainText(`(${n0 + 1})`)
})

test('Analyysi-näkymällä on oma kuvake, eikä se ole sama kuin Kaaviolla', async ({ page }) => {
  await loadSample(page)
  const icon = (name: string) =>
    page.getByRole('radio', { name }).locator('svg path').first().getAttribute('d')
  expect(await icon('Analyysi')).not.toBe(await icon('Kaavio'))
})
