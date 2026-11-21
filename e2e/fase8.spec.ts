import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

async function wipe(page: Page) {
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

const example = async (page: Page) => {
  await page.getByRole('button', { name: /Projektit/ }).click()
  await page.getByRole('menuitem', { name: 'Uusi esimerkkiprojektista' }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
}

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' })
  // Päivitystesti muokkaa dist/sw.js:ää, joten ryhmän testit ajetaan peräkkäin samassa työntekijässä.
  test.describe.configure({ mode: 'serial' })

  test('sovellus latautuu ja toimii ilman verkkoa', async ({ page, context }) => {
    await page.goto('/')
    await page.waitForSelector('.topbar')
    // Odota, että palvelutyöntekijä on asentunut ja ottanut sivun hallintaan
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r))
      }
    })
    await expect(page.getByTestId('offline-ready')).toBeVisible()

    await context.setOffline(true)
    await page.reload()
    await page.waitForSelector('.topbar')
    await example(page)
    // Työ tallentuu offline-tilassakin ja pysyy uudelleenlatauksen yli
    await page.reload()
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await context.setOffline(false)
  })

  test('manifesti on kelvollinen ja kuvakkeet löytyvät', async ({ page, request }) => {
    await page.goto('/')
    const href = await page.locator('link[rel=manifest]').getAttribute('href')
    const res = await request.get(new URL(href!, page.url()).href)
    const manifest = await res.json()
    expect(manifest.display).toBe('standalone')
    expect(manifest.lang).toBe('fi')
    for (const icon of manifest.icons) {
      const r = await request.get(new URL(icon.src, page.url()).href)
      expect(r.ok(), icon.src).toBe(true)
    }
  })

  test('uusi versio ilmoitetaan, ja päivitys tallentaa työn ja ottaa uuden version käyttöön', async ({
    page,
  }) => {
    const swPath = 'dist/sw.js'
    const original = readFileSync(swPath, 'utf8')
    try {
      await page.goto('/')
      await page.waitForSelector('.topbar')
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller) {
          await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r))
        }
      })
      await example(page)
      await expect(page.getByTestId('update-bar')).toHaveCount(0)

      // Julkaistaan "uusi versio": palvelutyöntekijän tiedosto muuttuu
      appendFileSync(swPath, '\n// uusi versio\n')
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration()
        await reg!.update()
      })
      await expect(page.getByTestId('update-bar')).toBeVisible()

      const reloaded = page.waitForEvent('load')
      await page.getByRole('button', { name: 'Päivitä nyt' }).click()
      await reloaded
      await page.waitForSelector('.topbar')
      await expect(page.locator('.react-flow__node').first()).toBeVisible() // työ säilyi
      await expect(page.getByTestId('update-bar')).toHaveCount(0)
    } finally {
      writeFileSync(swPath, original)
    }
  })
})

/** Korvaa tiedostovalitsimet selaimen omalla tiedostojärjestelmällä (OPFS), jotta kahvat toimivat testeissä. */
async function mockFilePickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    w.showSaveFilePicker = async (opts: { suggestedName: string }) => {
      const root = await navigator.storage.getDirectory()
      return root.getFileHandle(opts.suggestedName, { create: true })
    }
    w.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory()
      const name = sessionStorage.getItem('openName') ?? ''
      return [await root.getFileHandle(name)]
    }
  })
}

async function readOpfs(page: Page, name: string): Promise<string> {
  return page.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory()
    const f = await (await root.getFileHandle(n)).getFile()
    return f.text()
  }, name)
}

