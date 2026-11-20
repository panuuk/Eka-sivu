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

const openQuestions = (page: Page) => page.getByTestId('questions-tab').click()

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

test('kysymysjono: rooliin vastaaminen poistaa aukon ja nostaa valmiusastetta', async ({
  page,
}) => {
  await loadSample(page)
  await openQuestions(page)
  const pill = page.getByTestId('readiness-pill')
  const before = Number((await pill.innerText()).match(/(\d+) %/)![1])

  const gap = page.locator('[data-testid=gap][data-rule=no-role]').first()
  await expect(gap).toContainText('Kuka tekee vaiheen')
  const gapsBefore = await page.getByTestId('gap').count()
  await gap.getByRole('combobox').fill('Ostoreskontra')
  await gap.getByRole('option', { name: 'Ostoreskontra' }).click()
  await expect(page.getByTestId('gap')).toHaveCount(gapsBefore - 1)
  const after = Number((await pill.innerText()).match(/(\d+) %/)![1])
  expect(after).toBeGreaterThanOrEqual(before)

  // Kumoaminen palauttaa aukon
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('gap')).toHaveCount(gapsBefore)
})

test('aukon ohitus ja palautus', async ({ page }) => {
  await loadSample(page)
  await openQuestions(page)
  const total = await page.getByTestId('gap').count()
  await page
    .locator('[data-testid=gap][data-rule=artifact-source]')
    .getByRole('button', { name: 'Tulee prosessin ulkopuolelta' })
    .click()
  await expect(page.getByTestId('gap')).toHaveCount(total - 1)
  await page.getByRole('button', { name: /Näytä ohitetut/ }).click()
  await page.getByRole('button', { name: 'Palauta', exact: true }).click()
  await expect(page.getByTestId('gap')).toHaveCount(total)
})

test('päätöksen puuttuva haara lisätään kysymyksestä', async ({ page }) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page
    .getByLabel('Kirjoita tai liitä prosessin kuvaus')
    .fill('- Vastaanota @Myynti\n? Onko kunnossa?\n  kyllä: Jatka @Myynti')
  await page.getByTestId('quick-apply').click()
  await openQuestions(page)
  const gap = page.locator('[data-testid=gap][data-rule=decision-branches]')
  await expect(gap).toContainText('vain yksi haara')
  await gap.getByLabel('Uuden haaran vaihe').fill('Pyydä korjaus')
  await gap.getByRole('button', { name: 'Lisää haara' }).click()
  await expect(page.locator('[data-testid=gap][data-rule=decision-branches]')).toHaveCount(0)
  await expect(page.locator('.react-flow__node', { hasText: 'Pyydä korjaus' })).toBeVisible()
})

test('puuttuva alku ja loppu lisätään yhdellä klikkauksella', async ({ page }) => {
  await page.getByRole('button', { name: 'Lisää yksi vaihe' }).click()
  await page.keyboard.type('Eka')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Toka')
  await page.keyboard.press('Enter')
  await openQuestions(page)
  await page
    .locator('[data-testid=gap][data-rule=no-start]')
    .getByRole('button', { name: 'Lisää alkupiste' })
    .click()
  await page
    .locator('[data-testid=gap][data-rule=no-end]')
    .getByRole('button', { name: 'Lisää loppupiste' })
    .click()
  await expect(page.locator('[data-testid=gap][data-rule=no-start]')).toHaveCount(0)
  await expect(page.locator('[data-testid=gap][data-rule=no-end]')).toHaveCount(0)
  await expect(page.locator('.node--start')).toHaveCount(1)
  await expect(page.locator('.node--end')).toHaveCount(1)
})

test('omat kysymykset: lisäys, vastaus ja poisto', async ({ page }) => {
  await page.getByRole('button', { name: 'Lisää yksi vaihe' }).click()
  await page.keyboard.type('Tarkista')
  await page.keyboard.press('Enter')
  await openQuestions(page)
  await page.getByLabel('Oma kysymys').fill('Kuka päättää poikkeukset?')
  await page.getByRole('button', { name: 'Lisää', exact: true }).click()
  await expect(page.locator('.gap--custom')).toContainText('Kuka päättää poikkeukset?')
  // kysymys näkyy solmun merkinnässä
  await expect(page.locator('.node__badge--q').first()).toBeVisible()
  await page.getByLabel('Vastaus: Kuka päättää poikkeukset?').fill('Esimies')
  await page.getByRole('button', { name: 'Merkitse vastatuksi' }).click()
  await expect(page.locator('.gap--custom.is-answered')).toContainText('Esimies')
  await page
    .getByRole('region', { name: 'Omat kysymykset' })
    .getByRole('button', { name: 'Poista' })
    .click()
  await expect(page.locator('.gap--custom')).toHaveCount(0)
})

test('valmiusaste näkyy prosessipuussa ja prosessin tiedoissa', async ({ page }) => {
  await loadSample(page)
  await expect(page.locator('.tree__chip').first()).toContainText('%')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Ominaisuudet' }).click()
  await expect(page.getByTestId('readiness')).toContainText('avointa kysymystä')
  await expect(page.getByRole('progressbar', { name: 'Prosessin valmiusaste' })).toBeVisible()
})

test('solmun kysymysmerkki avaa kysymykset valittuun solmuun', async ({ page }) => {
  await loadSample(page)
  const badge = page.locator('.node__badge--q').first()
  await badge.click()
  await expect(page.getByTestId('questions-tab')).toHaveAttribute('aria-selected', 'true')
})

test('haku himmentää ei-osuvat vaiheet ja osumaa klikkaamalla siirrytään vaiheeseen', async ({
  page,
}) => {
  await loadSample(page)
  const search = page.getByLabel('Hae vaiheita')
  await search.fill('esimies')
  await expect(page.locator('.filterbar__count')).toBeVisible()
  const dimmed = await page.locator('.node.is-dim').count()
  const total = await page.locator('.react-flow__node').count()
  expect(dimmed).toBeGreaterThan(0)
  expect(dimmed).toBeLessThan(total)
  // Osuma avaa vaiheen alaprosessista
  await page
    .getByRole('option', { name: /Esimies hyväksyy/ })
    .getByRole('button')
    .click()
  await expect(page.locator('.breadcrumb [aria-current]')).toHaveText('Hyväksyntäkierto')
  await expect(page.getByTestId('inspector-node')).toBeVisible()
  // Tyhjennys poistaa himmennyksen
  await page.getByRole('button', { name: 'Tyhjennä haku ja suodattimet' }).click()
  await expect(page.locator('.node.is-dim')).toHaveCount(0)
})

test('suodattimet rajaavat roolin ja varmuuden mukaan, ja / siirtää haun kohdistuksen', async ({
  page,
}) => {
  await loadSample(page)
  await page.keyboard.press('/')
  await expect(page.getByLabel('Hae vaiheita')).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Suodattimet' }).click()
  const filters = page.locator('.filterbar__filters')
  await filters.getByLabel('Varmuus').selectOption('guess')
  await expect(page.locator('.filterbar__count')).toContainText('/')
  await expect(page.locator('.node.is-dim').first()).toBeVisible()
  await filters.getByLabel('Rooli').selectOption({ label: 'Esimies' })
  const count = await page.locator('.filterbar__count').innerText()
  expect(count).toMatch(/^\d+ \/ \d+$/)
})
