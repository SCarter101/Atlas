import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from './is'
import { installSeedCapabilities } from './capabilities/seedTools'
import { registerIpcHandlers } from './ipc/handlers'

// Built main entry lives at out/main/index.js, so __dirname is out/main both
// in `npm run dev` (electron-vite still builds/watches into out/) and in a
// packaged app — resources/ sits two levels up, as a sibling of out/.
const iconPath = join(__dirname, '../../resources/icon.png')

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#FAF8F5',
    autoHideMenuBar: true,
    icon: iconPath,
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

void app.whenReady().then(async () => {
  // app.getName() / OS-level naming (e.g. macOS menu bar). Windows taskbar
  // grouping additionally needs an explicit AppUserModelID.
  app.setName('Atlas')
  app.setAppUserModelId('com.atlas.desktop')

  // Spec §7 Phase 3 development-mode seed capabilities — idempotent (see
  // installSeedCapabilities' existsSync guard), so this is safe to run on
  // every launch. Failure here (e.g. an unwritable userData path) is logged
  // and swallowed rather than crashing the app — the Tool & Skill Library
  // just starts without the three seed tools in that case.
  try {
    await installSeedCapabilities()
  } catch (err) {
    console.error('[capabilities] failed to install seed capabilities', err)
  }
  // NOTE: in unpackaged dev mode (`npm run dev`), Windows will still show
  // "Electron.exe" as the underlying binary's file description in some
  // places (e.g. hovering the taskbar icon) — that string is embedded in
  // electron.exe itself, not something app.setName()/setAppUserModelId()
  // can override. Window icon, window title, taskbar icon, and
  // app.getName() are all correctly "Atlas" within what dev mode allows;
  // fully renaming the underlying executable requires a packaged build via
  // electron-builder (see the "build" config in package.json), which is
  // out of scope here.
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
