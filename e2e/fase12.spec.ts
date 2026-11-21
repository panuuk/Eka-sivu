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

test('skannattu PDF: tekstintunnistus suomeksi selaimessa, ja tulos käy ehdotusten lähteeksi', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles('e2e/fixtures/skannattu.pdf')
  // Sovellus kysyy lupaa tunnistukseen
  const confirm = page.getByRole('dialog', { name: 'Tunnistetaanko teksti kuvasta?' })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('eikä mitään lähetetä minnekään')
  await confirm.getByRole('button', { name: 'Tunnista teksti' }).click()
  await expect(page.getByTestId('import-progress')).toBeVisible()
  await expect(page.getByTestId('reader')).toBeVisible({ timeout: 150_000 })
  const text = (await page.getByTestId('reader').innerText()).toLowerCase()
  for (const word of [
    'ostolaskun',
    'käsittely',
    'ostoreskontra',
    'järjestelmästä',
    'korjauspyyntö',
    'hyväksyttäväksi',
    'esimies',
  ]) {
    expect(text, word).toContain(word)
  }
  // Tekstistä saa ehdotuksia kuten muustakin lähteestä
  await expect(page.getByRole('tab', { name: /Ehdotukset \(\d+\)/ })).toBeVisible()
})

test('skannattu PDF: tunnistuksen voi kieltäytyä, jolloin tulee selkeä virhe', async ({ page }) => {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles('e2e/fixtures/skannattu.pdf')
  const confirm = page.getByRole('dialog', { name: 'Tunnistetaanko teksti kuvasta?' })
  await confirm.getByRole('button', { name: 'Peruuta' }).click()
  await expect(page.getByRole('alert')).toContainText('Tiedostosta ei löytynyt tekstiä')
})

test('tekstitön tunnistus ei kaada: OCR-tiedostot tulevat samasta alkuperästä', async ({
  page,
}) => {
  // Kielitiedot ja ydin ovat osa sovellusta (ei ulkoisia pyyntöjä)
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http'))
      external.push(r.url())
  })
  const r = await page.request.get('/ocr/fin.traineddata.gz')
  expect(r.ok()).toBe(true)
  expect((await r.body()).byteLength).toBeGreaterThan(1_000_000)
  const w = await page.request.get('/ocr/worker.min.js')
  expect(w.ok()).toBe(true)
  expect(external).toEqual([])
})

