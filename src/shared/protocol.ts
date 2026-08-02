/**
 * The contract between the renderer and whatever is backing it.
 *
 * atem-scopes ships from one codebase to targets that can do different things:
 * the Electron app can open a socket to a switcher and a DeckLink card, the
 * hosted build can do neither. Components branch on `Capabilities` and hide
 * what the current target cannot do, rather than offering a button that always
 * fails. Never sniff for Electron in a component — read `window.api.capabilities`.
 */

import type { SignalInterpretation } from './colorimetry'

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface Capabilities {
  /** Can reach a switcher over the network, so multiview windows can be named live. */
  atemLink: boolean
  /** Native DeckLink capture is compiled in and the driver is present. */
  decklinkCapture: boolean
  /** Workspaces and calibration survive a restart. */
  persistence: boolean
}

export const STATIC_CAPABILITIES: Capabilities = {
  atemLink: false,
  decklinkCapture: false,
  persistence: true // localStorage
}

export const ELECTRON_CAPABILITIES: Capabilities = {
  atemLink: true,
  decklinkCapture: false, // flipped on at runtime if the native addon loaded
  persistence: true
}

// ---------------------------------------------------------------------------
// Switcher state
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AtemInput {
  id: number
  shortName: string
  longName: string
  /** atem-connection's InternalPortType — classifies PGM/PVW/aux/media as against a real input. */
  internalPortType: number
}

export interface MultiViewerWindow {
  windowIndex: number
  /** ATEM source id currently routed to this window. Changes live. */
  source: number
  /**
   * Whether the switcher is burning a safe-area box or an audio meter into
   * this window. Both land inside the crop a scope would take, so the UI warns
   * about them rather than quietly measuring the overlay.
   */
  safeTitle: boolean
  audioMeter: boolean
  supportsSafeArea: boolean
  supportsVuMeter: boolean
}

export interface MultiViewerState {
  index: number
  windows: MultiViewerWindow[]
  /** atem-connection's MultiViewerLayout — tells us where the PGM/PVW pair sits. */
  layout: number | null
  programPreviewSwapped: boolean
}

export interface MixEffectState {
  index: number
  programInput: number
  previewInput: number
}

