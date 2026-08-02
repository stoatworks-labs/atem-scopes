import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    define: {
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
