/**
 * Turning "which source is this tile watching" into "which pixels do I sample
 * and what do I call them".
 *
 * The split animATEM settled on holds here and is worth restating, because it
 * is the whole reason this works without a configuration file per venue:
 *
 *   **Geometry is calibrated once. Source assignment is read live.**
 *
 * Where multiview window 4 sits in the captured frame depends on the layout and
 * the capture path, changes rarely, and has to be checked by eye. *What is in*
 * window 4 changes whenever an operator re-routes the multiviewer, and the
 * switcher will tell us, so nothing here caches it. Re-route a multiview window
 * mid-show and the scope tile watching it follows, relabelled, with no
 * recalibration.
 */

import { sourceGroup, sourceName, SOURCE_GROUP_LABELS, type SourceGroup } from '@shared/atemSources'
import { insetRect } from '@shared/multiviewLayout'
import type {
  AtemSnapshot,
  CalibrationProfile,
  Rect,
  ResolvedSource,
  SourceRef
} from '@shared/protocol'

const FULL_FRAME: Rect = { x: 0, y: 0, width: 1, height: 1 }

export interface ResolveContext {
  snapshot: AtemSnapshot | null
  /** Calibration for an open device at its current resolution, or null if uncalibrated. */
  calibrationFor: (deviceId: string) => CalibrationProfile | null
  /** Human label for an open device, or null if the device is not open. */
  deviceLabelFor: (deviceId: string) => string | null
}

export function sameSource(a: SourceRef | null, b: SourceRef | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'fullRaster' && b.kind === 'fullRaster') return a.deviceId === b.deviceId
  if (a.kind === 'multiviewWindow' && b.kind === 'multiviewWindow') {
    return (
      a.deviceId === b.deviceId &&
      a.multiViewerIndex === b.multiViewerIndex &&
      a.windowIndex === b.windowIndex
    )
  }
  return false
}

export function resolveSource(ref: SourceRef, ctx: ResolveContext): ResolvedSource {
  const deviceLabel = ctx.deviceLabelFor(ref.deviceId)
  const deviceOpen = deviceLabel !== null

  if (ref.kind === 'fullRaster') {
    return {
      ref,
      rect: FULL_FRAME,
      label: deviceLabel ?? 'device not open',
      atemSourceId: null,
      hasOverlay: false,
      trustworthy: deviceOpen
    }
  }

  const calibration = ctx.calibrationFor(ref.deviceId)
  const window = calibration?.windows.find((w) => w.windowIndex === ref.windowIndex) ?? null
  const mv = ctx.snapshot?.multiViewers.find((m) => m.index === ref.multiViewerIndex) ?? null
  const liveWindow = mv?.windows.find((w) => w.windowIndex === ref.windowIndex) ?? null

  // Name precedence: the switcher, then whatever the user typed, then the bare
  // window number. The switcher comes first because it is the only one of the
  // three that stays correct when a multiview window is re-routed mid-show.
  const label = liveWindow
    ? sourceName(liveWindow.source, ctx.snapshot?.inputs ?? [])
    : window?.name?.trim() || `Window ${ref.windowIndex + 1}`

  return {
    ref,
    rect: window ? insetRect(window) : FULL_FRAME,
    label,
    atemSourceId: liveWindow?.source ?? null,
    hasOverlay: (liveWindow?.safeTitle ?? false) || (liveWindow?.audioMeter ?? false),
    // Seeded geometry has not been looked at by a human yet, so a scope drawn
    // from it may be measuring the wrong tile entirely. The UI marks these.
    trustworthy: deviceOpen && window !== null && calibration !== null && !calibration.seeded
  }
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

export interface SourceOption {
  ref: SourceRef
  label: string
  /** Secondary line: which window or device this actually is. */
  detail: string
  group: SourceGroup | 'device'
  hasOverlay: boolean
  trustworthy: boolean
}

export interface SourceOptionGroup {
  group: SourceGroup | 'device'
  label: string
  options: SourceOption[]
}

const GROUP_ORDER: (SourceGroup | 'device')[] = [
  'programPreview',
  'input',
  'internal',
  'unknown',
  'device'
]

const GROUP_LABELS: Record<SourceGroup | 'device', string> = {
  ...SOURCE_GROUP_LABELS,
  device: 'Whole capture device'
}

/**
 * Every source a tile could be pointed at, grouped for the picker.
 *
 * Program and preview are listed — and listed first. They are ordinary
 * multiview windows as far as the geometry is concerned, so nothing special
 * happens to them here beyond the grouping, but they are the two windows anyone
 * reaches for and burying them among sixteen inputs makes the common case the
 * awkward one.
 */
export function availableSources(
  openDeviceIds: {
    deviceId: string
    label: string
    role: 'multiview' | 'fullRaster'
    multiViewerIndex: number
  }[],
  ctx: ResolveContext
): SourceOptionGroup[] {
  const options: SourceOption[] = []

  for (const device of openDeviceIds) {
    if (device.role === 'fullRaster') {
      options.push({
        ref: { kind: 'fullRaster', deviceId: device.deviceId },
        label: device.label,
        detail: 'full raster',
        group: 'device',
        hasOverlay: false,
        trustworthy: true
      })
      continue
    }

    const calibration = ctx.calibrationFor(device.deviceId)
    const mv = ctx.snapshot?.multiViewers.find((m) => m.index === device.multiViewerIndex) ?? null

    // Calibrated windows are what can actually be sampled. Without a
    // calibration there is nothing to offer but the whole device, and saying so
    // is better than listing windows that would all crop to the same rectangle.
    if (!calibration) {
      options.push({
        ref: { kind: 'fullRaster', deviceId: device.deviceId },
        label: device.label,
        detail: 'uncalibrated — whole frame',
        group: 'device',
        hasOverlay: false,
        trustworthy: false
      })
      continue
    }

    for (const window of calibration.windows) {
      const ref: SourceRef = {
        kind: 'multiviewWindow',
        deviceId: device.deviceId,
        multiViewerIndex: device.multiViewerIndex,
        windowIndex: window.windowIndex
      }
      const live = mv?.windows.find((w) => w.windowIndex === window.windowIndex) ?? null
      const input = live ? ctx.snapshot?.inputs.find((i) => i.id === live.source) : undefined

      options.push({
        ref,
        label: live
          ? sourceName(live.source, ctx.snapshot?.inputs ?? [])
          : window.name?.trim() || `Window ${window.windowIndex + 1}`,
        detail: `window ${window.windowIndex + 1}${live ? '' : ' · named by hand'}`,
        group: live ? sourceGroup(live.source, input?.internalPortType) : 'unknown',
        hasOverlay: (live?.safeTitle ?? false) || (live?.audioMeter ?? false),
        trustworthy: !calibration.seeded
      })
    }
  }

  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    options: options.filter((o) => o.group === group)
  })).filter((g) => g.options.length > 0)
}
