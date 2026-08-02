import { createRequire } from 'module'
import type { CaptureDevice } from '../../shared/protocol'

/**
 * Optional native DeckLink capture.
 *
 * The Blackmagic DeckLink SDK is a free but licence-gated download and is not
 * ours to redistribute, so the addon in `native/decklink` is built only when a
 * copy is pointed at (`DECKLINK_SDK_DIR`) — the same arrangement weblinked
 * uses. Everything here is written so the app is fully functional without it:
 * the addon is loaded optionally, `capabilities.decklinkCapture` reports
 * whether it came up, and the UI hides DeckLink rather than offering a device
 * list that always throws.
 *
 * Note the two independent things that must both be true. The *addon* needs the
 * SDK headers at build time. Finding any *devices* needs Desktop Video
 * installed at run time. A machine can easily have one and not the other, and
 * the failure modes look nothing alike, so they are reported separately.
 */

export interface DeckLinkAddon {
  listDevices(): { id: string; label: string }[]
  openDevice(id: string): void
  closeDevice(id: string): void
}

let addon: DeckLinkAddon | null = null
let loadError: string | null = null
let attempted = false

function load(): DeckLinkAddon | null {
  if (attempted) return addon
  attempted = true
  try {
    // A bare `require` of an optional native module is intentional: bundling it
    // would make its absence a build failure rather than a runtime capability.
    const require = createRequire(import.meta.url)
    addon = require('../../native/decklink/build/Release/decklink.node') as DeckLinkAddon
  } catch (err) {
    addon = null
    loadError = err instanceof Error ? err.message : String(err)
  }
  return addon
}

export function isAvailable(): boolean {
  return load() !== null
}

export function unavailableReason(): string | null {
  load()
  return addon === null ? (loadError ?? 'not built') : null
}

export function listDevices(): CaptureDevice[] {
  const api = load()
  if (!api) return []
  try {
    return api
      .listDevices()
      .map((d) => ({ id: d.id, backend: 'decklink' as const, label: d.label }))
  } catch {
    // Desktop Video absent or the driver not running — no devices, not a crash.
    return []
  }
}

export function openDevice(id: string): void {
  const api = load()
  if (!api) throw new Error('DeckLink support is not built into this binary.')
  api.openDevice(id)
}

export function closeDevice(id: string): void {
  load()?.closeDevice(id)
}
