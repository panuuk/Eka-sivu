import type { Page } from '@playwright/test'

/** Lataa projektin JSON-tiedostona tallennusikkunan kautta (ei enää omaa valikkokohtaa). */
export async function downloadJson(page: Page) {
  await page.getByRole('button', { name: 'Projektit' }).click()
  await page.getByRole('menuitem', { name: 'Tallennus ja varmuuskopiot…' }).click()
  await page.getByRole('button', { name: 'Lataa JSON-tiedosto' }).click()
  await page.keyboard.press('Escape')
}
