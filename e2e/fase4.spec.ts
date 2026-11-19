import { readFileSync } from 'node:fs'
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

const TEXT = `Ostolasku saapuu verkkolaskuoperaattorilta ostoreskontraan. Ostoreskontra tarkistaa laskun tiedot ERP-järjestelmästä. Jos tiedot eivät täsmää, laskuttajalle lähetetään korjauspyyntö. Muussa tapauksessa lasku lähetetään esimiehelle hyväksyttäväksi. Esimies hyväksyy laskun. Lopuksi lasku kirjataan ja viedään maksuun.`

async function openSources(page: Page) {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await expect(page.getByText('Ei vielä lähteitä')).toBeVisible()
}

async function importText(page: Page, name = 'kuvaus.txt', text = TEXT) {
  await page.getByTestId('source-file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') })
  await expect(page.getByTestId('reader')).toBeVisible()
}

/** Valitsee tekstin lukijasta ja laukaisee valinnan käsittelyn. */
async function selectText(page: Page, phrase: string) {
  await page.evaluate((p) => {
    const root = document.querySelector('[data-testid=reader]')!
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let full = ''
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n as Text)
      full += (n as Text).data
    }
    const idx = full.indexOf(p)
    if (idx < 0) throw new Error('Tekstiä ei löydy: ' + p)
    const locate = (offset: number): [Text, number] => {
      let acc = 0
      for (const n of nodes) {
        if (offset <= acc + n.data.length) return [n, offset - acc]
        acc += n.data.length
      }
      throw new Error('offset')
    }
    const [sn, so] = locate(idx)
    const [en, eo] = locate(idx + p.length)
    const range = document.createRange()
    range.setStart(sn, so)
    range.setEnd(en, eo)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, phrase)
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

test('tekstitiedoston tuonti ja ehdotukset: lisää kaikki muodostaa haarautuvan prosessin', async ({ page }) => {
  await openSources(page)
  await importText(page)
  await expect(page.getByTestId('reader')).toContainText('Ostolasku saapuu')
  await expect(page.getByRole('tab', { name: /Ehdotukset \(\d+\)/ })).toBeVisible()
  await page.getByRole('button', { name: /Lisää kaikki/ }).click()

  // Ehdotukset on käytetty, joten ne eivät enää näy ehdotuksina
  await expect(page.getByText('Ei uusia ehdotuksia')).toBeVisible()
  await page.getByRole('radio', { name: 'Kaavio' }).click()
  // alku, 5 vaihetta/päätös + 2 haaraa, loppu
  await expect(page.locator('.react-flow__node[data-id]')).not.toHaveCount(0)
  await expect(page.locator('.node--decision')).toHaveCount(1)
  await expect(page.locator('.react-flow__node', { hasText: 'Esimies hyväksyy laskun' })).toBeVisible()

  // Takaisin lähteeseen solmun viitteestä
  await page.locator('.react-flow__node', { hasText: 'Esimies hyväksyy laskun' }).click()
  await page.getByRole('button', { name: 'Avaa lähteessä' }).click()
  await expect(page.getByTestId('sources-view')).toBeVisible()
  await expect(page.locator('.m-focus')).toContainText('Esimies hyväksyy laskun')
})

test('valinnasta luodaan vaihe, jonka viite näkyy lähteessä ja viitteet-välilehdellä', async ({ page }) => {
  await openSources(page)
  await importText(page)
  await selectText(page, 'Esimies hyväksyy laskun')
  await expect(page.locator('.sel-quote')).toContainText('Esimies hyväksyy laskun')
  await page.getByRole('button', { name: 'Luo vaihe' }).click()
  await expect(page.locator('.sources__added')).toContainText('Esimies hyväksyy laskun')
  await expect(page.locator('[data-testid=reader] .m-ref')).toContainText('Esimies hyväksyy laskun')
  await page.getByRole('tab', { name: /Viitteet/ }).click()
  await expect(page.locator('.ref-list')).toContainText('Esimies hyväksyy laskun')
})

