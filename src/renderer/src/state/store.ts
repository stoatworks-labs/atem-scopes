import { create } from 'zustand'
import { DEFAULT_INTERPRETATION, type SignalInterpretation } from '@shared/colorimetry'
import { seedWindows } from '@shared/multiviewLayout'
import {
  calibrationKey,
  DEFAULT_SCOPE_OPTIONS,
  type AtemSnapshot,
  type CalibrationProfile,
  type ConnectionStatus,
  type DeviceRole,
  type ScopeKind,
  type SourceRef,
  type Tile,
  type Workspace
} from '@shared/protocol'

export interface DeviceEntry {
  deviceId: string
  label: string
  role: DeviceRole
  multiViewerIndex: number
}

export type ViewMode = 'wall' | 'calibrate'

interface State {
  devices: DeviceEntry[]
  snapshot: AtemSnapshot | null
  atemStatus: ConnectionStatus
  atemHost: string
  calibrations: Record<string, CalibrationProfile>
  workspace: Workspace
  mode: ViewMode
  calibrateDeviceId: string | null
  selectedTileId: string | null

  addDevice: (entry: DeviceEntry) => void
  removeDevice: (deviceId: string) => void
  setDeviceRole: (deviceId: string, role: DeviceRole) => void
  setDeviceMultiViewer: (deviceId: string, index: number) => void

  setSnapshot: (snapshot: AtemSnapshot | null) => void
  setAtemStatus: (status: ConnectionStatus) => void
  setAtemHost: (host: string) => void

  putCalibration: (profile: CalibrationProfile) => void
  ensureCalibration: (
    deviceId: string,
    width: number,
    height: number,
    multiViewerIndex: number
  ) => CalibrationProfile

  setInterpretation: (interpretation: SignalInterpretation) => void
  addTile: (kind: ScopeKind) => void
  removeTile: (id: string) => void
  updateTile: (id: string, patch: Partial<Tile>) => void
  setTileSource: (id: string, source: SourceRef | null) => void
  setWorkspace: (workspace: Workspace) => void

