import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// The About dialog's data file ships a version baked at sync time; this is the
// one the build actually produced. Spread, not assign: about-data.js may not
// have run yet, and it merges rather than overwriting. See public/about.js.
window.STOATWORKS_ABOUT = { ...window.STOATWORKS_ABOUT, version: __APP_VERSION__ }

/**
 * Backend selection happens here, at build time, and nowhere else.
 *
 * `VITE_SCOPES_BACKEND` is a define, not an environment read, so the branch is
 * resolved by the bundler: the hosted build contains no Electron-facing code
 * and the desktop build contains no localStorage fallback. Nothing at runtime
 * asks which environment it is in — see simpleVIS, which learned this the same
 * way. Components branch on `window.api.capabilities`, never on the backend.
 */
async function boot(): Promise<void> {
  if (import.meta.env.VITE_SCOPES_BACKEND === 'static') {
    const { staticApi } = await import('../../web/staticApi')
    window.api = staticApi
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

boot()
