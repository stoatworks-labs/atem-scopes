import { contextBridge, ipcRenderer } from 'electron'
import type {
  AtemSnapshot,
  CalibrationProfile,
  Capabilities,
  ConnectionStatus,
  RendererApi,
  Workspace
} from '../shared/protocol'

/**
 * The Electron backing for `window.api`.
 *
 * `capabilities` has to be a plain value rather than a promise, because
 * components read it during render to decide what to show at all. It is fetched
 * synchronously once here, before the renderer's first paint.
 */
const capabilities = ipcRenderer.sendSync('capabilities:sync') as Capabilities | undefined

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api: RendererApi = {
  capabilities: capabilities ?? { atemLink: true, decklinkCapture: false, persistence: true },

  atem: {
    connect: (host) => ipcRenderer.invoke('atem:connect', host),
    disconnect: () => ipcRenderer.invoke('atem:disconnect'),
    getStatus: () => ipcRenderer.invoke('atem:status'),
    getSnapshot: () => ipcRenderer.invoke('atem:snapshot'),
    onStatus: (cb) => subscribe<ConnectionStatus>('atem:status', cb),
    onSnapshot: (cb) => subscribe<AtemSnapshot>('atem:snapshot', cb)
  },

  decklink: {
    list: () => ipcRenderer.invoke('decklink:list'),
    open: (id) => ipcRenderer.invoke('decklink:open', id),
    close: (id) => ipcRenderer.invoke('decklink:close', id)
  },

  store: {
    getCalibration: (key: string) => ipcRenderer.invoke('store:getCalibration', key),
    saveCalibration: (p: CalibrationProfile) => ipcRenderer.invoke('store:saveCalibration', p),
    listWorkspaces: () => ipcRenderer.invoke('store:listWorkspaces'),
    saveWorkspace: (w: Workspace) => ipcRenderer.invoke('store:saveWorkspace', w),
    deleteWorkspace: (id: string) => ipcRenderer.invoke('store:deleteWorkspace', id)
  }
}

contextBridge.exposeInMainWorld('api', api)
