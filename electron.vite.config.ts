import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // The same public directory as the hosted build (vite.static.config.ts), so
    // the About dialog's two vendored files exist in one place and the desktop
    // and browser builds cannot end up carrying different copies.
    publicDir: resolve(__dirname, 'public'),
    define: {
      // The version the build produced. See public/about.js.
      __APP_VERSION__: JSON.stringify(`v${pkg.version}`),
      // The backend is chosen at build time, never sniffed at runtime, so the
      // hosted bundle contains no Electron-facing code at all.
      'import.meta.env.VITE_SCOPES_BACKEND': JSON.stringify('electron')
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