async function openImport(page: Page) {
  await page.getByRole('button', { name: /Projektit/ }).click()
  await page.getByRole('menuitem', { name: 'Tuo taulukko tai kaavio…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tuo materiaalia' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('Excel: sarakkeet tunnistetaan, esikatselu ja pikasyöte tuottavat prosessin', async ({
  page,
}) => {
  const dialog = await openImport(page)
  await dialog.getByTestId('import-table-file').setInputFiles('e2e/fixtures/rekrytointi.xlsx')
  const table = dialog.getByTestId('import-preview-table')
  await expect(table).toContainText('Täytä rekrytointipyyntö')
  // Otsikoista tunnistetut kentät
  await expect(dialog.getByLabel('Sarake 2 (Työvaihe)')).toHaveValue('step')
  await expect(dialog.getByLabel('Sarake 3 (Vastuuhenkilö)')).toHaveValue('role')
  await expect(dialog.getByLabel('Sarake 5 (Kesto)')).toHaveValue('duration')
  await expect(dialog.getByLabel('Sarake 1 (Alaprosessi)')).toHaveValue('group')
  // Päivämääräsarake ei kuulu mihinkään kenttään
  await expect(dialog.getByLabel('Sarake 9 (Päivitetty)')).toHaveValue('')
  // Excelin päivämäärä luettiin päivämääränä
  await expect(table).toContainText('2024-03-01')
  const dsl = dialog.getByTestId('import-dsl')
  await expect(dsl).toContainText('+ Pyyntö')
  await expect(dsl).toContainText(
    '- Tarkista rahoitus @HR [Rekrysysteemi, Excel] =1 h ^2 pv ~arvaus',
  )
  // Toinen välilehti on valittavissa
  await dialog.getByLabel('Taulukkovälilehti').selectOption({ label: 'Muu' })
  await dialog.getByLabel('Taulukkovälilehti').selectOption({ label: 'Rekrytointi' })

  await dialog.getByTestId('import-table-apply').click()
  // Pikasyöte aukeaa valmiiksi täytettynä, ja esikatselu on valmis
  await expect(page.getByLabel('Kirjoita tai liitä prosessin kuvaus')).toHaveValue(/\+ Pyyntö/)
  await expect(page.getByTestId('quick-summary')).toContainText('uutta')
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('.react-flow__node', { hasText: 'Pyyntö' })).toBeVisible()
  // Alaprosessi avataan ja sen sisällä on vaiheet kestoineen
  await page.locator('.react-flow__node', { hasText: 'Pyyntö' }).dblclick()
  await expect(page.locator('.react-flow__node', { hasText: 'Tarkista rahoitus' })).toBeVisible()
  await expect(
    page.locator('.react-flow__node', { hasText: 'Tarkista rahoitus' }).locator('.node__time'),
  ).toContainText('1 h')
})

test('taulukon liittäminen leikepöydältä ja sarakkeen käsin yhdistäminen', async ({ page }) => {
  const dialog = await openImport(page)
  await dialog
    .getByTestId('import-table-paste')
    .fill('Tarkista lasku\tTalous\t30 min\nHyväksy lasku\tEsimies\t2 h')
  // Ei otsikkoriviä: ensimmäinen sarake on vaihe, loput määritetään käsin
  await expect(dialog.getByLabel('Sarake 1')).toHaveValue('step')
  await dialog.getByLabel('Sarake 2').selectOption('role')
  await dialog.getByLabel('Sarake 3').selectOption('duration')
  await expect(dialog.getByTestId('import-dsl')).toContainText('- Tarkista lasku @Talous =30 min')
  await expect(dialog.getByTestId('import-dsl')).toContainText('- Hyväksy lasku @Esimies =2 h')
  await dialog.getByTestId('import-table-apply').click()
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('.react-flow__node', { hasText: 'Hyväksy lasku' })).toBeVisible()
})

test('BPMN: tuonti uutena projektina uimaratoineen ja päätöksineen', async ({ page }) => {
  const dialog = await openImport(page)
  await dialog.getByRole('radio', { name: 'Kaavio (BPMN, Mermaid)' }).click()
  await dialog.getByTestId('import-diagram-file').setInputFiles('e2e/fixtures/matkalasku.bpmn')
  const summary = dialog.getByTestId('import-summary')
  await expect(summary).toContainText('matkalasku.bpmn')
  await expect(summary).toContainText('1 päätöstä')
  await expect(summary).toContainText('2 roolia')
  await dialog.getByTestId('import-diagram-apply').click()
  await expect(page.locator('.project-btn strong')).toContainText('Matkalasku')
  await expect(page.locator('.react-flow__node', { hasText: 'Täytä matkalasku' })).toBeVisible()
  await expect(page.locator('.node__role', { hasText: 'Talous' }).first()).toBeVisible()
  await expect(page.locator('.react-flow__node', { hasText: 'Kuitit kunnossa?' })).toBeVisible()
  await expect(page.locator('.react-flow__edge')).toHaveCount(6)
})

test('Mermaid: liittäminen ja lisäys nykyiseen prosessiin, kumottavissa', async ({ page }) => {
  const dialog = await openImport(page)
  await dialog.getByRole('radio', { name: 'Kaavio (BPMN, Mermaid)' }).click()
  await dialog
    .getByTestId('import-diagram-paste')
    .fill(
      'flowchart TD\n  A([Alku]) --> B[Vastaanota tilaus]\n  B --> C{Kunnossa?}\n  C -->|Kyllä| D[Toimita]\n  C -->|Ei| B',
    )
  await expect(dialog.getByTestId('import-summary')).toContainText('2 vaihetta')
  await dialog.getByLabel(/Lisää nykyiseen prosessiin/).check()
  await dialog.getByTestId('import-diagram-apply').click()
  await expect(page.locator('.react-flow__node', { hasText: 'Vastaanota tilaus' })).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.react-flow__node')).toHaveCount(0)
})

test('virheellinen kaaviotiedosto antaa selkeän virheen', async ({ page }) => {
  const dialog = await openImport(page)
  await dialog.getByRole('radio', { name: 'Kaavio (BPMN, Mermaid)' }).click()
  await dialog.getByTestId('import-diagram-paste').fill('<html><body>ei bpmn</body></html>')
  await expect(dialog).toContainText('definitions')
  await expect(dialog.getByTestId('import-diagram-apply')).toBeDisabled()
})

test('PowerPoint ja sähköposti lähteiksi, ja vanhasta Office-muodosta kerrotaan', async ({
  page,
}) => {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles('e2e/fixtures/hankinta.pptx')
  await expect(page.getByTestId('reader')).toContainText('Hankintaprosessi')
  await expect(page.getByTestId('reader')).toContainText('Esimies tekee hankintapyynnön')
  await expect(page.getByTestId('reader')).toContainText('Muista mainita 5000 euron raja')

  await page.getByTestId('source-file-input').setInputFiles('e2e/fixtures/lasku.eml')
  await expect(page.getByTestId('reader')).toContainText('Aihe: Laskun hyväksyntä')
  await expect(page.getByTestId('reader')).toContainText('lähettää sen esimiehelle hyväksyttäväksi')
  await expect(page.getByTestId('reader')).toContainText('Lähettäjä: Matti Meikäläinen')

  await page.getByTestId('source-file-input').setInputFiles({
    name: 'vanha.doc',
    mimeType: 'application/msword',
    buffer: Buffer.from('x'),
  })
  await expect(page.getByRole('alert')).toContainText('Vanha Office-muoto')
})
