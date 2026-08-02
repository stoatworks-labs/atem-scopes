/**
 * `?demo` — start the built-in test pattern and point every tile at it.
 *
 * Two jobs, and both matter.
 *
 * It is the **screenshot state**: the fleet's release checklist wants shots taken
 * from the real thing in a repeatable demo state rather than hand-assembled, and
 * a wall of empty tiles is what a fresh load actually looks like. This gives a
 * deterministic, real render of every scope with a signal whose correct answer is
 * known.
 *
 * It is also the **hosted landing state**: someone opening the public link with
 * no capture device would otherwise see an empty grid and a device picker, which
 * shows nothing about what the app does.
 *
 * It only ever uses the generated pattern — it never opens a camera, so it
 * cannot trip a permission prompt on a page the visitor has just landed on.
 */

import { captureManager } from '../capture/captureManager'
import {
  startTestPattern,
  TEST_PATTERN_DEVICE_ID,
  TEST_PATTERN_LABEL
} from '../capture/testPattern'
import { layoutCells } from '@shared/multiviewLayout'
import { calibrationKey, DEFAULT_INSET, type ScopeKind } from '@shared/protocol'
import { useStore } from './store'

/** MultiViewerLayout.Default — four equal quadrants, which is what the pattern draws. */
const DEFAULT_MULTIVIEWER_LAYOUT = 0

/** Scopes to show, in the order the default workspace lays its tiles out. */
const DEMO_KINDS: ScopeKind[] = ['picture', 'waveformLuma', 'vectorscope', 'histogram']

export function demoRequested(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('demo') && params.get('demo') !== '0'
}

export async function startDemo(): Promise<void> {
  const handle = startTestPattern()
  await captureManager.openStream(TEST_PATTERN_DEVICE_ID, TEST_PATTERN_LABEL, handle.stream)

  const store = useStore.getState()
  store.addDevice({
    deviceId: TEST_PATTERN_DEVICE_ID,
    label: TEST_PATTERN_LABEL,
    role: 'multiview',
    multiViewerIndex: 0
  })

  // The pattern's four quadrants are exactly the shape layoutCells() produces
  // for a Default (unsubdivided) multiviewer layout, so the demo exercises the
  // real region path rather than a special case: four calibrated windows, each
  // cropped and inset like a real multiview tile.
  //
  // `seeded: false` is the honest flag here, and it is the one case where it can
  // be. `seeded` means "geometry a human has not checked", which is why every
  // tile normally carries an `uncalibrated` badge until they have. This pattern
  // is drawn by testPattern.ts to these exact quadrants, so the geometry is not
  // a guess about someone's capture — it is the same constant, twice.
  await waitForFrameSize(TEST_PATTERN_DEVICE_ID)
  const capture = captureManager.get(TEST_PATTERN_DEVICE_ID)
  if (capture && capture.width > 0) {
    useStore.getState().putCalibration({
      key: calibrationKey(TEST_PATTERN_DEVICE_ID, capture.width, capture.height),
      multiViewerIndex: 0,
      seeded: false,
      windows: layoutCells(DEFAULT_MULTIVIEWER_LAYOUT).map((rect, windowIndex) => ({
        windowIndex,
        rect,
        name: `Window ${windowIndex + 1}`,
        inset: { ...DEFAULT_INSET }
      }))
    })
  }

  const workspace = useStore.getState().workspace
  workspace.tiles.forEach((tile, index) => {
    const kind = DEMO_KINDS[index % DEMO_KINDS.length]
    useStore.getState().updateTile(tile.id, {
      kind,
      // A generated pattern has no noise to spread the vectorscope trace, so
      // each bar is a single point. Real video does not need this.
      options: { ...tile.options, traceWidth: kind === 'vectorscope' ? 4 : tile.options.traceWidth }
    })
    useStore.getState().setTileSource(tile.id, {
      kind: 'multiviewWindow',
      deviceId: TEST_PATTERN_DEVICE_ID,
      multiViewerIndex: 0,
      windowIndex: index % 4
    })
  })
}

function waitForFrameSize(deviceId: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now()
    const check = (): void => {
      const capture = captureManager.get(deviceId)
      if ((capture && capture.width > 0) || performance.now() - started > timeoutMs) {
        resolve()
        return
      }
      requestAnimationFrame(check)
    }
    check()
  })
}
