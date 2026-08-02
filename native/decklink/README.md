# native/decklink

Optional native capture for Blackmagic DeckLink cards.

## Status — read this first

**This addon has never been compiled or run.** The Blackmagic DeckLink SDK is a free but
licence-gated download and is not ours to redistribute, so it is not vendored here and was
not present on the machine this was written on. The code follows the SDK's documented
capture sequence and mirrors the COM ownership discipline already proven in
[weblinked](https://github.com/stoatworks-labs/weblinked)'s DeckLink _output_, but "follows
the documentation" and "works" are different claims and only the first is being made.

The app is fully functional without it. `capabilities.decklinkCapture` is false when the
addon is absent, and the UI hides DeckLink rather than offering a device list that throws.

## Two independent requirements

They fail in ways that look nothing alike, so they are reported separately:

| Requirement              | When it is needed | Symptom if missing                                                |
| ------------------------ | ----------------- | ----------------------------------------------------------------- |
| DeckLink **SDK** headers | build time        | the addon does not build; `capabilities.decklinkCapture` is false |
| Desktop Video **driver** | run time          | the addon loads and reports zero devices                          |

## Building

```bash
DECKLINK_SDK_DIR="/path/to/Blackmagic DeckLink SDK 12.9" npx node-gyp rebuild
```

Accepted SDK layouts are the same ones weblinked's `FindDeckLinkSDK.cmake` accepts:
`<dir>/Mac/include/DeckLinkAPI.h`, `<dir>/Linux/include`, `<dir>/Win/include`, or a bare
include directory.

On macOS and Linux the API is reached through `DeckLinkAPIDispatch.cpp`, which ships in the
SDK and `dlopen`s the installed framework. That is why there is no link library on those
platforms, and why a binary built against the SDK still runs on a machine with no Desktop
Video installed — it simply finds no devices.

## Why it captures UYVY and not BGRA

The card will happily hand over `bmdFormat8BitBGRA` and do the YCbCr→RGB conversion itself.
This asks for `bmdFormat8BitYUV` instead and converts in our own shader.

That is the whole point of the project. Every scope here is careful about _which matrix_ and
_which range_ a reading was made under, because getting either wrong produces a plausible
wrong answer rather than an obvious one. Letting the driver convert throws that away: it
picks a matrix by rules it does not report, and what arrives is RGB that cannot be
un-converted. Capturing native 4:2:2 keeps the decision ours, and a DeckLink source is then
the one path in the app where the interpretation is _known_ rather than declared by the user
— which makes it the honest source to measure from, and the multiview tiles the convenient
one.

## Transport

Frames are written into a `SharedArrayBuffer` allocated by JavaScript and handed to the
addon, with a triple-buffered write index so the capture thread never blocks on the
renderer. Copying 1080p frames over Electron IPC at 60 fps would be roughly 500 MB/s of
structured clone, which is not a transport.
