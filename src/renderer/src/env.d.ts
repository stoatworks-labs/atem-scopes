/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCOPES_BACKEND: 'electron' | 'static'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
