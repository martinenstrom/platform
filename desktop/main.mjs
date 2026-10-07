/**
 * Financial OS on Windows: the desktop host.
 *
 * One process, one window, no server. The host resolves where a person's
 * data lives, loads the built application in-process and answers the
 * window's requests over the application's own scheme — pages and server
 * functions by function call, assets from disk. It keeps one instance,
 * opens external links in the browser rather than in itself, and offers
 * the page a narrow bridge (see `preload.cjs`).
 *
 * The host knows nothing of clients, offices or packs. The application
 * does; the host only tells it which mode it runs in and where its data
 * directory is, through the environment, before the application loads.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dataLayout } from './paths.mjs'
import { createAppHandler } from './serve.mjs'

/* The host's own modules come through `require`: Electron's ESM loader does not expose them as named exports here. */
const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } =
  createRequire(import.meta.url)('electron')

/*
 * The application's name, set before any path is resolved. Electron reads
 * its name from package.json, whose `name` is the repository's and not the
 * product's, and keeps a person's data under `%APPDATA%\<name>`; measured on
 * the installed application, that put the data root under a template's
 * name. The name is the product's, so the root is `…\Financial OS\Financial
 * OS` and the single-instance lock, which keys on the same path, is the
 * product's too.
 */
app.setName('Financial OS')

/*
 * The two hooks the application and the host share, by well-known symbol
 * rather than by import: the host lends the operating system's sealing
 * (DPAPI) for the backup passphrase, and the application registers how it
 * wants to be closed in order. Neither side imports the other.
 */
const SECRETS_KEY = Symbol.for('financial-os:secrets')
const SHUTDOWN_KEY = Symbol.for('financial-os:shutdown')

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const clientDir = join(appRoot, 'dist', 'client')
const serverEntry = join(appRoot, 'dist', 'server', 'server.js')
const APP_ORIGIN = 'app://financial-os'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/* One Financial OS at a time: a second launch hands over to the first and leaves. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox('Financial OS kunde inte starta', describe(error))
      app.exit(1)
    })
  /*
   * A controlled end: the application's shutdown hook — the pending
   * snapshot, the database closed in order — runs before the process goes.
   * The quit is held once, for that, and then let through.
   */
  let closing = false
  app.on('before-quit', (event) => {
    if (closing) return
    const shutdown = globalThis[SHUTDOWN_KEY]
    if (typeof shutdown !== 'function') return
    closing = true
    event.preventDefault()
    Promise.resolve()
      .then(() => shutdown())
      .catch(() => {})
      .finally(() => app.exit(0))
  })
  app.on('window-all-closed', () => app.quit())
}

async function start() {
  const layout = dataLayout(resolveDataRoot())
  loadConfigEnv(join(layout.config, 'financial-os.env'))
  process.env.FINANCIAL_OS_MODE = process.env.FINANCIAL_OS_MODE || 'desktop'
  process.env.FINANCIAL_OS_DATA_DIR = layout.root
  process.env.FINANCIAL_OS_APP_VERSION = packageVersion()
  process.env.NODE_ENV = 'production'
  globalThis[SECRETS_KEY] = {
    available: safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
  }

  const server = (await import(pathToFileURL(serverEntry).href)).default
  protocol.handle(
    'app',
    createAppHandler({ clientDir, fetch: (request) => server.fetch(request) }),
  )
  registerBridge(layout)
  Menu.setApplicationMenu(null)

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#060910',
    title: 'Financial OS',
    icon: join(appRoot, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  /* Links to the outside open outside. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/u.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault()
      if (/^https?:/u.test(url)) void shell.openExternal(url)
    }
  })
  await win.loadURL(`${APP_ORIGIN}/`)
}

/** The data directory: an explicit override (tests, a portable install), else the operating system's. */
function resolveDataRoot() {
  const override = process.env.FINANCIAL_OS_DATA_DIR?.trim()
  return override ? override : join(app.getPath('userData'), 'Financial OS')
}

/**
 * `config/financial-os.env` in the data directory: the person's own keys
 * (market data, research, voice), one `NAME=value` per line. Loaded into the
 * process before the application starts; never logged; never overriding a
 * variable the environment already carries.
 */
function loadConfigEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1)
    process.env[key] = value
  }
}

function registerBridge(layout) {
  ipcMain.handle('fos:info', () => ({
    version: packageVersion(),
    dataDir: layout.root,
    platform: process.platform,
  }))
  ipcMain.handle('fos:choose-folder', async (_event, title) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Välj mapp',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('fos:choose-file', async (_event, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title ?? 'Välj fil',
      filters: options?.filters ?? [],
      properties: ['openFile'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('fos:open-path', async (_event, path) => {
    if (typeof path !== 'string' || !path.startsWith(layout.root)) return 'refused'
    return shell.openPath(path)
  })
  ipcMain.handle('fos:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })
  /* "Start with Windows": off until the person turns it on here; never set by the installer. */
  ipcMain.handle('fos:autostart-get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('fos:autostart-set', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled === true })
    return app.getLoginItemSettings().openAtLogin
  })
}

function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** The application's own version, from its package: Electron's `getVersion` reports Electron's when the host runs unpackaged. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version || app.getVersion()
  } catch {
    return app.getVersion()
  }
}
