import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from './is'
import { installSeedCapabilities } from './capabilities/seedTools'
import { registerIpcHandlers } from './ipc/handlers'
import { maybeRunScheduledBackup, removeProjectSessionLock } from './persistence/backupStore'
import { openProject } from './persistence/projectStore'
import { getCurrentProjectSession } from './projectSession'

// Built main entry lives at out/main/index.js, so __dirname is out/main both
// in `npm run dev` (electron-vite still builds/watches into out/) and in a
// packaged app — resources/ sits two levels up, as a sibling of out/.
const iconPath = join(__dirname, '../../resources/icon.png')

// Main-process last resort: log-and-continue rather than letting a stray
// throw/rejection tear down the whole app. Same philosophy as the
// seed-capabilities try/catch below — a single failed background operation
// (a persistence write, an IPC handler edge case) shouldn't take the window
// with it. We deliberately do NOT call app.quit()/process.exit() here.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException (continuing)', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection (continuing)', reason)
})

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

function removeCurrentProjectLock(): void {
  try {
    removeProjectSessionLock(getCurrentProjectSession().projectRoot)
  } catch {
    // No project open yet, or the lock is already gone.
  }
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

  // Round 10/Phase 9: scheduled automatic backups. A single fixed-tick poll
  // (rather than one setTimeout/setInterval re-armed per writer-configured
  // intervalMinutes) so a schedule change made mid-session in Settings
  // takes effect on the very next tick with no timer-teardown bookkeeping —
  // see backupStore.maybeRunScheduledBackup's own doc comment for how it
  // decides whether enough time has actually elapsed before creating one.
  // Wrapped in the same try/catch-and-swallow pattern
  // removeCurrentProjectLock() below already uses for "no project open yet"
  // (getCurrentProjectSession() throws in that case), since this tick runs
  // unconditionally regardless of whether a project happens to be open.
  const BACKUP_SCHEDULE_POLL_MS = 5 * 60_000
  setInterval(() => {
    void (async () => {
      try {
        const projectRoot = getCurrentProjectSession().projectRoot
        const manifest = await openProject(projectRoot)
        await maybeRunScheduledBackup(projectRoot, manifest)
      } catch (err) {
        // No project open yet, or a transient read/write failure — a missed
        // scheduled backup isn't worth surfacing to the writer; it's simply
        // retried on the next tick.
        if (!(err instanceof Error) || err.message !== 'No project is open yet') {
          console.error('[backups] scheduled-backup check failed', err)
        }
      }
    })()
  }, BACKUP_SCHEDULE_POLL_MS)

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

app.on('before-quit', () => {
  removeCurrentProjectLock()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    removeCurrentProjectLock()
    app.quit()
  }
})
