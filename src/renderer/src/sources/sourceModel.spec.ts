import { describe, expect, it } from 'vitest'
import { InternalPortType } from '@shared/atemSources'
import type { AtemSnapshot, CalibrationProfile, SourceRef } from '@shared/protocol'
import { availableSources, resolveSource, sameSource, type ResolveContext } from './sourceModel'

const DEVICE = 'uvc-multiview'

function snapshot(overrides: Partial<AtemSnapshot> = {}): AtemSnapshot {
  return {
    productModel: 'ATEM Mini Extreme ISO',
    videoMode: 0,
    inputs: [
      {
        id: 1,
        shortName: 'Cam1',
        longName: 'Camera 1',
        internalPortType: InternalPortType.External
      },
      {
        id: 2,
        shortName: 'Cam2',
        longName: 'Camera 2',
        internalPortType: InternalPortType.External
      },
      {
        id: 3010,
        shortName: 'MP1',
        longName: 'Media Player 1',
        internalPortType: InternalPortType.MediaPlayerFill
      },
      {
        id: 10010,
        shortName: 'PGM',
        longName: 'Program',
        internalPortType: InternalPortType.MEOutput
      },
      {
        id: 10011,
        shortName: 'PVW',
        longName: 'Preview',
        internalPortType: InternalPortType.MEOutput
      }
    ],
    mixEffects: [{ index: 0, programInput: 1, previewInput: 2 }],
    multiViewers: [
      {
        index: 0,
        layout: 12,
        programPreviewSwapped: false,
        windows: [
          {
            windowIndex: 0,
            source: 10010,
            safeTitle: false,
            audioMeter: true,
            supportsSafeArea: true,
            supportsVuMeter: true
          },
          {
            windowIndex: 1,
            source: 10011,
            safeTitle: true,
            audioMeter: false,
            supportsSafeArea: true,
            supportsVuMeter: true
          },
          {
            windowIndex: 2,
            source: 1,
            safeTitle: false,
            audioMeter: false,
            supportsSafeArea: false,
            supportsVuMeter: true
          },
          {
            windowIndex: 3,
            source: 3010,
            safeTitle: false,
            audioMeter: false,
            supportsSafeArea: false,
            supportsVuMeter: true
          }
        ]
      }
    ],
    ...overrides
  }
}

function calibration(seeded = false): CalibrationProfile {
  return {
    key: `${DEVICE}@1920x1080`,
    multiViewerIndex: 0,
    seeded,
    windows: [0, 1, 2, 3].map((windowIndex) => ({
      windowIndex,
      rect: { x: 0.25 * windowIndex, y: 0, width: 0.25, height: 0.25 },
      inset: { top: 0, right: 0, bottom: 0.1, left: 0 }
    }))
  }
}

function context(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    snapshot: snapshot(),
    calibrationFor: () => calibration(),
    deviceLabelFor: (id) => (id === DEVICE ? 'ATEM Multiview (UVC)' : null),
    ...overrides
  }
}

const window0: SourceRef = {
  kind: 'multiviewWindow',
  deviceId: DEVICE,
  multiViewerIndex: 0,
  windowIndex: 0
}

