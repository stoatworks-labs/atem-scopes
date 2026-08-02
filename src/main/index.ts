import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { atemConnection } from './services/atemConnection'
import * as decklink from './services/decklink'
import * as store from './services/store'
import type { CalibrationProfile, Capabilities, Workspace } from '../shared/protocol'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0c0e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function capabilities(): Capabilities {
  return {
    atemLink: true,
    decklinkCapture: decklink.isAvailable(),
    persistence: true
  }
}

function registerIpc(): void {
  // Synchronous on purpose: the renderer branches on capabilities during its
  // first render, so it cannot be waiting on a promise to know whether the
  // switcher panel exists at all.
  ipcMain.on('capabilities:sync', (event) => {
    event.returnValue = capabilities()
  })
  ipcMain.handle('decklink:unavailableReason', () => decklink.unavailableReason())

  ipcMain.handle('atem:connect', (_e, host: string) => atemConnection.connect(host))
  ipcMain.handle('atem:disconnect', () => atemConnection.disconnect())
  ipcMain.handle('atem:status', () => atemConnection.getStatus())
  ipcMain.handle('atem:snapshot', () => atemConnection.getSnapshot())

  ipcMain.handle('decklink:list', () => decklink.listDevices())
  ipcMain.handle('decklink:open', (_e, id: string) => decklink.openDevice(id))
  ipcMain.handle('decklink:close', (_e, id: string) => decklink.closeDevice(id))

  ipcMain.handle('store:getCalibration', (_e, key: string) => store.getCalibration(key))
  ipcMain.handle('store:saveCalibration', (_e, p: CalibrationProfile) => store.saveCalibration(p))
  ipcMain.handle('store:listWorkspaces', () => store.listWorkspaces())
  ipcMain.handle('store:saveWorkspace', (_e, w: Workspace) => store.saveWorkspace(w))
  ipcMain.handle('store:deleteWorkspace', (_e, id: string) => store.deleteWorkspace(id))

  atemConnection.on('status', (status) => mainWindow?.webContents.send('atem:status', status))
  atemConnection.on('snapshot', (snapshot) =>
    mainWindow?.webContents.send('atem:snapshot', snapshot)
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.stoatworks.atem-scopes')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  atemConnection.disconnect()
  if (process.platform !== 'darwin') app.quit()
})
