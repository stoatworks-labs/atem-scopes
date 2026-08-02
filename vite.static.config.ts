import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * The hosted target: the same renderer, backed by src/web/staticApi.ts instead
 * of the preload bridge. No switcher link and no DeckLink — see
 * `Capabilities`; the UI hides what it cannot do rather than offering it.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: resolve(__dirname, 'public'),
  define: {
    // The version the build produced. about-data.js carries one baked at sync
    // time as a fallback, and it goes stale the moment a release is tagged;
    // this is the one that is always right. See public/about.js.
    __APP_VERSION__: JSON.stringify(`v${pkg.version}`),
    'import.meta.env.VITE_SCOPES_BACKEND': JSON.stringify('static')
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
