import { expect, test, type Page, type Route } from '@playwright/test'

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

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

/** Jäljittelee paikallista OpenAI-yhteensopivaa palvelinta: jokainen lause, jossa on "-aa"/"-ää"-verbi, on vaihe. */
async function mockLlm(page: Page, opts: { rejectSchema?: boolean } = {}) {
  const requests: { schema: boolean; text: string }[] = []
  await page.route('http://localhost:11434/**', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (req.url().endsWith('/v1/models'))
      return route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 'mock-3b' }, { id: 'mock-8b' }] }),
      })
    const body = JSON.parse(req.postData() ?? '{}')
    const text = body.messages?.[1]?.content as string
    const schema = body.response_format?.type === 'json_schema'
    requests.push({ schema, text })
    if (schema && opts.rejectSchema)
      return route.fulfill({
        status: 400,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: '{"error":{"message":"no schema"}}',
      })
    const sentences = (text.match(/[^.!?\n]+[.!?]/g) ?? [])
      .map((s) => s.trim())
      .filter((s) => /(aa|ää|ee|ii|yy|uu|oo)\b/.test(s))
    const steps = sentences.map((s) => ({
      kind: 'step',
      label: s.split(' ').slice(0, 3).join(' '),
      quote: s.replace(/[.!?]$/, ''),
      role: /^Esimies/.test(s) ? 'Esimies' : '',
      systems: /ERP/.test(s) ? ['ERP'] : [],
      branch: 'none',
    }))
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ steps }) } }] }),
    })
  })
  return requests
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
  await fresh(page)
})

const TEXT = `Ostoreskontra tarkistaa laskun ERP-järjestelmästä. Esimies hyväksyy laskun kahden päivän kuluessa. Lopuksi lasku kirjataan.`

async function openSource(page: Page) {
  await page.getByRole('radio', { name: 'Lähteet' }).click()
  await page.getByTestId('source-file-input').setInputFiles({
    name: 'kuvaus.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(TEXT, 'utf8'),
  })
  await expect(page.getByTestId('reader')).toBeVisible()
}

test('kielimalli: yhteys, ajo lähteelle ja ehdotukset samassa hyväksynnässä lähdeviitteineen', async ({
  page,
}) => {
  const requests = await mockLlm(page)
  await openSource(page)
  const panel = page.getByTestId('llm-panel')
  await panel.locator('summary').click()
  await expect(panel.getByTestId('llm-remote-warning')).toHaveCount(0)
  await panel.getByTestId('llm-connect').click()
  await expect(panel.getByLabel('Kielimalli', { exact: true })).toHaveValue('mock-3b')
  await panel.getByLabel('Kielimalli', { exact: true }).selectOption('mock-8b')

  await panel.getByTestId('llm-run').click()
  await expect(panel.getByTestId('llm-result')).toBeVisible()
  await expect(panel.getByTestId('llm-result')).toContainText('mock-8b')
  expect(requests[0].schema).toBe(true)
  expect(requests[0].text).toContain('Ostoreskontra tarkistaa')
  // Ehdotukset tulevat kielimallilta ja ne voi lisätä kuten muutkin
  await expect(page.locator('.suggestion__why').first()).toContainText('kielimalli')
  const suggestions = page.locator('.suggestion')
  await expect(suggestions).toHaveCount(2) // "kirjataan" ei täsmää mock-palvelimen sääntöön
  await page.getByRole('button', { name: /Lisää kaikki/ }).click()
  await page.getByRole('radio', { name: 'Kaavio', exact: true }).click()
  await expect(
    page.locator('.react-flow__node', { hasText: 'Esimies hyväksyy laskun' }),
  ).toBeVisible()
  // Esimies-rooli ja ERP syntyivät nimestä
  await expect(page.locator('.node__role', { hasText: 'Esimies' })).toBeVisible()
  // Lähdeviite säilyi: vaiheesta pääsee tekstin kohtaan
  await page.locator('.react-flow__node', { hasText: 'Esimies hyväksyy laskun' }).click()
  await page.getByRole('button', { name: 'Avaa lähteessä' }).click()
  await expect(page.locator('.m-focus').first()).toBeVisible()
  const focused = (await page.locator('.m-focus').allInnerTexts()).join('')
  expect(focused).toContain('Esimies hyväksyy laskun')
})

test('kielimalli: kevennys, kun palvelin ei tue skeemaa, ja paluu sääntöihin', async ({ page }) => {
  const requests = await mockLlm(page, { rejectSchema: true })
  await openSource(page)
  const panel = page.getByTestId('llm-panel')
  await panel.locator('summary').click()
  await panel.getByLabel('Kielimalli', { exact: true }).fill('mock-3b')
  await panel.getByTestId('llm-run').click()
  await expect(panel.getByTestId('llm-result')).toBeVisible()
  expect(requests.map((r) => r.schema)).toEqual([true, false])
  const llmCount = await page.locator('.suggestion').count()
  expect(llmCount).toBeGreaterThan(0)
  await panel.getByRole('radio', { name: 'Säännöt' }).click()
  await expect(page.locator('.suggestion__why').first()).not.toContainText('kielimalli')
})

test('kielimalli: virhe näkyy selkeästi, ja ei-paikallinen osoite vaatii vahvistuksen', async ({
  page,
}) => {
  await openSource(page)
  const panel = page.getByTestId('llm-panel')
  await panel.locator('summary').click()
  // Ei palvelinta: yhteys epäonnistuu ja neuvoo CORSista
  await panel.getByTestId('llm-connect').click()
  await expect(panel).toContainText('OLLAMA_ORIGINS')

  await panel.getByLabel('Kielimallin osoite').fill('https://kielimalli.example.com/v1')
  await expect(panel.getByTestId('llm-remote-warning')).toBeVisible()
  await panel.getByLabel('Kielimalli', { exact: true }).fill('x')
  await panel.getByTestId('llm-run').click()
  const confirm = page.getByRole('dialog', { name: 'Osoite ei ole omalla koneellasi' })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('poistuu koneeltasi')
  await confirm.getByRole('button', { name: 'Peruuta' }).click()
  // Peruttu: mitään ei lähetetty eikä tulosta syntynyt
  await expect(panel.getByTestId('llm-result')).toHaveCount(0)
})

test('kielimalli: mittaus arviointiaineistolla vertaa sääntöihin', async ({ page }) => {
  test.setTimeout(90_000)
  await mockLlm(page)
  await openSource(page)
  const panel = page.getByTestId('llm-panel')
  await panel.locator('summary').click()
  await panel.getByLabel('Kielimalli', { exact: true }).fill('mock-3b')
  await panel.getByTestId('llm-benchmark').click()
  const bench = panel.getByTestId('llm-bench')
  await expect(bench).toBeVisible({ timeout: 60_000 })
  await expect(bench).toContainText('Rekrytointi')
  await expect(bench).toContainText('Keskiarvo (F1)')
  await expect(bench.locator('tbody tr')).toHaveCount(13)
  await expect(panel.getByTestId('llm-verdict')).toContainText(/sääntö|Säännöt|kielimalli/i)
})
