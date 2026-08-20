import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * The support footer, appended here and not in src/renderer/index.html.
 *
 * That file is the Electron renderer's entry as well as this one's, so a tag in
 * the markup would ship the funding footer inside the desktop app — asking for
 * money in a window belonging to someone who has already installed it. This
 * config is the hosted target and nothing else builds through it, so the tag
 * cannot reach Electron from here.
 *
 * data-hosted rides along on <html> for the same reason: styles.css locks the
 * viewport with `height: 100%` plus `overflow: hidden`, which would leave a
 * footer appended after #root unreachable, and that lock has to stay for the
 * desktop window.
 */
function supportFooter(): Plugin {
  return {
    name: 'stoatworks-support-footer',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return {
          html: html.replace('<html lang="en">', '<html lang="en" data-hosted>'),
          tags: [
            {
              tag: 'script',
              injectTo: 'body',
              attrs: {
                src: '/support-footer.js',
                defer: true,
                'data-app': 'atem-scopes',
                'data-repo': 'https://github.com/stoatworks-labs/atem-scopes',
                'data-version': `v${pkg.version}`,
                'data-note':
                  'It runs entirely in your browser — the video is measured on your machine and never leaves it.'
              }
            }
          ]
        }
      }
    }
  }
}

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
  plugins: [react(), supportFooter()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
