# atem-scopes

> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The scope engine is verified against a
> built-in test pattern (see [Verification](#verification)), but it **hasn't** been used with a
> real ATEM switcher, a real multiview capture or a DeckLink card.

Video scopes arranged around a live ATEM multiview. Capture the switcher's multiview output over
USB, draw a region round each window, and put a waveform, vectorscope, histogram, false colour,
zebras or focus peaking on any of them, program and preview included.

Sources are named from the switcher's own multiviewer configuration, live, so re-routing a
multiview window mid-show relabels the scope watching it without touching the geometry.

![The browser build in demo mode: the built-in test pattern in four multiview windows with a waveform, vectorscope, histogram and RGB parade](docs/screenshots/demo.png)

<sub>The browser build on its built-in test pattern (`?demo=1`): 75 % bars over a ramp in four multiview windows, with a picture tile, a waveform, a vectorscope, a histogram and an RGB parade. The signal is synthetic; the scopes are the real ones.</sub>

## Two builds, one codebase

|                                     | Desktop (Electron)     | Hosted (Cloudflare Worker) |
| ----------------------------------- | ---------------------- | -------------------------- |
| UVC capture + every scope           | ✅                     | ✅                         |
| Region drawing and naming           | ✅                     | ✅                         |
| Live source names from the switcher | ✅                     | ❌                         |
| DeckLink capture                    | ⚠️ unbuilt — see below | ❌                         |

The hosted build's two gaps are down to the browser rather than unfinished features:

- **The ATEM control protocol is UDP on port 9910.** A page has no UDP API. WebRTC and
  WebTransport are negotiated transports, and neither can talk to a switcher that's never heard
  of them. simpleVIS documents the same wall for Art-Net and sACN.
- **A DeckLink card is reached through Blackmagic's SDK against a kernel driver.** It doesn't
  enumerate as a webcam, so `getUserMedia` can't see it. Blackmagic's _boxes_ (UltraStudio
  Recorder 3G, the Web Presenter family) do present as UVC, on purpose, and those work in the
  browser like any other camera. The PCIe cards don't.

So the hosted build names regions from what you type when you draw them, and the desktop build
prefers the switcher's answer. Same screen, same workflow.

Components branch on `window.api.capabilities` and hide what the current target can't do rather
than offering a button that always fails. The backend is chosen at _build_ time, so the hosted
bundle has no switcher code in it at all, and you can check: `grep 9910 dist/assets/*.js` finds
nothing.

## The thing this app is careful about

**The app never sees the video signal. It sees whatever RGB the capture path handed the
browser**, and that path has already made two decisions it doesn't tell you about:

1. which matrix it used to get from Y'CbCr to RGB (BT.601 or BT.709), and
2. whether it expanded studio-range levels (16–235) to full range.

Get either wrong and the scopes are _plausibly_ wrong rather than obviously wrong. A BT.709 signal
read as BT.601 throws every vectorscope target 5.74° off its box; unexpanded studio levels put
reference white at 92 IRE. Both look like a mildly misadjusted camera.

There's no way to detect this from the pixels, so it's an explicit setting the UI shows you, not
a guess. See [`src/shared/colorimetry.ts`](src/shared/colorimetry.ts).

The UI flags two related things on each tile:

- **A multiview tile is a monitoring aid, not a measurement.** It's a few hundred pixels wide,
  compressed over USB, and often has a label bar, tally border or audio meter burnt into it. The
  window inset exists to keep those out of the trace, and a tile whose window the switcher reports
  an overlay on is badged `overlay in crop`.
- **Seeded geometry is badged `uncalibrated`** until a human has looked at it.

For a proper measurement, capture an aux out whole as a second device and scope that.

## Verification

The app generates its own 75% colour bars (`Start test pattern`), for the same reason simpleRTA
generates its own pink noise: it's the only way to check the instrument without trusting the thing
you're measuring. It checks itself, too: the vectorscope graticule is computed from the same
matrix the shader plots with, so with 75% bars the trace _must_ land in the boxes.

Measured by reading pixels back off the GL canvas, BT.709, full range:

| 75% bar | Expected IRE | Waveform read |
| ------- | ------------ | ------------- |
| Blue    | 5.42         | 5.4           |
| Red     | 15.95        | 15.8          |
| Magenta | 21.36        | 21.2          |
| Green   | 53.64        | 53.4          |
| Cyan    | 59.06        | 58.8          |
| Yellow  | 69.59        | 69.4          |
| White   | 75.00        | 74.8          |

Differences are the row quantisation of the readback. The vectorscope trace landed on its cyan,
green and blue 75% targets to within a pixel.

**What that does and doesn't prove.** It proves the maths, the shader uniforms, the graticule
derivation and the full capture→texture→scope path agree end to end. It proves nothing about a real
ATEM: no switcher has ever been connected, no multiview has been captured, and the mapping from
multiview window index to screen position is an assumption the calibration screen exists to correct.

## DeckLink

The native addon in [`native/decklink`](native/decklink) **has never been compiled or run.** The
Blackmagic SDK is a free but licence-gated download and isn't mine to redistribute, so it isn't
vendored and wasn't available where this was written. It only builds with `DECKLINK_SDK_DIR` set,
and the app works fully without it: `capabilities.decklinkCapture` is false and the UI hides
DeckLink entirely.

It captures native UYVY rather than letting the card convert to BGRA, on purpose: the driver
doesn't report which matrix it used, and you can't un-convert RGB. See
[`native/decklink/README.md`](native/decklink/README.md).

## Video

[![atem-scopes](docs/video-thumb.png)](https://www.youtube.com/watch?v=ZABAnwzS8T0)

A 57-second look at it working, filmed at the hosted address and driven through the app's
own controls. The picture being measured is the built-in colour-bar generator, so every
scope in it can be checked against a signal whose right answer is known, including the
bit where the levels are set wrong on purpose and black falls below zero.

## Download

<!-- downloads:start -->

## Download

**[v0.2.3](https://github.com/stoatworks-labs/atem-scopes/releases/tag/v0.2.3)** — prebuilt for macOS, Windows and Linux. Pick your platform:

<details>
<summary><b>macOS</b> — Apple Silicon, Intel</summary>

| Build | Download | Size |
| --- | --- | --- |
| Apple Silicon · .dmg disk image | [`atem-scopes-0.2.3-arm64.dmg`](https://github.com/stoatworks-labs/atem-scopes/releases/download/v0.2.3/atem-scopes-0.2.3-arm64.dmg) | 135 MB |
| Intel · .dmg disk image | [`atem-scopes-0.2.3.dmg`](https://github.com/stoatworks-labs/atem-scopes/releases/download/v0.2.3/atem-scopes-0.2.3.dmg) | 142 MB |
| Apple Silicon · .pkg installer | [`atem-scopes-0.2.3-macos-arm64.pkg`](https://github.com/stoatworks-labs/atem-scopes/releases/download/v0.2.3/atem-scopes-0.2.3-macos-arm64.pkg) | 135 MB |
| Intel · .pkg installer | [`atem-scopes-0.2.3-macos-x64.pkg`](https://github.com/stoatworks-labs/atem-scopes/releases/download/v0.2.3/atem-scopes-0.2.3-macos-x64.pkg) | 142 MB |

</details>

<details>
<summary><b>Windows</b></summary>

| Build | Download | Size |
| --- | --- | --- |
| .exe installer | [`atem-scopes.Setup.0.2.3.exe`](https://github.com/stoatworks-labs/atem-scopes/releases/download/v0.2.3/atem-scopes.Setup.0.2.3.exe) | 121 MB |

</details>

<details>
<summary><b>Linux</b></summary>

| Build | Download | Size |
| --- | --- | --- |
| AppImage | [`atem-scopes-0.2.3.AppImage`](https://github.com/stoatworks-labs/atem-scopes/releases/download/v0.2.3/atem-scopes-0.2.3.AppImage) | 133 MB |

</details>

Also in this release:

- [`atem-scopes-web.zip`](https://github.com/stoatworks-labs/atem-scopes/releases/latest/download/atem-scopes-web.zip) — Source tarball, 124 KB

All builds, checksums and release notes: [github.com/stoatworks-labs/atem-scopes/releases](https://github.com/stoatworks-labs/atem-scopes/releases).

macOS builds are signed and notarised and open normally. The Windows builds are unsigned, so SmartScreen warns once.

<!-- downloads:end -->

macOS installers are **Developer ID-signed and notarised by Apple**, nested helper
binaries included, so they open normally. Windows installers are unsigned and
SmartScreen warns once: **More info** → **Run anyway**.

The hosted build needs no install: it runs in any browser with WebGL2.

## Commands

```bash
npm run dev              # Electron dev
npm run preview:static   # the hosted build, in a browser — no Electron needed
npm run static:build     # hosted production build -> dist/
npm run deploy           # static:build + wrangler deploy
npm run typecheck        # node + web — run this, not a bare tsc
npm test                 # vitest
npm run build            # typecheck + electron-vite build
npm run build:mac        # / :win / :linux
```

## Where this sits among the ATEM projects

| Repo                   | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| **atem-scopes** (this) | _Measure_ what a switcher is putting out                              |
| **animATEM**           | _Control one_ switcher; UVC multiview compositing for SuperSource/DVE |
| **atem-overseer**      | _Monitor and control_ a fleet from one dashboard                      |
| **atem-fleet-admin**   | _Provision/configure_ many switchers at once                          |

atem-scopes never sends a command to a switcher. It connects, reads the multiviewer window
assignments and input names, and disconnects.

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT, see [LICENSE](LICENSE).
