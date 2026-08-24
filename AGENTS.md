# AGENTS.md — bringing an LLM up to speed on atem-scopes

Orientation for an AI assistant (or a new human) picking this project up cold. `CLAUDE.md` holds
the short command reference; this file explains the model, the traps, and — most importantly — an
honest account of what is verified and what is not.

---

## 1. What this is

Video scopes arranged around a live ATEM multiview. Capture the multiview over USB, draw a region
round each window, and put a waveform / vectorscope / histogram / false colour / zebra / focus
peaking tile on any of them, program and preview included. Source names come off the switcher live.

Electron + React + TypeScript, electron-vite, vitest, WebGL2. Public repo, MIT.

## 2. Two targets, one codebase

| Target                            | Backend for `window.api` | Switcher link | DeckLink              |
| --------------------------------- | ------------------------ | ------------- | --------------------- |
| Electron desktop                  | preload IPC              | yes           | optional native addon |
| Hosted static (Cloudflare Worker) | `src/web/staticApi.ts`   | **no**        | **no**                |

The hosted build's gaps are browser limits, not gaps in the work — the ATEM protocol is UDP 9910
and a DeckLink card is not a webcam. Follow the fleet's hosted-build pattern (see
`reference_pages_demo_hosting`, and simpleVIS, which hit the identical wall with Art-Net):

- **Never sniff for Electron in a component.** Read `window.api.capabilities`.
- The backend is chosen at _build_ time in `src/renderer/src/main.tsx` via
  `import.meta.env.VITE_SCOPES_BACKEND`, so the hosted bundle contains no Electron-facing code.
  `grep 9910 dist/assets/*.js` returning nothing is a real invariant — keep it true.

## 3. Layout

```
src/shared/           pure, testable, shared by every target
  colorimetry.ts        THE MEASUREMENT CORE. Read this first.
  multiviewLayout.ts    seed geometry from the switcher's layout bitfield
  atemSources.ts        source id classification, PGM/PVW grouping
  protocol.ts           types + the Capabilities contract
src/main/             Electron main (atemConnection, store, decklink loader)
src/preload/          the IPC-backed window.api
src/web/staticApi.ts  the hosted window.api
src/renderer/src/
  gl/                   scopeRenderer.ts (WebGL2), shaders.ts, graticule.ts (2D overlay)
  capture/              captureManager.ts (N devices, one rAF), testPattern.ts
  sources/              sourceModel.ts (the source model), regionDrag.ts
  components/           ScopeWall, TileChrome, CalibrationView, Sidebar
native/decklink/      optional N-API addon. NEVER COMPILED.
```

## 4. The one idea everything follows from

**We never see the video signal.** We see whatever RGB the capture path produced, and it has
already chosen a matrix (601 vs 709) and a range (studio vs full) without telling us. Wrong matrix
rotates every vectorscope target by 5.74°; wrong range puts reference white at 92 IRE. Both look
like a slightly misadjusted camera rather than a broken instrument, which is what makes them
dangerous.

So `SignalInterpretation` is an explicit, user-visible setting. **Do not add detection heuristics** —
there is nothing in the pixels to detect it from, and a heuristic would replace a stated assumption
with a hidden one.

### The rule that keeps it honest

**No colorimetry constant is written down in GLSL.** Luma coefficients and the range mapping arrive
as uniforms computed by `colorimetry.ts` — the module with the tests. The vectorscope graticule is
computed by `vectorTargets()` from the same matrix the shader plots with, so changing the matrix
moves the boxes _and_ the trace together. Duplicate `0.2126` into a shader and the graticule drifts
off the trace by a fraction of a degree nobody notices until a client does.

The `receivedToSignal` affine mapping is recovered in `bindCommon` as `f(1) - f(0)` and `f(0)`
rather than restated. Keep that trick; it is what makes the shader unable to disagree with the test
suite.

## 5. Geometry is calibrated once, source assignment is read live

Where multiview window 4 sits in the frame depends on the layout and the capture path, changes
rarely, and must be checked by eye. _What is in_ window 4 changes whenever an operator re-routes
the multiviewer, and the switcher will tell us. animATEM settled on this split; it holds here.

