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

test.beforeEach(async ({ page, context }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await fresh(page)
})

const AREA = 'Kirjoita tai liitä prosessin kuvaus'

test('tekoälyn sotkuinen vastaus siivotaan ja menee malliin', async ({ page }) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  const reply = [
    'Hienoa! Tässä muistiinpanosi pikasyötteen muodossa:',
    '',
    '```text',
    '* Vastaanota **lasku** @Talous',
    '* Tarkista lasku',
    '```',
    '',
    'Haluatko, että lisään myös poikkeuspolut?',
  ].join('\n')
  await page.getByLabel(AREA).fill(reply)
  await expect(page.getByTestId('ai-response-hint')).toBeVisible()
  await page.getByRole('button', { name: 'Siivoa vastaus' }).click()
  await expect(page.getByLabel(AREA)).toHaveValue('- Vastaanota lasku @Talous\n- Tarkista lasku')
  await expect(page.getByTestId('markdown-done')).toContainText('tekoälyn vastaus siivottu')
  await page.getByRole('button', { name: 'Palauta alkuperäinen' }).click()
  await expect(page.getByLabel(AREA)).toHaveValue(reply)
  await page.getByRole('button', { name: 'Siivoa vastaus' }).click()
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Vastaanota lasku' }),
  ).toHaveCount(1)
})

test('arviointikierros: ohje, tekoälyn muokkaama vastaus, nimenmuutos ja poistot esikatselussa', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Kokeile esimerkkiprojektilla' }).click()
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByText('Tekoälyn apu').click()
  await page.getByTestId('ai-template-review').click()
  const prompt = await page.getByTestId('ai-prompt-text').inputValue()
  expect(prompt).toContain('# Ostolaskun käsittely')
  await page.getByTestId('copy-ai-prompt').click()
  await expect(page.getByTestId('copy-ai-prompt')).toHaveText('Kopioitu')
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toBe(prompt)

  // "Tekoäly" nimeää yhden vaiheen uudelleen, poistaa toisen ja lisää uuden
  const current = /NYKYINEN PROSESSI\n```\n([\s\S]*?)\n```/.exec(prompt)![1]
  const lines = current.split('\n')
  expect(current).toContain('Vastaanota lasku')
  const edited = lines
    .filter((l) => !/Kirjaa ja vie maksuun/.test(l))
    .map((l) =>
      l.replace('- Vastaanota lasku', '- Vastaanota ja kirjaa lasku (aiemmin: Vastaanota lasku)'),
    )
    .concat([''])
    .join('\n')
  const reply = `Tässä parannettu versio:\n\n\`\`\`\n${edited}\n\`\`\`\n\nKerro, jos tarvitset lisää.`

  await page.getByLabel(AREA).fill(reply)
  await page.getByRole('button', { name: 'Siivoa vastaus' }).click()
  const preview = page.locator('.quick__preview')
  await expect(preview).toContainText('Nimi muuttuu')

  // Ilman poisto-valintaa mikään ei poistu
  await expect(page.getByTestId('quick-removals')).toHaveCount(0)
  await page.getByTestId('remove-missing').check()
  const removals = page.getByTestId('quick-removals')
  await expect(removals).toContainText('Kirjaa ja vie maksuun')
  await expect(page.getByTestId('quick-summary')).toContainText('vaihe poistuu')

  // Yksittäisen poiston voi perua
  await removals.getByLabel('Poista Kirjaa ja vie maksuun').uncheck()
  await expect(page.getByTestId('quick-summary')).not.toContainText('poistuu')
  await removals.getByLabel('Poista Kirjaa ja vie maksuun').check()

  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Vastaanota ja kirjaa lasku' }),
  ).toHaveCount(1)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Kirjaa ja vie maksuun' }),
  ).toHaveCount(0)
})

test('haastatteluohje ja esittelyohje sisältävät prosessin tiedot eikä niille ole liitettävää vastausta', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Kokeile esimerkkiprojektilla' }).click()
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByText('Tekoälyn apu').click()
  await page.getByTestId('ai-template-interview').click()
  await expect(page.getByTestId('ai-prompt-text')).toHaveValue(/AVOIMET KYSYMYKSET/)
  await page.getByTestId('ai-template-present').click()
  await expect(page.getByTestId('ai-prompt-text')).toHaveValue(/Hyväksyntäkierto/)
})