test('Word- ja PDF-tiedostojen tuonti', async ({ page, browser }) => {
  await openSources(page)
  await page.getByTestId('source-file-input').setInputFiles('e2e/fixtures/ostolasku.docx')
  await expect(page.getByTestId('reader')).toContainText('Ostoreskontra tarkistaa laskun tiedot')
  await expect(page.locator('#source-select')).toContainText('ostolasku')

  // Luo PDF selaimella ja tuo se
  const ctx = await browser.newContext()
  const pdfPage = await ctx.newPage()
  await pdfPage.setContent(
    `<html><body style="font-family:sans-serif"><h1>Tilausprosessi</h1><p>Myynti vastaanottaa tilauksen. Talous tarkistaa luottotiedot.</p><p>Lopuksi tilaus lähetetään asiakkaalle.</p></body></html>`,
  )
  const pdf = await pdfPage.pdf({ format: 'A4' })
  await ctx.close()
  await page.getByTestId('source-file-input').setInputFiles({ name: 'tilaus.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(page.locator('#source-select')).toContainText('tilaus')
  await expect(page.getByTestId('reader')).toContainText('Myynti vastaanottaa tilauksen')
  await expect(page.getByTestId('reader')).toContainText('Talous tarkistaa luottotiedot')
})

test('virheellinen ja liian outo tiedosto antaa selkeän virheen', async ({ page }) => {
  await openSources(page)
  await page.getByTestId('source-file-input').setInputFiles({ name: 'kuva.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) })
  await expect(page.getByRole('alert')).toContainText('ei tueta')
  await page.getByTestId('source-file-input').setInputFiles({ name: 'tyhja.txt', mimeType: 'text/plain', buffer: Buffer.from('   ') })
  await expect(page.getByRole('alert')).toContainText('ei löytynyt tekstiä')
})

test('muistiinpanon muokkaus säilyttää viitteet, kun teksti lisätään niiden eteen', async ({ page }) => {
  await openSources(page)
  await page.getByRole('button', { name: 'Kirjoita muistiinpano' }).click()
  await page.getByLabel('Otsikko').fill('Haastattelu')
  await page.getByRole('button', { name: 'Luo' }).click()
  const area = page.getByLabel('Lähdetekstin muokkaus')
  await area.fill('Myyjä kirjaa tilauksen järjestelmään.')
  await page.getByRole('button', { name: 'Valmis' }).click()
  await selectText(page, 'Myyjä kirjaa tilauksen')
  await page.getByRole('button', { name: 'Luo vaihe' }).click()

  await page.getByRole('button', { name: 'Muokkaa tekstiä' }).click()
  await page.getByLabel('Lähdetekstin muokkaus').fill('Uusi johdanto.\n\nMyyjä kirjaa tilauksen järjestelmään.')
  await page.getByRole('button', { name: 'Valmis' }).click()
  await expect(page.locator('[data-testid=reader] .m-ref')).toContainText('Myyjä kirjaa tilauksen')
  await page.getByRole('tab', { name: /Viitteet/ }).click()
  await expect(page.locator('.is-stale')).toHaveCount(0)

  // Jos lainaus poistetaan kokonaan, viite näytetään vanhentuneena
  await page.getByRole('button', { name: 'Muokkaa tekstiä' }).click()
  await page.getByLabel('Lähdetekstin muokkaus').fill('Aivan toinen teksti.')
  await page.getByRole('button', { name: 'Valmis' }).click()
  await expect(page.locator('.is-stale')).toHaveCount(1)
})

test('lähteen poisto säilyttää vaiheet mutta poistaa viitteet', async ({ page }) => {
  await openSources(page)
  await importText(page)
  await selectText(page, 'Esimies hyväksyy laskun')
  await page.getByRole('button', { name: 'Luo vaihe' }).click()
  await page.getByRole('button', { name: 'Lähteen toiminnot' }).click()
  await page.getByRole('menuitem', { name: /Poista lähde/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Poista' }).click()
  await expect(page.getByText('Ei vielä lähteitä')).toBeVisible()
  await page.getByRole('radio', { name: 'Kaavio' }).click()
  await expect(page.locator('.react-flow__node', { hasText: 'Esimies hyväksyy laskun' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Avaa lähteessä' })).toHaveCount(0)
})

test.afterAll(() => {
  // varmistaa että fixture on olemassa
  readFileSync('e2e/fixtures/ostolasku.docx')
})
