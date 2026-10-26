/**
 * Qin — Electron main process.
 *
 * Owns three things:
 *   1. Persistence of the encrypted vault / ledger / settings as JSON files in
 *      the app's userData directory (~/.config/qin on Linux).
 *   2. A loopback-only proxy the renderer talks to same-origin, so no CORS
 *      workaround and no `webSecurity: false` are needed.
 *   3. The window, with a locked-down sandbox posture.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { createProxyApp } = require('./proxy.cjs');

const PROXY_HOST = '127.0.0.1';
// Per-launch secret. The renderer gets it through the preload bridge; anything
// else on the machine (or the LAN) gets 401.
const PROXY_TOKEN = crypto.randomBytes(32).toString('hex');
const DEV_SERVER_URL = process.env.QIN_DEV_SERVER_URL || '';

// Only these keys may be read or written through the storage bridge, so a
// compromised renderer cannot scribble arbitrary files into userData.
const STORAGE_KEYS = new Set(['vault', 'vault_meta', 'ledger', 'settings']);

let server = null;
let proxyPort = 0;
let mainWindow = null;

/* ------------------------------------------------------------------ storage */

function storageDir() {
  return app.getPath('userData');
}

function fileFor(key) {
  if (!STORAGE_KEYS.has(key)) throw new Error(`Unknown storage key: ${key}`);
  return path.join(storageDir(), `${key}.json`);
}

async function readStore(key) {
  try {
    return JSON.parse(await fsp.readFile(fileFor(key), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeStore(key, value) {
  const target = fileFor(key);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  // 0600: the vault holds an encrypted payload, the ledger holds prompt
  // snippets. Neither should be world-readable.
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, target);
}

async function removeStore(key) {
  try {
    await fsp.unlink(fileFor(key));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function registerStorageHandlers() {
  ipcMain.on('qin:config', event => {
    event.returnValue = {
      proxyPort,
      proxyToken: PROXY_TOKEN,
      userDataPath: storageDir(),
      version: app.getVersion(),
    };
  });

  ipcMain.handle('qin:storage:get', (_event, key) => readStore(key));
  ipcMain.handle('qin:storage:set', async (_event, key, value) => {
    await writeStore(key, value);
    return true;
  });
  ipcMain.handle('qin:storage:remove', async (_event, key) => {
    await removeStore(key);
    return true;
  });
  ipcMain.handle('qin:storage:keys', async () => {
    const entries = await Promise.all(
      [...STORAGE_KEYS].map(async key => ((await readStore(key)) === null ? null : key))
    );
    return entries.filter(Boolean);
  });

  ipcMain.handle('qin:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
}

/* ------------------------------------------------------------------- window */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Qin',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // The renderer holds decrypted API keys in memory. Any injected markup
      // must not be able to reach Node.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const targetUrl = DEV_SERVER_URL || `http://${PROXY_HOST}:${proxyPort}`;
  mainWindow.loadURL(targetUrl);

  // No in-app navigation away from our own origin, and no popup windows.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(targetUrl)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* --------------------------------------------------------------------- boot */

function startServer() {
  return new Promise((resolve, reject) => {
    const proxyApp = createProxyApp({
      proxyToken: PROXY_TOKEN,
      distDir: path.join(__dirname, 'dist'),
      version: app.getVersion(),
    });

    // Port 0 lets the OS pick a free port, which removes the whole class of
    // EADDRINUSE failures when a second copy (or something else on 3000) runs.
    server = proxyApp.listen(0, PROXY_HOST, () => {
      proxyPort = server.address().port;
      resolve(proxyPort);
    });

    server.on('error', reject);
  });
}

// A second launch should focus the existing window instead of failing to bind
// a port and looking broken.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerStorageHandlers();
    try {
      await startServer();
    } catch (err) {
      console.error('[qin] proxy failed to start:', err);
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

function shutdown() {
  if (server) {
    server.close();
    server = null;
  }
}

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdown);