`seedWindows()` is a real improvement on animATEM's blind sqrt grid: **`MultiViewerLayout` is a
bitfield**, not an enum of shapes.

```
TopLeftSmall=1  TopRightSmall=2  BottomLeftSmall=4  BottomRightSmall=8
ProgramTop = 12 = BL|BR small -> two large windows on top, eight small below
```

Four quadrants; a quadrant whose bit is set subdivides into its own 2×2. That gives a Mini Pro's
10 windows exactly. **The cell rectangles are derived. The cell → `windowIndex` mapping is an
assumption** (TL, TR, BL, BR; row-major within a quadrant) that no switcher has confirmed. It is a
cheap assumption to be wrong about because the calibration screen labels every box with the live
source name, so a mis-ordered seed is visible immediately and reassignable from a dropdown.

## 6. Status — be precise about it

**Verified**, by reading pixels back off the GL canvas against the built-in 75% bar generator:
every bar's waveform level matches its BT.709 luma to within the readback's row quantisation
(white 74.8 vs 75.00, blue 5.4 vs 5.42, and the five between), and the vectorscope trace lands on
its cyan/green/blue targets to within a pixel. That proves the maths, the uniforms, the graticule
derivation and the capture→texture→scope path agree end to end.

**Not verified.** No ATEM switcher has ever been connected. No real multiview has been captured. No
DeckLink card exists in this codebase's history — `native/decklink` has never been compiled, let
alone run. The Electron app has never been _launched_ here either: npm blocks Electron's postinstall
in this environment so there is no binary, and all three bundles building proves only that they
build.

When you add a claim to the README, make sure it is one of the two kinds above and label it.

## 7. Traps worth knowing

- **One WebGL2 context for the whole wall.** Browsers cap live contexts around 16 and drop the
  oldest, so a per-tile context turns "add a ninth scope" into "the first scope goes black".
- **`UNPACK_COLORSPACE_CONVERSION_WEBGL` must be `NONE`.** The default lets the browser
  colour-manage video into the texture, adjusting the exact values the app exists to report.
- **Scope passes sample with NEAREST, the picture pass with LINEAR.** A linear filter blends
  neighbours and pulls every reading toward the local mean — clipped whites stop reading as clipped.
  This is a measurement decision, not a cosmetic one.
- **The histogram accumulates into RGBA32F, not 16F.** Half-float has ~11 mantissa bits, so adding
  1.0 to a bin holding 4096 rounds straight back to 4096 and the count silently stalls — worst on
  the tallest bins, which are exactly the clipped whites and crushed blacks you opened it to find.
  Needs `EXT_color_buffer_float` _and_ `EXT_float_blend`; without both the tile says so.
- **`gl_PointSize` is in device pixels.** Hardcode 1.0 and the trace is a quarter size on a HiDPI
  display. On the vectorscope it is worse than cosmetic: every sample of a flat colour lands on one
  coordinate, so a whole colour bar renders as a single pixel and reads as _no trace at all_. This
  cost an hour; `traceWidth` exists because of it.
- **A multiview tile is a monitoring aid, not a measurement** — small, compressed, with label bars
  and meters burnt in. `MultiViewerWindowState.safeTitle` / `.audioMeter` tell us when, and the UI
  badges the tile. The window inset trims them out of the sample.

## 8. Conventions

- Public MIT repo; ships a user-facing AI-assisted disclaimer. Keep it.
- **atem-scopes never sends a command to a switcher.** Read-only, on purpose — a monitoring tool
  that _could_ switch is one mis-click from doing it on air. `atemConnection.ts` exposes no setters;
  don't add any.
- "Commit" means commit **and** push.
- Cross-compile macOS x86_64 on `macos-14`, never `macos-13`.

## Notes

`docs/NOTES.md` carries this repo's working notes — current status, decisions
already made, and the traps that have actually bitten. Read it before changing
anything non-obvious. Cross-cutting fleet knowledge lives in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).
