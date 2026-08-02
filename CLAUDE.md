# atem-scopes

Video scopes around a live ATEM multiview. Electron + React + TypeScript + WebGL2, electron-vite
(node + web tsconfigs), vitest. Also ships a hosted static build on a Cloudflare Worker.

## Commands (npm)

- Electron dev: `npm run dev`
- Hosted build in a browser: `npm run preview:static` (no Electron needed)
- Hosted production build: `npm run static:build` -> `dist/` · deploy: `npm run deploy`
- Typecheck: `npm run typecheck` (node + web) — run this, not a bare `tsc`
- Test: `npm test` (vitest run) · `npm run test:watch`
- Lint / format: `npm run lint` · `npm run format`
- Build: `npm run build` · package: `npm run build:mac` · `:win` · `:linux`

## Layout

- `src/shared/` pure and testable — `colorimetry.ts` is the measurement core, read it first.
- Split main/preload (`tsconfig.node.json`) vs renderer + web (`tsconfig.web.json`).
- `native/decklink/` optional N-API addon; needs `DECKLINK_SDK_DIR`. **Never compiled.**

## Notes

- **Never sniff for Electron in a component** — read `window.api.capabilities`. The backend is a
  build-time define (`VITE_SCOPES_BACKEND`), so the hosted bundle has no switcher code in it.
- **No colorimetry constant belongs in GLSL.** Coefficients and the range mapping are uniforms
  computed by `colorimetry.ts`; the vectorscope graticule comes from the same matrix the shader
  plots with.
- Read-only towards the switcher, deliberately. Don't add setters to `atemConnection.ts`.
- Public MIT repo. Ships a user-facing AI disclaimer. "Commit" = commit **and** push.
- Cross-compile macOS x86_64 on macos-14 (never macos-13).

See [AGENTS.md](AGENTS.md) for the model, the traps and an honest verified/unverified split.
