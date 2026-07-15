import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { is } from './is'
import { installSeedCapabilities } from './capabilities/seedTools'
import { registerIpcHandlers } from './ipc/handlers'
import { removeProjectSessionLock } from './persistence/backupStore'
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

  // Content-Security-Policy: before this, ZERO CSP existed anywhere in the
  // app (no <meta> tag, no header). Applied via onHeadersReceived so it
  // covers every response the renderer's webContents loads, not just the
  // top-level document load. Baseline policy, validated against this app's
  // actual network surface: every OpenRouter/LM Studio HTTP call happens in
  // the MAIN process (main/agent/providers/*, main/retrieval/embeddings/*),
  // which is entirely outside the renderer CSP's jurisdiction — connect-src
  // deliberately does NOT list those hosts.
  //
  // `style-src 'unsafe-inline'` is a deliberate, accepted trade-off: the
  // renderer makes extensive use of React inline `style={{}}` throughout
  // (see CLAUDE.md's Round 3 inline-hex-color note), and there's no
  // practical nonce/hash scheme for React's dynamically-constructed style
  // objects. `style-src`/`font-src` allow Google Fonts because
  // renderer/index.html loads Source Serif 4 / Public Sans from
  // fonts.googleapis.com (which itself serves the actual font files from
  // fonts.gstatic.com).
  //
  // `script-src`/`connect-src` are relaxed ONLY in dev (`is.dev`, the same
  // packaged-vs-unpackaged check used elsewhere in this file). Verified
  // empirically via a real `npm run dev` boot (see CLAUDE.md's Phase 9
  // writeup) that a fully strict `script-src 'self'` breaks two distinct
  // things in dev mode, not one: (1) Vite's HMR client itself needs
  // `'unsafe-eval'` (its module-transform/fast-refresh plumbing uses
  // eval-based sourcemaps), and (2) — the concrete failure actually
  // observed in the console — `@vitejs/plugin-react` injects a literal
  // *inline* `<script>` preamble tag into the dev HTML for Fast Refresh
  // preamble detection, which needs `'unsafe-inline'` too; without it the
  // browser refused to run it and every component using Fast Refresh threw
  // "@vitejs/plugin-react can't detect preamble". `connect-src` needs a
  // `ws:` origin back to the local Vite dev server for the HMR socket.
  // NOTE: `app.isPackaged` (what `is.dev` is derived from) stays `false`
  // even under `electron-vite preview`/`npm start` against the built out/
  // bundle in this environment — Electron only flips it once launched from
  // a real electron-builder-packaged executable, which hasn't been produced
  // yet (Track A). So the strict branch below could only be checked
  // statically here: the built `out/renderer/index.html` has exactly one
  // `<script type="module" src="...">` tag and zero inline scripts, and a
  // production Vite bundle doesn't rely on eval — neither of the two dev-
  // only relaxations has anything to grant permission to once packaged.
  // Confirming this holds against a *real* packaged build is Track A's
  // installer-boot verification, not repeated here.
  const scriptSrc = is.dev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self'"
  const connectSrc = is.dev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'"
  const cspHeader = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    connectSrc
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader]
      }
    })
  })

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

app.on('before-quit', () => {
  removeCurrentProjectLock()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    removeCurrentProjectLock()
    app.quit()
  }
})
