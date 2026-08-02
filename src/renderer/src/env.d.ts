/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCOPES_BACKEND: 'electron' | 'static'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected by the vite configs from package.json. Shown in the About dialog. */
declare const __APP_VERSION__: string

interface Window {
  STOATWORKS_ABOUT?: Record<string, string>
}
