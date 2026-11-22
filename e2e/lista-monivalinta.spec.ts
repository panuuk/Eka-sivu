import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function openList(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.topbar')
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await page.waitForSelector('.react-flow__node')
  await page.getByRole('radio', { name: 'Lista' }).click()
  await expect(page.getByTestId('listview')).toBeVisible()
}

const rowCount = (page: Page) => page.locator('[data-testid="listview"] tbody tr').count()

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e
  })
})

test('roskakori kysyy vahvistuksen: Peruuta säilyttää vaiheen, Poista poistaa ja Ctrl+Z palauttaa', async ({
  page,
}) => {
  await openList(page)
  const before = await rowCount(page)
  const trash = page.getByRole('button', { name: 'Poista Vastaanota lasku' })

  await trash.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Poistetaanko vaihe “Vastaanota lasku”?')
  await dialog.getByRole('button', { name: 'Peruuta' }).click()
  await expect(dialog).toHaveCount(0)
  expect(await rowCount(page)).toBe(before)

  await trash.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Poista' }).click()
  await expect.poll(() => rowCount(page)).toBe(before - 1)

  await page.keyboard.press('Control+z')
  await expect.poll(() => rowCount(page)).toBe(before)
})

test('useamman vaiheen valinta valintaruuduilla, Shift-alueella ja kaikki kerralla, ja yhteinen poisto', async ({
  page,
}) => {
  await openList(page)
  const before = await rowCount(page)
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0)

  // Kaksi ruutua → toimintopalkki
  await page.getByRole('checkbox', { name: 'Valitse Vastaanota lasku' }).check()
  await page.getByRole('checkbox', { name: 'Valitse Tarkista laskun tiedot' }).check()
  await expect(page.getByTestId('bulk-bar')).toContainText('2 vaihetta valittu')

  // Shift+napsautus laajentaa alueeksi
  await page
    .getByRole('checkbox', { name: 'Valitse Hyväksyntäkierto' })
    .click({ modifiers: ['Shift'] })
  await expect(page.getByRole('checkbox', { name: 'Valitse Tiedot kunnossa?' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Valitse Hyväksyntäkierto' })).toBeChecked()
  await expect(page.getByTestId('bulk-bar')).toContainText(/\d vaihetta valittu/)
  const n = Number((await page.getByTestId('bulk-bar').innerText()).match(/(\d+) vaihetta/)![1])
  expect(n).toBeGreaterThan(2)

  // Tyhjennä, sitten valitse kaikki
  await page.getByRole('button', { name: 'Tyhjennä valinta' }).click()
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0)
  await page.getByTestId('list-select-all').check()
  await expect(page.getByTestId('bulk-bar')).toContainText(`${before} vaihetta valittu`)
  await page.getByTestId('list-select-all').uncheck()
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0)

  // Poisto vaatii vahvistuksen ja poistaa kaikki valitut kerralla
  await page.getByRole('checkbox', { name: 'Valitse Vastaanota lasku' }).check()
  await page.getByRole('checkbox', { name: 'Valitse Tarkista laskun tiedot' }).check()
  await page.getByTestId('bulk-delete').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Poistetaanko 2 vaihetta?')
  await dialog.getByRole('button', { name: 'Peruuta' }).click()
  expect(await rowCount(page)).toBe(before)

  await page.getByTestId('bulk-delete').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Poista' }).click()
  await expect.poll(() => rowCount(page)).toBe(before - 2)
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0)

  // Yksi kumoaa koko joukkopoiston
  await page.keyboard.press('Control+z')
  await expect.poll(() => rowCount(page)).toBe(before)
})

test('Ctrl+napsautus rivillä lisää valintaan ja alaprosessin poisto mainitaan vahvistuksessa', async ({
  page,
}) => {
  await openList(page)
  await page.getByRole('cell', { name: 'Vastaanota lasku' }).first().click()
  await page
    .getByRole('cell', { name: 'Tarkista laskun tiedot' })
    .first()
    .click({ modifiers: ['Control'] })
  await expect(page.getByTestId('bulk-bar')).toContainText('2 vaihetta valittu')

  await page.getByRole('button', { name: 'Tyhjennä valinta' }).click()
  await page.getByRole('button', { name: 'Poista Hyväksyntäkierto' }).click()
  await expect(page.getByRole('dialog')).toContainText('sisältää alaprosessin')
  await page.getByRole('dialog').getByRole('button', { name: 'Peruuta' }).click()
})
