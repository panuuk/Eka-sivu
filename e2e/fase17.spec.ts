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

const MD = `# Tarjousprosessi

Tämä dokumentti kuvaa B2B-tarjousprosessin vastaanotosta lähettämiseen.

\`\`\`mermaid
flowchart TD
  A[1. Vastaanotto] --> B[2. Laadinta]
\`\`\`

## Roolit ja vastuut

| Rooli | Keskeinen vastuu |
| :--- | :--- |
| **Myyjä** | Asiakasyhteys ja lähettäminen |

### 1. Vastaanotto
- **Tavoite:** Varmistaa, että pyyntö kirjataan.
- **Tuotos:** CRM-kirjaus, kansiorakenne ja vastuuhenkilö
- **Tarkistuslista:**
  Liitteet tallennettu

### 2. Laadinta
- **Tavoite:** Tuottaa tarjous.

## Laadunvarmistus
- Kaikkiin vaatimuksiin on vastattu.
`

test('dokumentin rakenne tulee malliin: prosessikortti, roolin kuvaus ja vaiheen tarkistuslista', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(MD)
  await page.getByRole('button', { name: 'Muunna vaiheiksi' }).click()
  const area = page.getByLabel('Kirjoita tai liitä prosessin kuvaus')
  await expect(area).toHaveValue(/:tarkoitus Tämä dokumentti kuvaa/)
  await expect(area).toHaveValue(/:rooli Myyjä: Asiakasyhteys ja lähettäminen/)
  await expect(area).toHaveValue(/:tarkistus Kaikkiin vaatimuksiin on vastattu\./)
  await expect(page.getByTestId('quick-summary')).toContainText('prosessikortti päivittyy')
  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)

  // Prosessikortti on prosessin ominaisuuksissa ja tallentuu, kun kohdistus poistuu kortista
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Ominaisuudet' }).click()
  await expect(page.getByTestId('card-section')).toHaveAttribute('open', '')
  await expect(page.getByTestId('card-purpose')).toHaveValue(/B2B-tarjousprosessin/)
  await expect(page.getByTestId('card-checklist')).toHaveValue('Kaikkiin vaatimuksiin on vastattu.')
  await page.getByTestId('card-owner').fill('Talousjohtaja')
  await page.getByTestId('card-risks').fill('Määräaika ylittyy\nResurssit loppuvat')
  await page.getByLabel('Prosessin nimi').click()
  await page.getByLabel('Prosessin nimi').blur()
  // Kumoaminen palauttaa kortin aiemman sisällön myös kenttiin
  await page.getByRole('button', { name: 'Kumoa' }).click()
  await expect(page.getByTestId('card-owner')).toHaveValue('')
  await page.getByRole('button', { name: 'Tee uudelleen' }).click()
  await expect(page.getByTestId('card-owner')).toHaveValue('Talousjohtaja')
  await expect(page.getByTestId('card-risks')).toHaveValue('Määräaika ylittyy\nResurssit loppuvat')

  // Vaiheen tarkistuslista ja tuotokset näkyvät ominaisuuksissa
  await page.locator('.react-flow__node').filter({ hasText: 'Vastaanotto' }).first().click()
  await expect(page.getByTestId('node-checklist')).toHaveValue('Liitteet tallennettu')

  // Roolin kuvaus on roolinhallinnassa
  await page.getByRole('button', { name: 'Roolit, järjestelmät ja tuotokset' }).click()
  await expect(page.getByLabel('Kuvaus: Myyjä')).toHaveValue('Asiakasyhteys ja lähettäminen')
})

test('prosessikortti ja tarkistuslistat näkyvät dokumenttiviennissä ja palautuvat tekstinä', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page
    .getByLabel('Kirjoita tai liitä prosessin kuvaus')
    .fill(
      '# Lasku\n:tarkoitus Maksaa laskut ajallaan\n:rooli Talous: Maksaa\n- Maksa @Talous\n  :tarkistus IBAN oikein',
    )
  await page.getByTestId('quick-apply').click()
  await page.getByRole('button', { name: 'Pikasyöte' }).click()
  await page.getByRole('tab', { name: /Vie|Teksti/ }).click()
  const exported = page.locator('.quick__textarea')
  await expect(exported).toHaveValue(/:tarkoitus Maksaa laskut ajallaan/)
  await expect(exported).toHaveValue(/:rooli Talous: Maksaa/)
  await expect(exported).toHaveValue(/ {2}:tarkistus IBAN oikein/)
})