  setMode: (mode: ViewMode) => void
  setCalibrateDevice: (deviceId: string | null) => void
  selectTile: (id: string | null) => void
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * A starting wall: the picture plus the three scopes anyone opens first. Tiles
 * land unassigned — a source cannot be guessed before a device is open, and a
 * tile pointed at the wrong window is worse than an empty one.
 */
function defaultWorkspace(): Workspace {
  const kinds: ScopeKind[] = ['picture', 'waveformLuma', 'vectorscope', 'histogram']
  return {
    id: newId(),
    name: 'Default',
    columns: 4,
    rows: 2,
    interpretation: { ...DEFAULT_INTERPRETATION },
    tiles: [
      { kind: 'picture', grid: { col: 0, row: 0, colSpan: 2, rowSpan: 2 } },
      { kind: 'waveformLuma', grid: { col: 2, row: 0, colSpan: 2, rowSpan: 1 } },
      { kind: 'vectorscope', grid: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
      { kind: 'histogram', grid: { col: 3, row: 1, colSpan: 1, rowSpan: 1 } }
    ].map((t, i) => ({
      id: newId(),
      kind: kinds[i],
      source: null,
      options: { ...DEFAULT_SCOPE_OPTIONS },
      grid: t.grid
    }))
  }
}

/** Places a new tile in the first free cell, or stacks it in the last row if the grid is full. */
function nextFreeCell(workspace: Workspace): { col: number; row: number } {
  const taken = new Set<string>()
  for (const tile of workspace.tiles) {
    for (let c = tile.grid.col; c < tile.grid.col + tile.grid.colSpan; c++) {
      for (let r = tile.grid.row; r < tile.grid.row + tile.grid.rowSpan; r++) {
        taken.add(`${c},${r}`)
      }
    }
  }
  for (let row = 0; row < workspace.rows; row++) {
    for (let col = 0; col < workspace.columns; col++) {
      if (!taken.has(`${col},${row}`)) return { col, row }
    }
  }
  return { col: 0, row: workspace.rows }
}

export const useStore = create<State>((set, get) => ({
  devices: [],
  snapshot: null,
  atemStatus: 'disconnected',
  atemHost: '',
  calibrations: {},
  workspace: defaultWorkspace(),
  mode: 'wall',
  calibrateDeviceId: null,
  selectedTileId: null,

  addDevice: (entry) =>
    set((s) => ({
      devices: s.devices.some((d) => d.deviceId === entry.deviceId)
        ? s.devices
        : [...s.devices, entry]
    })),

  removeDevice: (deviceId) =>
    set((s) => ({
      devices: s.devices.filter((d) => d.deviceId !== deviceId),
      // Tiles pointed at a closed device keep their source rather than being
      // silently blanked: closing a device to re-open it is routine, and
      // rebuilding the wall each time would be maddening.
      calibrateDeviceId: s.calibrateDeviceId === deviceId ? null : s.calibrateDeviceId
    })),

  setDeviceRole: (deviceId, role) =>
    set((s) => ({ devices: s.devices.map((d) => (d.deviceId === deviceId ? { ...d, role } : d)) })),

  setDeviceMultiViewer: (deviceId, multiViewerIndex) =>
    set((s) => ({
      devices: s.devices.map((d) => (d.deviceId === deviceId ? { ...d, multiViewerIndex } : d))
    })),

  setSnapshot: (snapshot) => set({ snapshot }),
  setAtemStatus: (atemStatus) => set({ atemStatus }),
  setAtemHost: (atemHost) => set({ atemHost }),

  putCalibration: (profile) =>
    set((s) => ({ calibrations: { ...s.calibrations, [profile.key]: profile } })),

  ensureCalibration: (deviceId, width, height, multiViewerIndex) => {
    const key = calibrationKey(deviceId, width, height)
    const existing = get().calibrations[key]
    if (existing) return existing

    // Seed from the switcher's own layout bitfield when there is a link, and
    // from a plain grid when there is not. Either way it is marked `seeded`
    // until a human has looked at it.
    const mv = get().snapshot?.multiViewers.find((m) => m.index === multiViewerIndex) ?? null
    const indices = mv ? mv.windows.map((w) => w.windowIndex) : [0, 1, 2, 3]
    const { windows } = seedWindows(mv?.layout ?? null, indices)
    const profile: CalibrationProfile = { key, multiViewerIndex, windows, seeded: true }
    set((s) => ({ calibrations: { ...s.calibrations, [key]: profile } }))
    return profile
  },

  setInterpretation: (interpretation) =>
    set((s) => ({ workspace: { ...s.workspace, interpretation } })),

  addTile: (kind) =>
    set((s) => {
      const cell = nextFreeCell(s.workspace)
      const tile: Tile = {
        id: newId(),
        kind,
        source: null,
        options: { ...DEFAULT_SCOPE_OPTIONS },
        grid: { ...cell, colSpan: 1, rowSpan: 1 }
      }
      return {
        workspace: {
          ...s.workspace,
          rows: Math.max(s.workspace.rows, cell.row + 1),
          tiles: [...s.workspace.tiles, tile]
        },
        selectedTileId: tile.id
      }
    }),

  removeTile: (id) =>
    set((s) => ({
      workspace: { ...s.workspace, tiles: s.workspace.tiles.filter((t) => t.id !== id) },
      selectedTileId: s.selectedTileId === id ? null : s.selectedTileId
    })),

  updateTile: (id, patch) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        tiles: s.workspace.tiles.map((t) => (t.id === id ? { ...t, ...patch } : t))
      }
    })),

  setTileSource: (id, source) =>
    set((s) => ({
      workspace: {
        ...s.workspace,
        tiles: s.workspace.tiles.map((t) => (t.id === id ? { ...t, source } : t))
      }
    })),

  setWorkspace: (workspace) => set({ workspace }),
  setMode: (mode) => set({ mode }),
  setCalibrateDevice: (calibrateDeviceId) => set({ calibrateDeviceId }),
  selectTile: (selectedTileId) => set({ selectedTileId })
}))
