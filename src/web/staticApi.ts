import {
  STATIC_CAPABILITIES,
  type CalibrationProfile,
  type RendererApi,
  type Workspace
} from '../shared/protocol'

/**
 * The hosted build's backing for `window.api`.
 *
 * There is no switcher link and no DeckLink here, and that is a property of the
 * browser rather than a feature not yet written:
 *
 *   - The ATEM control protocol is UDP on port 9910. A page has no UDP API.
 *     WebRTC and WebTransport are negotiated transports, not sockets; neither
 *     can talk to a switcher that has never heard of them. simpleVIS documents
 *     the identical wall for Art-Net and sACN.
 *   - A DeckLink card is reached through Blackmagic's own SDK against a kernel
 *     driver. It does not enumerate as a webcam, so `getUserMedia` cannot see
 *     it. (Some Blackmagic *boxes* — UltraStudio Recorder 3G, the Web Presenter
 *     family — deliberately do present as UVC, and those work here like any
 *     other camera. The PCIe cards do not.)
 *
 * So the hosted build names multiview regions from what the user typed when
 * they drew them, and the switcher-facing calls below are rejected rather than
 * stubbed out to resolve quietly. `capabilities.atemLink` is false, the UI
 * never renders the control that would call them, and if one is ever reached
 * anyway the error says why rather than looking like a dropped connection.
 */

const CALIBRATION_KEY = 'atem-scopes.calibration'
const WORKSPACE_KEY = 'atem-scopes.workspaces'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing, or the quota is full. Losing a saved layout is not
    // worth taking the scopes down for.
  }
}

function unsupported(what: string): never {
  throw new Error(`${what} is not available in the browser build — see the desktop app.`)
}

export const staticApi: RendererApi = {
  capabilities: STATIC_CAPABILITIES,

  atem: {
    connect: () => unsupported('Switcher control'),
    disconnect: async () => {},
    getStatus: async () => 'disconnected',
    getSnapshot: async () => null,
    onStatus: () => () => {},
    onSnapshot: () => () => {}
  },

  decklink: {
    list: async () => [],
    open: () => unsupported('DeckLink capture'),
    close: async () => {}
  },

  store: {
    getCalibration: async (key) =>
      read<CalibrationProfile[]>(CALIBRATION_KEY, []).find((p) => p.key === key) ?? null,
    saveCalibration: async (profile) => {
      const all = read<CalibrationProfile[]>(CALIBRATION_KEY, [])
      write(CALIBRATION_KEY, [...all.filter((p) => p.key !== profile.key), profile])
    },
    listWorkspaces: async () => read<Workspace[]>(WORKSPACE_KEY, []),
    saveWorkspace: async (workspace) => {
      const all = read<Workspace[]>(WORKSPACE_KEY, [])
      write(WORKSPACE_KEY, [...all.filter((w) => w.id !== workspace.id), workspace])
    },
    deleteWorkspace: async (id) => {
      write(
        WORKSPACE_KEY,
        read<Workspace[]>(WORKSPACE_KEY, []).filter((w) => w.id !== id)
      )
    }
  }
}
