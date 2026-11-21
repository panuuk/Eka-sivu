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

const fixture = (name: string) => `e2e/fixtures/${name}`

async function openSource(page: Page, file: string) {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles(fixture(file))
  await expect(page.getByTestId('reader')).toBeVisible()
}

/** Ottaa roolit mukaan ja palauttaa ehdotusten tekstit. */
async function suggestions(page: Page) {
  await page.getByRole('button', { name: /Lisää valitut/ }).click()
  await expect(page.locator('.suggestion').first()).toBeVisible()
  return page.locator('.suggestion__text').allInnerTexts()
}

test('Word: otsikot, luettelot ja taulukko säilyvät ja vaiheet löytyvät luettelokohdista', async ({
  page,
}) => {
  await openSource(page, 'matkalasku.docx')
  const reader = page.getByTestId('reader')
  await expect(reader).toContainText('Työntekijä täyttää matkalaskun')
  const list = await suggestions(page)
  const joined = list.join('\n')
  expect(list.length).toBeGreaterThanOrEqual(6)
  expect(joined).toContain('Täyttää matkalaskun')
  expect(joined).toContain('Summa ylittää 1000 euroa?')
  // Taulukon otsikkorivi ja dokumentin esittelylause eivät ole vaiheita
  expect(joined).not.toContain('Järjestelmä')
  expect(joined).not.toContain('Tämä kuvaus')
})

test('PDF: otsikot ja luettelomerkit tunnistetaan, taulukon rivit eivät tule vaiheiksi', async ({
  page,
}) => {
  await openSource(page, 'matkalasku.pdf')
  const text = await page.getByTestId('reader').innerText()
  expect(text).toContain('| Vaihe | Rooli | Järjestelmä |')
  expect(text).toMatch(/- Kuitit säilytetään kuusi vuotta/)
  const joined = (await suggestions(page)).join('\n')
  expect(joined).toContain('Täyttää matkalaskun')
  expect(joined).not.toContain('Järjestelmä Täyttäminen')
  expect(joined).not.toContain('Vastuut')
})

test('PowerPoint: dian otsikko ei sotkeudu ensimmäiseen vaiheeseen', async ({ page }) => {
  await openSource(page, 'matkalasku.pptx')
  const joined = (await suggestions(page)).join('\n')
  expect(joined).toContain('Täyttää matkalaskun')
  expect(joined).not.toMatch(/Dia \d/)
  expect(joined).not.toContain('Matkalaskun käsittely Työntekijä')
})

test('Lähteet-näkymään pudotettu Excel ohjataan Tuo-ikkunaan sarakkeiden yhdistämiseen', async ({
  page,
}) => {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles(fixture('matkalasku.xlsx'))
  await expect(page.getByTestId('import-table')).toBeVisible()
  await expect(page.getByTestId('import-preview-table')).toContainText('Täytä matkalasku')
  await expect(page.getByTestId('import-dsl')).toContainText('@Työntekijä')
})

test('Lähteet-näkymään pudotettu BPMN ohjataan kaaviotuontiin', async ({ page }) => {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles(fixture('matkalasku.bpmn'))
  await expect(page.getByTestId('import-diagram')).toBeVisible()
  await expect(page.getByTestId('import-summary')).toContainText('vaihetta')
})

test('tekoälyohje kopioituu leikepöydälle ja sisältää syntaksin, esimerkin ja paikan muistiinpanoille', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByTestId('copy-ai-prompt').click()
  await expect(page.getByTestId('copy-ai-prompt')).toHaveText('Ohje kopioitu')
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('SYNTAKSI')
  expect(clip).toContain('@Rooli')
  expect(clip).toContain('# Matkalaskun käsittely')
  expect(clip).toContain('MUISTIINPANOT')

  // Ohjeen esimerkki kelpaa sellaisenaan pikasyötteeseen
  const example = /```\n([\s\S]*?)\n```/.exec(clip)![1]
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(example)
  await expect(page.getByTestId('quick-summary')).toContainText('uutta vaihetta')
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Tarkista ja hyväksy' }),
  ).toHaveCount(1)
})
