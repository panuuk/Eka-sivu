import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

// Pilviympäristössä esiasennettu selain; muualla Playwrightin oma.
const preinstalled = '/opt/pw-browsers/chromium'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    viewport: { width: 1360, height: 820 },
    // Palvelutyöntekijä estetään oletuksena, jottei välimuisti sotke testejä (PWA-testit sallivat sen).
    serviceWorkers: 'block',
    launchOptions: existsSync(preinstalled)
      ? { executablePath: preinstalled, args: ['--no-sandbox'] }
      : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