async function openStorage(page: Page) {
  await page.getByRole('button', { name: 'Tallennus ja varmuuskopiot' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Tallennus ja varmuuskopiot' })).toBeVisible()
}

test.describe('tallennus ja varmuuskopiot', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => {
      throw e
    })
    await mockFilePickers(page)
    await wipe(page)
  })

  test('automaattinen kopio, käsin otettu kopio ja palautus', async ({ page }) => {
    await example(page)
    const nodes = await page.locator('.react-flow__node').count()

    await openStorage(page)
    const dialog = page.getByRole('dialog', { name: 'Tallennus ja varmuuskopiot' })
    await expect(dialog.getByTestId('backup-row')).toHaveCount(1)
    await expect(dialog.getByTestId('backup-row')).toContainText('Automaattinen')
    await dialog.getByRole('button', { name: 'Ota kopio nyt' }).click()
    await expect(dialog.getByTestId('backup-row')).toHaveCount(2)
    await expect(dialog.getByTestId('backup-row').first()).toContainText('Käsin otettu')
    await page.keyboard.press('Escape')

    // Poistetaan vaihe ja palautetaan kopio
    await page.locator('.react-flow__node').first().click()
    await page.keyboard.press('Delete')
    await expect(page.locator('.react-flow__node')).toHaveCount(nodes - 1)

    await openStorage(page)
    await dialog.getByTestId('backup-row').first().getByRole('button', { name: 'Palauta' }).click()
    await page.getByRole('button', { name: 'Palauta', exact: true }).last().click()
    await expect(page.locator('.react-flow__node')).toHaveCount(nodes)

    // Palautus otti edellisen tilan talteen
    await openStorage(page)
    await expect(dialog.getByTestId('backup-row').first()).toContainText('Ennen palautusta')
  })

  test('poistetun projektin voi palauttaa varmuuskopiosta', async ({ page }) => {
    await example(page)
    const name = await page.locator('.project-btn strong').textContent()
    await page.getByRole('button', { name: /Projektit/ }).click()
    await page.getByRole('menuitem', { name: 'Poista projekti…' }).click()
    await page.getByRole('button', { name: 'Poista projekti' }).click()
    await expect(page.locator('.project-btn strong')).not.toHaveText(name!)

    await openStorage(page)
    const dialog = page.getByRole('dialog', { name: 'Tallennus ja varmuuskopiot' })
    const deleted = dialog.getByRole('list', { name: 'Poistettujen projektien kopiot' })
    await expect(deleted.getByTestId('backup-row').first()).toContainText('Poistetun projektin')
    await deleted
      .getByTestId('backup-row')
      .first()
      .getByRole('button', { name: 'Avaa kopiona' })
      .click()
    await expect(page.locator('.project-btn strong')).toContainText('kopio')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
  })

  test('tiedostoyhteys: tallentuu tiedostoon ja projekti palautuu tiedostosta tietojen tyhjennyksen jälkeen', async ({
    page,
  }) => {
    await example(page)
    await openStorage(page)
    const dialog = page.getByRole('dialog', { name: 'Tallennus ja varmuuskopiot' })
    await dialog.getByRole('button', { name: 'Yhdistä uuteen tiedostoon…' }).click()
    await expect(dialog.getByTestId('file-link')).toContainText('.prosessikartta.json')
    const fileName = (await dialog.getByTestId('file-link').locator('strong').textContent())!
    await expect(dialog.getByTestId('file-link')).toContainText('Viimeksi tallennettu')

    const first = JSON.parse(await readOpfs(page, fileName))
    expect(Object.keys(first.project.nodes).length).toBeGreaterThan(3)
    await page.keyboard.press('Escape')

    // Uusi vaihe pikasyötteellä päätyy tiedostoon
    await page.getByRole('button', { name: /Pikasyöte/ }).click()
    await page.getByLabel('Kirjoita tai liitä prosessin kuvaus').fill('- Uusi tiedostotestin vaihe')
    await page.getByTestId('quick-apply').click()
    await expect
      .poll(async () => (await readOpfs(page, fileName)).includes('Uusi tiedostotestin vaihe'), {
        timeout: 8000,
      })
      .toBe(true)
    await expect(page.locator('.save-status')).toContainText('tiedosto ✓')

    // Selaimen tietojen tyhjennys (OPFS säilyy, koska se esittää levyä)
    await page.evaluate(async () => {
      sessionStorage.setItem('openName', 'x')
    })
    await page.evaluate((n) => sessionStorage.setItem('openName', n), fileName)
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
    await expect(page.locator('.react-flow__node')).toHaveCount(0)

    await openStorage(page)
    await dialog.getByRole('button', { name: 'Avaa tiedostosta…' }).click()
    await expect(dialog.getByTestId('file-link')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.node', { hasText: 'Uusi tiedostotestin vaihe' })).toBeVisible()
  })

  test('tiedostokopion puuttumisesta muistutetaan ja muistutuksen voi siirtää', async ({
    page,
  }) => {
    // Rakennetaan yli viisi vaihetta ja vanhennetaan projekti, jotta muistutus on aiheellinen
    await example(page)
    await page.evaluate(async () => {
      const req = indexedDB.open('prosessikartta')
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => {
          const tx = req.result.transaction('projects', 'readwrite')
          const store = tx.objectStore('projects')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const row of all.result) {
              row.data.createdAt = Date.now() - 30 * 86400_000
              store.put(row)
            }
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      })
    })
    await page.reload()
    await expect(page.getByTestId('backup-reminder')).toBeVisible()
    await page.getByRole('button', { name: 'Muistuta viikon päästä' }).click()
    await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
    await page.reload()
    await page.waitForSelector('.topbar')
    await expect(page.getByTestId('backup-reminder')).toHaveCount(0)
  })

  test('JSON-lataus kirjaa tiedostokopion ajan', async ({ page }) => {
    await example(page)
    await openStorage(page)
    const dialog = page.getByRole('dialog', { name: 'Tallennus ja varmuuskopiot' })
    await expect(dialog.getByTestId('last-file-backup')).toContainText('ei ole vielä otettu')
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Lataa JSON-tiedosto' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.prosessikartta\.json$/)
    await expect(dialog.getByTestId('last-file-backup')).toContainText('Viimeisin tiedostokopio')
  })

  test('toisessa välilehdessä avattu sovellus varoitetaan', async ({ page, context }) => {
    await example(page)
    const other = await context.newPage()
    await other.goto('/')
    await other.waitForSelector('.topbar')
    await expect(other.getByTestId('other-tab-warning')).toBeVisible()
    await expect(page.getByTestId('other-tab-warning')).toBeVisible()
    await page.getByRole('button', { name: 'Ymmärrän' }).click()
    await expect(page.getByTestId('other-tab-warning')).toHaveCount(0)
    await other.close()
  })
})
