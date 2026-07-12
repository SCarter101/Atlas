import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from './is'
import { registerIpcHandlers } from './ipc/handlers'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#FAF8F5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev) {
    // Renderer console output doesn't otherwise reach the terminal that
    // launched Electron — surfacing it here makes dev issues visible
    // without needing to open DevTools by hand.
    window.webContents.on('console-message', (_evt, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    window.webContents.on('render-process-gone', (_evt, details) => {
      console.log('[renderer-process-gone]', details)
    })
    window.webContents.on('did-fail-load', (_evt, code, desc) => {
      console.log('[did-fail-load]', code, desc)
    })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpcHandlers(() => window.webContents)
  return window
}

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
