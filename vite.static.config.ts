import { resolve } from 'path'
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite'
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
 * What search engines and LLM fetchers read: a title that says what this is, a
 * description, the canonical address, a share card, the JSON-LD the main site
 * uses for the same project (same @id form, so the two merge into one entity),
 * and a <noscript> body for readers that never run the app's JavaScript.
 *
 * Here and not in src/renderer/index.html for the support footer's reason: that
 * file is the Electron renderer's entry too, and its <title> is the desktop
 * window's title.
 */
const HOST = 'https://atem-scopes.stoatworks-labs.com'
const PAGE = 'https://stoatworks-labs.com/software/atem-scopes/'
const REPO = 'https://github.com/stoatworks-labs/atem-scopes'
const TITLE = 'atem-scopes — Scopes around an ATEM multiview'
const DESCRIPTION =
  'Video scopes around a live ATEM multiview: waveform, vectorscope, histogram, false colour, zebras and focus peaking. Free, and it runs in your browser; the video never leaves your machine.'

function hostedHead(): Plugin {
  const meta = (key: 'name' | 'property', name: string, content: string): HtmlTagDescriptor => ({
    tag: 'meta',
    injectTo: 'head',
    attrs: { [key]: name, content }
  })
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${HOST}#app`,
    name: 'atem-scopes',
    url: HOST,
    description: DESCRIPTION,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (runs in a web browser)',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' },
    author: {
      '@id': 'https://stoatworks-labs.com/#organization',
      '@type': 'Organization',
      name: 'Stoatworks Labs',
      url: 'https://stoatworks-labs.com/'
    },
    publisher: { '@id': 'https://stoatworks-labs.com/#organization' },
    sameAs: [PAGE, REPO]
  }
  const noscript = [
    '<h1>atem-scopes</h1>',
    "<p>Video scopes laid out around a live ATEM multiview. Waveform, vectorscope, histogram, false colour, zebras and focus peaking on any multiview window, program and preview included, with each source named live from the switcher's own multiviewer config. There's a desktop app and a browser build.</p>",
    "<p>This is the browser build, and it needs JavaScript and WebGL2. It captures the multiview over USB; naming sources live from the switcher is the desktop app's job, because the ATEM protocol is UDP and a web page can't send UDP.</p>",
    `<p><a href="${PAGE}">Project page</a> · <a href="${PAGE}guide/">User guide</a> · <a href="${REPO}">Source on GitHub</a></p>`
  ].join('')
  return {
    name: 'stoatworks-hosted-head',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return {
          html: html.replace('<title>atem-scopes</title>', `<title>${TITLE}</title>`),
          tags: [
            meta('name', 'description', DESCRIPTION),
            { tag: 'link', injectTo: 'head', attrs: { rel: 'canonical', href: `${HOST}/` } },
            meta('property', 'og:type', 'website'),
            meta('property', 'og:site_name', 'Stoatworks Labs'),
            meta('property', 'og:title', TITLE),
            meta('property', 'og:description', DESCRIPTION),
            meta('property', 'og:url', `${HOST}/`),
            meta('property', 'og:image', 'https://stoatworks-labs.com/thumbs/atem-scopes.png'),
            meta('property', 'og:image:width', '1280'),
            meta('property', 'og:image:height', '720'),
            meta('property', 'og:image:alt', 'atem-scopes'),
            meta('name', 'twitter:card', 'summary_large_image'),
            {
              tag: 'script',
              injectTo: 'head',
              attrs: { type: 'application/ld+json' },
              children: JSON.stringify(jsonLd)
            },
            { tag: 'noscript', injectTo: 'body-prepend', children: noscript }
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
  plugins: [react(), supportFooter(), hostedHead()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