export interface AtemSnapshot {
  productModel: string
  videoMode: number
  inputs: AtemInput[]
  mixEffects: MixEffectState[]
  multiViewers: MultiViewerState[]
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export type CaptureBackend = 'uvc' | 'decklink'

export interface CaptureDevice {
  /** Unique within a backend. For UVC this is the MediaDeviceInfo deviceId. */
  id: string
  backend: CaptureBackend
  label: string
}

/** A device's role in the workspace. One multiview feeds the window grid; full-raster feeds stand alone. */
export type DeviceRole = 'multiview' | 'fullRaster'

export interface OpenDevice {
  device: CaptureDevice
  role: DeviceRole
  /** Which multiviewer on the switcher this device is showing. Only meaningful for role 'multiview'. */
  multiViewerIndex: number
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Normalised to the captured frame: 0..1 on both axes, origin top-left. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface CalibratedWindow {
  windowIndex: number
  rect: Rect
  /**
   * A name typed by the user. Only ever used when there is no switcher link to
   * ask — the hosted build has none at all, so there it is the only name a
   * region has. When a link exists the switcher's own answer wins, because it
   * follows a live re-route and a typed label does not.
   */
  name?: string
  /**
   * Fraction of the window trimmed off each edge before sampling, to keep the
   * multiview's burnt-in label bar, tally border and audio meter out of the
   * scope. A tally border is a couple of pixels; a label bar is not, and a
   * white label in the sample set puts a flat line at 100 IRE across the
   * waveform that is not in the picture at all.
   */
  inset: { top: number; right: number; bottom: number; left: number }
}

export const DEFAULT_INSET = { top: 0.02, right: 0.01, bottom: 0.09, left: 0.01 }

export interface CalibrationProfile {
  /** Keyed by capture device and frame size — a device that renegotiates resolution needs its own geometry. */
  key: string
  multiViewerIndex: number
  windows: CalibratedWindow[]
  /** True while the geometry is still the generated seed and has not been checked against a real capture. */
  seeded: boolean
}

export function calibrationKey(deviceId: string, width: number, height: number): string {
  return `${deviceId}@${width}x${height}`
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * What a scope tile is looking at. Either a crop of a multiview capture (named
 * live from the switcher's own multiviewer config, exactly as animATEM resolves
 * a tap to a source) or a whole capture device.
 */
export type SourceRef =
  | { kind: 'multiviewWindow'; deviceId: string; multiViewerIndex: number; windowIndex: number }
  | { kind: 'fullRaster'; deviceId: string }

export interface ResolvedSource {
  ref: SourceRef
  /** Crop within the device's frame. Full frame for 'fullRaster'. */
  rect: Rect
  label: string
  /** Null when there is no switcher link, or the window is unrouted. */
  atemSourceId: number | null
  /** True when the crop is known to contain a burnt-in label bar or meter. */
  hasOverlay: boolean
  /** False when geometry is still the seed, or the device is not open. */
  trustworthy: boolean
}

// ---------------------------------------------------------------------------
// Scopes and workspace
// ---------------------------------------------------------------------------

export type ScopeKind =
  | 'picture'
  | 'waveformLuma'
  | 'waveformParadeRgb'
  | 'waveformParadeYcbcr'
  | 'vectorscope'
  | 'histogram'

export type PictureOverlay = 'none' | 'falseColour' | 'zebra' | 'focusPeaking'

export interface ScopeOptions {
  /** picture only */
  overlay: PictureOverlay
  /** zebra threshold, IRE */
  zebraIre: number
  /** second zebra band, IRE; null for a single threshold */
  zebraIre2: number | null
  /** focus peaking sensitivity, 0..1 — the gradient magnitude above which a pixel is tinted */
  peakingThreshold: number
  peakingColour: [number, number, number]
  /** waveform/vectorscope trace intensity, 0..1 */
  gain: number
  /**
   * Trace dot size in CSS pixels, scaled by devicePixelRatio at draw time.
   *
   * Matters most on the vectorscope: a perfectly flat colour puts every one of
   * its samples on a single coordinate, so a whole colour bar can render as one
   * pixel. Real video has enough noise to spread the trace; graphics, test
   * patterns and a switcher's colour generator do not.
   */
  traceWidth: number
  /** vectorscope graticule amplitude: 0.75 or 1.0 bars */
  barAmplitude: number
  /** vectorscope magnification, e.g. 5x for checking near-neutral chroma */
  vectorZoom: number
  /** histogram: which channels to draw */
  histogramChannels: { r: boolean; g: boolean; b: boolean; luma: boolean }
}

export const DEFAULT_SCOPE_OPTIONS: ScopeOptions = {
  overlay: 'none',
  zebraIre: 95,
  zebraIre2: null,
  peakingThreshold: 0.15,
  peakingColour: [1, 0, 0],
  gain: 0.35,
  traceWidth: 2,
  barAmplitude: 0.75,
  vectorZoom: 1,
  histogramChannels: { r: true, g: true, b: true, luma: false }
}

export interface Tile {
  id: string
  kind: ScopeKind
  source: SourceRef | null
  options: ScopeOptions
  /** Grid placement, in workspace grid cells. */
  grid: { col: number; row: number; colSpan: number; rowSpan: number }
}

export interface Workspace {
  id: string
  name: string
  /** Grid the tiles are placed on. */
  columns: number
  rows: number
  tiles: Tile[]
  interpretation: SignalInterpretation
}

// ---------------------------------------------------------------------------
// The renderer's view of its backend
// ---------------------------------------------------------------------------

export interface RendererApi {
  capabilities: Capabilities

  atem: {
    connect(host: string): Promise<void>
    disconnect(): Promise<void>
    getStatus(): Promise<ConnectionStatus>
    getSnapshot(): Promise<AtemSnapshot | null>
    onStatus(cb: (status: ConnectionStatus) => void): () => void
    onSnapshot(cb: (snapshot: AtemSnapshot) => void): () => void
  }

  decklink: {
    list(): Promise<CaptureDevice[]>
    /** Resolves to the id of a MediaStream-compatible source, or throws if unsupported. */
    open(deviceId: string): Promise<void>
    close(deviceId: string): Promise<void>
  }

  store: {
    getCalibration(key: string): Promise<CalibrationProfile | null>
    saveCalibration(profile: CalibrationProfile): Promise<void>
    listWorkspaces(): Promise<Workspace[]>
    saveWorkspace(workspace: Workspace): Promise<void>
    deleteWorkspace(id: string): Promise<void>
  }
}

declare global {
  interface Window {
    api: RendererApi
  }
}
