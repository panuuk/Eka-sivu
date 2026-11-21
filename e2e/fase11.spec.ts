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

async function openVersions(page: Page) {
  await page.getByRole('button', { name: /Projektit/ }).click()
  await page.getByRole('menuitem', { name: 'Versiot ja tavoitetila…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Versiot ja tavoitetila' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('versio: tallenna, muokkaa, vertaa ja palauta', async ({ page }) => {
  await loadSample(page)
  const nodes = await page.locator('.react-flow__node').count()

  let dialog = await openVersions(page)
  await dialog.getByLabel('Nimi', { exact: true }).fill('Ennen uudistusta')
  await dialog.getByLabel('Kommentti (valinnainen)').fill('Lähtötilanne')
  await dialog.getByTestId('version-save').click()
  await expect(dialog.getByTestId('version-row')).toHaveCount(1)
  await expect(dialog.getByTestId('version-row')).toContainText('Ennen uudistusta')
  await expect(dialog.getByTestId('version-row')).toContainText('Lähtötilanne')
  await page.keyboard.press('Escape')

  // Muokkaus: poista vaihe ja vaihda toisen rooli
  await page.locator('.react-flow__node', { hasText: 'Kirjaa ja vie maksuun' }).click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes - 1)

  dialog = await openVersions(page)
  await dialog.getByRole('button', { name: 'Vertaa nykytilaan' }).click()
  const view = page.getByTestId('compare-view')
  await expect(view).toBeVisible()
  await expect(page.getByTestId('cmp-counts')).toContainText('1 poistettu')
  await expect(view.getByTestId('change-row').first()).toContainText('Poistettu')
  await expect(view.getByTestId('change-row').first()).toContainText('Kirjaa ja vie maksuun')

  // Kaaviot rinnakkain: poistettu merkitään punaisella
  await view.getByRole('radio', { name: 'Kaaviot rinnakkain' }).click()
  await expect(page.getByTestId('compare-diagrams').locator('svg').first()).toBeVisible()
  await expect(page.getByTestId('compare-diagrams').locator('g[data-id]').first()).toBeVisible()

  // Palautus tuo vaiheen takaisin, ja kumoaminen perii sen
  dialog = await openVersions(page)
  await dialog.getByRole('button', { name: 'Palauta', exact: true }).click()
  await page.getByRole('button', { name: 'Palauta', exact: true }).last().click()
  await page.getByRole('radio', { name: 'Kaavio', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes - 1)
})

test('tavoitetila: kopio nykytilasta, muutokset näkyvät vertailussa ja vienti sisältää muutosluettelon', async ({
  page,
}) => {
  await loadSample(page)
  const originalName = await page.locator('.project-btn strong').textContent()
  const dialog = await openVersions(page)
  await dialog.getByTestId('create-target').click()

  // Avautuu uusi projekti ja vertailunäkymä
  await expect(page.locator('.project-btn strong')).toContainText('tavoitetila')
  await expect(page.getByTestId('compare-view')).toBeVisible()
  await expect(page.getByTestId('cmp-counts')).toContainText('Ei muutoksia')

  // Muokkaa tavoitetilaa: lisää vaihe ja vaihda roolia pikasyötteellä
  await page.getByRole('radio', { name: 'Kaavio', exact: true }).click()
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page
    .getByLabel('Kirjoita tai liitä prosessin kuvaus')
    .fill('- Automaattitarkistus @Ostoreskontra =1 min')
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await page.locator('.react-flow__node', { hasText: 'Pyydä korjaus toimittajalta' }).click()
  await page.getByRole('radio', { name: 'Vertailu' }).click()
  await expect(page.getByTestId('cmp-counts')).toContainText('1 lisätty')
  await expect(page.getByTestId('compare-view')).toContainText('Automaattitarkistus')
  await expect(page.getByTestId('cmp-metrics')).toContainText('Vaiheet')

  // Esitys ja vienti: muutokset korostetaan ja dokumentti sisältää muutosluettelon
  await page.getByRole('button', { name: 'Vie ja jaa' }).click()
  const exportDialog = page.getByRole('dialog', { name: /Vie ja jaa/ })
  await exportDialog.getByLabel('Korosta muutokset lähtötilaan verrattuna').check()
  await expect(
    exportDialog.getByTestId('export-preview').locator('g[data-id]').first(),
  ).toBeVisible()
  await expect
    .poll(async () =>
      (await exportDialog.getByTestId('export-preview').innerHTML()).includes('stroke-width="3"'),
    )
    .toBe(true) // lisätty vaihe korostettuna
  await page.keyboard.press('Escape')

  // Alkuperäinen projekti ei muuttunut
  await page.getByRole('button', { name: /Projektit/ }).click()
  await page.getByRole('menuitem', { name: originalName!, exact: true }).click()
  await expect(page.locator('.react-flow__node', { hasText: 'Automaattitarkistus' })).toHaveCount(0)
})

test('vertailu ilman versioita ohjaa tallentamaan version', async ({ page }) => {
  await loadSample(page)
  await page.getByRole('radio', { name: 'Vertailu' }).click()
  await expect(page.getByTestId('compare-view')).toContainText(
    'tarvitaan vähintään yksi tallennettu versio',
  )
  await page.getByRole('button', { name: /Versiot ja tavoitetila/ }).click()
  await expect(page.getByRole('dialog', { name: 'Versiot ja tavoitetila' })).toBeVisible()
})

test('versiot säilyvät projektin JSON-viennissä ja tuonnissa', async ({ page }) => {
  await loadSample(page)
  const dialog = await openVersions(page)
  await dialog.getByLabel('Nimi', { exact: true }).fill('Vientitesti')
  await dialog.getByTestId('version-save').click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Projektit/ }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Vie projekti (JSON)' }).click()
  const download = await downloadPromise
  const path = await download.path()
  const fs = await import('node:fs')
  const json = JSON.parse(fs.readFileSync(path!, 'utf8'))
  expect(Object.values(json.project.versions as Record<string, { name: string }>)[0].name).toBe(
    'Vientitesti',
  )
})
