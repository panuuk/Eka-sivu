/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ocrAssetsPlugin } from './build/ocrAssets'
import { serviceWorkerPlugin } from './build/serviceWorker'

// Suhteellinen base-polku, jotta sovellus toimii myös alihakemistossa (esim. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react(), ocrAssetsPlugin(), serviceWorkerPlugin()],
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
})
