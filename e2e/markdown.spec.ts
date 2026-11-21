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

\`\`\`mermaid
flowchart TD
  A[1. Vastaanotto] --> B[2. Go / No-Go]
  B -->|No-Go| C[Kieltäytyminen]
  B -->|Go| D[3. Suunnittelu]
  D --> E[4. Lähettäminen]
\`\`\`

| Rooli | Vastuu |
| :--- | :--- |
| **Myyjä** | Asiakasyhteys |

## 1. Vastaanotto
- **Tavoite:** Kirjataan tarjouspyyntö.
`

test('Markdown-dokumentti muunnetaan vaiheiksi Mermaid-kaaviosta ennen lisäämistä', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Pikasyöte/ }).click()
  await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill(MD)
  await expect(page.getByTestId('markdown-hint')).toBeVisible()

  await page.getByRole('button', { name: 'Muunna vaiheiksi' }).click()
  await expect(page.getByTestId('markdown-done')).toContainText('Mermaid-kaaviosta')
  const area = page.getByLabel('Kirjoita tai liitä prosessin kuvaus')
  await expect(area).toHaveValue(/- Vastaanotto/)
  await expect(area).not.toHaveValue(/mermaid|\*\*/)
  await expect(area).toHaveValue(/\? Go \/ No-Go/)

  // Palautus tuo alkuperäisen takaisin
  await page.getByRole('button', { name: 'Palauta alkuperäinen' }).click()
  await expect(area).toHaveValue(/```mermaid/)
  await page.getByRole('button', { name: 'Muunna vaiheiksi' }).click()

  await page.getByTestId('quick-apply').click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Suunnittelu' })).toHaveCount(1)
  await expect(page.locator('.react-flow__node').filter({ hasText: 'mermaid' })).toHaveCount(0)
})
