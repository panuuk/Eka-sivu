import { expect, test, type Page } from '@playwright/test'
import { REKRYTOINTI_TEKSTI } from '../src/capture/eval/rekrytointi'

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

test('dokumentista prosessiksi neljällä toimenpiteellä: roolit, järjestelmät ja vaiheet', async ({
  page,
}) => {
  const t0 = Date.now()
  // 1. Tuo dokumentti
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles({
    name: 'rekrytointi.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(REKRYTOINTI_TEKSTI, 'utf8'),
  })
  await expect(page.getByTestId('reader')).toBeVisible()

  // 2. Lisää löydetyt roolit ja järjestelmät
  const candidates = page.getByTestId('candidates')
  await expect(candidates).toContainText('HR-asiantuntija')
  await expect(candidates).toContainText('Esimies')
  await expect(candidates).toContainText('Rekrysysteemi')
  await page.getByTestId('candidates-add').click()
  await expect(page.getByTestId('candidates')).toHaveCount(0)

  // 3. Lisää kaikki ehdotukset
  await page.getByRole('button', { name: /Lisää kaikki/ }).click()
  // Ehdotuksia on rajattu erissä: jatketaan kunnes kaikki on lisätty
  for (let i = 0; i < 5; i++) {
    const more = page.getByRole('button', { name: /Lisää kaikki \(\d+\)/ })
    if (await more.isDisabled()) break
    await more.click()
  }

  // 4. Katso tulos kaaviosta
  await page.getByRole('radio', { name: 'Kaavio' }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  const elapsed = Date.now() - t0
  const nodes = await page.locator('.react-flow__node').count()
  console.log(`dokumentista ${nodes} solmua ${elapsed} ms (4 toimenpidettä)`)
  expect(nodes).toBeGreaterThan(35)
  // Useimmilla vaiheilla on rooli ilman käsin liittämistä
  const withRole = await page.locator('.node__role').count()
  expect(withRole).toBeGreaterThan(25)
  await expect(page.locator('.node__role', { hasText: 'HR-asiantuntija' }).first()).toBeVisible()
})

const FLOW = `- Vastaanota tilaus @Myynti
? Onko tilaus kunnossa
  kyllä: Tarkista luotto @Talous
  ei: Pyydä lisätiedot @Myynti
- Toimita tilaus @Logistiikka`

async function addText(page: Page, text: string) {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(text)
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
}

test('nuolinäppäimet liikkuvat prosessin kulussa ja haarojen välillä', async ({ page }) => {
  await addText(page, FLOW)
  await page.locator('.react-flow__node', { hasText: 'Vastaanota tilaus' }).click()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('inspector-node')).toBeVisible()
  await expect(page.locator('.react-flow__node.selected')).toContainText('Onko tilaus kunnossa')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.react-flow__node.selected')).toContainText('Tarkista luotto')
  // Vaihtoehtoinen haara oikealla nuolella
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.react-flow__node.selected')).toContainText('Pyydä lisätiedot')
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.react-flow__node.selected')).toContainText('Onko tilaus kunnossa')
  // Valitun vaiheen sijainti ei muutu nuolinäppäimestä (ei lukittua sijaintia)
  await expect(page.getByRole('button', { name: 'Järjestä' })).toBeDisabled()
})

test('kopioi ja liitä: vaiheet siirtyvät toiseen prosessiin', async ({ page }) => {
  await addText(page, FLOW)
  await page.locator('.react-flow__node', { hasText: 'Tarkista luotto' }).click()
  await page.locator('.react-flow__node', { hasText: 'Toimita tilaus' }).click({
    modifiers: ['Control'],
  })
  await page.keyboard.press('Control+c')
  await page.getByRole('button', { name: /Liitä \(2\)/ }).waitFor()

  // Uusi prosessi ja liitä sinne
  await page.getByRole('button', { name: 'Uusi prosessi' }).click()
  await expect(page.locator('.canvas__empty')).toBeVisible()
  await page.keyboard.press('Control+v')
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(page.locator('.node__role', { hasText: 'Talous' })).toBeVisible()
  await expect(page.locator('.node__role', { hasText: 'Logistiikka' })).toBeVisible()
})

test('joukkomuokkaus: rooli usealle vaiheelle kerralla', async ({ page }) => {
  await addText(page, FLOW)
  await page.locator('.react-flow__node', { hasText: 'Tarkista luotto' }).click()
  await page.locator('.react-flow__node', { hasText: 'Pyydä lisätiedot' }).click({
    modifiers: ['Control'],
  })
  await page.locator('.react-flow__node', { hasText: 'Toimita tilaus' }).click({
    modifiers: ['Control'],
  })
  const bulk = page.getByTestId('bulk-edit')
  await expect(bulk).toContainText('3 vaihetta')
  await bulk.getByRole('combobox', { name: 'Vastuu (rooli)' }).fill('Myynti')
  await bulk.getByRole('option', { name: 'Myynti' }).first().click()
  await expect(page.locator('.node__role', { hasText: 'Myynti' })).toHaveCount(4)
})

test('etsi ja korvaa esikatselulla', async ({ page }) => {
  await addText(page, FLOW)
  await page.keyboard.press('Control+h')
  const dialog = page.getByRole('dialog', { name: 'Etsi ja korvaa' })
  await dialog.getByLabel('Etsi', { exact: true }).fill('tilaus')
  await dialog.getByLabel('Korvaa tekstillä').fill('toimitus')
  await expect(dialog.getByTestId('replace-preview')).toContainText('Vastaanota toimitus')
  await dialog.getByRole('button', { name: /Korvaa \d+ kohtaa/ }).click()
  await expect(page.locator('.react-flow__node', { hasText: 'Vastaanota toimitus' })).toBeVisible()
  // Kumoa palauttaa kaiken yhdellä askeleella
  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node', { hasText: 'Vastaanota tilaus' })).toBeVisible()
})

test('lähes samannimiset vaiheet ehdotetaan yhdistettäviksi', async ({ page }) => {
  await addText(page, '- Tarkista lasku\n- Laskun tarkistus')
  await page.getByRole('tab', { name: /Kysymykset/ }).click()
  await expect(page.getByText(/kuulostavat samalta/)).toBeVisible()
})

test('ensikäytön aloitusohje ja pikanäppäinohje', async ({ page }) => {
  await expect(page.getByTestId('getting-started')).toBeVisible()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Pikanäppäimet ja ohje' })).toContainText('Ctrl+H')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Kokeile esimerkkiprojektilla' }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await expect(page.getByTestId('getting-started')).toHaveCount(0)
})