describe('resolveSource', () => {
  it('names a multiview window from the switcher, not from the calibration', () => {
    const resolved = resolveSource(window0, context())
    expect(resolved.label).toBe('Program')
    expect(resolved.atemSourceId).toBe(10010)
  })

  it('follows a live re-route without recalibrating', () => {
    // The point of reading assignment live: an operator moves camera 2 into the
    // program window's slot and the tile relabels itself.
    const rerouted = snapshot()
    rerouted.multiViewers[0].windows[0].source = 2
    const before = resolveSource(window0, context())
    const after = resolveSource(window0, context({ snapshot: rerouted }))

    expect(before.label).toBe('Program')
    expect(after.label).toBe('Camera 2')
    expect(after.rect).toEqual(before.rect)
  })

  it('applies the window inset so the burnt-in label bar is not sampled', () => {
    const resolved = resolveSource(window0, context())
    expect(resolved.rect).toEqual({ x: 0, y: 0, width: 0.25, height: 0.225 })
  })

  it('flags a window the switcher is drawing an overlay into', () => {
    // Window 0 has an audio meter, window 1 a safe-area box; both land inside
    // the crop and both would show up in the trace.
    expect(resolveSource(window0, context()).hasOverlay).toBe(true)
    const window1: SourceRef = { ...window0, windowIndex: 1 }
    expect(resolveSource(window1, context()).hasOverlay).toBe(true)
    const window2: SourceRef = { ...window0, windowIndex: 2 }
    expect(resolveSource(window2, context()).hasOverlay).toBe(false)
  })

  it('is untrustworthy while the geometry is still the seed', () => {
    const resolved = resolveSource(window0, context({ calibrationFor: () => calibration(true) }))
    expect(resolved.trustworthy).toBe(false)
  })

  it('is untrustworthy when the device is not open', () => {
    expect(resolveSource(window0, context({ deviceLabelFor: () => null })).trustworthy).toBe(false)
  })

  it('falls back to a window number when there is no switcher link', () => {
    const resolved = resolveSource(window0, context({ snapshot: null }))
    expect(resolved.label).toBe('Window 1')
    expect(resolved.atemSourceId).toBeNull()
    // Geometry is still valid without a link, so the crop is still right.
    expect(resolved.rect.width).toBeCloseTo(0.25, 12)
  })

  it('uses a hand-typed region name when there is no switcher link', () => {
    // The hosted build's only naming route: draw a box, type what it is.
    const named = calibration()
    named.windows[0].name = 'Stage wide'
    const resolved = resolveSource(
      window0,
      context({ snapshot: null, calibrationFor: () => named })
    )
    expect(resolved.label).toBe('Stage wide')
  })

  it('lets the switcher override a hand-typed name', () => {
    // A typed label goes stale the moment the window is re-routed; the
    // switcher's answer does not.
    const named = calibration()
    named.windows[0].name = 'Stage wide'
    const resolved = resolveSource(window0, context({ calibrationFor: () => named }))
    expect(resolved.label).toBe('Program')
  })

  it('ignores a blank typed name rather than showing an empty label', () => {
    const named = calibration()
    named.windows[0].name = '   '
    const resolved = resolveSource(
      window0,
      context({ snapshot: null, calibrationFor: () => named })
    )
    expect(resolved.label).toBe('Window 1')
  })

  it('crops a full-raster device to the whole frame', () => {
    const resolved = resolveSource({ kind: 'fullRaster', deviceId: DEVICE }, context())
    expect(resolved.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(resolved.label).toBe('ATEM Multiview (UVC)')
    expect(resolved.trustworthy).toBe(true)
  })

  it('falls back to the whole frame rather than a wrong crop when uncalibrated', () => {
    const resolved = resolveSource(window0, context({ calibrationFor: () => null }))
    expect(resolved.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(resolved.trustworthy).toBe(false)
  })
})

describe('availableSources', () => {
  const devices = [
    {
      deviceId: DEVICE,
      label: 'ATEM Multiview (UVC)',
      role: 'multiview' as const,
      multiViewerIndex: 0
    }
  ]

  it('lists program and preview first, in their own group', () => {
    const groups = availableSources(devices, context())
    expect(groups[0].group).toBe('programPreview')
    expect(groups[0].options.map((o) => o.label)).toEqual(['Program', 'Preview'])
  })

  it('separates real inputs from internal sources', () => {
    const groups = availableSources(devices, context())
    const byGroup = Object.fromEntries(groups.map((g) => [g.group, g.options.map((o) => o.label)]))
    expect(byGroup.input).toEqual(['Camera 1'])
    expect(byGroup.internal).toEqual(['Media Player 1'])
  })

  it('offers every calibrated window even with no switcher link', () => {
    const groups = availableSources(devices, context({ snapshot: null }))
    const all = groups.flatMap((g) => g.options)
    expect(all).toHaveLength(4)
    expect(all.map((o) => o.label)).toEqual(['Window 1', 'Window 2', 'Window 3', 'Window 4'])
    expect(all.every((o) => o.detail.includes('named by hand'))).toBe(true)
  })

  it('offers the whole device rather than four identical crops when uncalibrated', () => {
    const groups = availableSources(devices, context({ calibrationFor: () => null }))
    const all = groups.flatMap((g) => g.options)
    expect(all).toHaveLength(1)
    expect(all[0].ref.kind).toBe('fullRaster')
    expect(all[0].detail).toContain('uncalibrated')
  })

  it('lists a full-raster device on its own', () => {
    const groups = availableSources(
      [{ deviceId: 'aux', label: 'Aux 1 (DeckLink)', role: 'fullRaster', multiViewerIndex: 0 }],
      context({ deviceLabelFor: () => 'Aux 1 (DeckLink)' })
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].group).toBe('device')
    expect(groups[0].options[0].detail).toBe('full raster')
  })
})

describe('sameSource', () => {
  it('distinguishes windows on the same device', () => {
    expect(sameSource(window0, { ...window0 })).toBe(true)
    expect(sameSource(window0, { ...window0, windowIndex: 1 })).toBe(false)
    expect(sameSource(window0, { ...window0, multiViewerIndex: 1 })).toBe(false)
    expect(sameSource(window0, { ...window0, deviceId: 'other' })).toBe(false)
  })

  it('never equates a window with the whole device it lives on', () => {
    expect(sameSource(window0, { kind: 'fullRaster', deviceId: DEVICE })).toBe(false)
  })

  it('handles the unset tile', () => {
    expect(sameSource(null, null)).toBe(true)
    expect(sameSource(window0, null)).toBe(false)
  })
})
