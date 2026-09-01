/**
 * NEXORA HOTEL OS — Desktop Edition (Electron shell).
 *
 * 1. Boots the bundled offline server (dist/server-local.cjs) on a random
 *    localhost port, with the SQLite data dir inside the user's app data.
 * 2. Opens a normal desktop window pointed at that local server — the same
 *    React app, but 100% offline.
 *
 * No browser, no terminal, no installation of databases — exactly the
 * Marg-style experience the buyer expects.
 */
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let localServer = null;

const DIST_DIR = (() => {
  const asar = path.join(__dirname, '..', 'dist');
  const unpacked = asar.replace('app.asar', 'app.asar.unpacked');
  return fs.existsSync(unpacked) ? unpacked : asar;
})();

async function bootServer() {
  const mod = require(path.join(DIST_DIR, 'server-local.cjs'));
  const dataDir = path.join(app.getPath('userData'), 'nexora-data');
  localServer = await mod.startFromMain({
    dataDir,
    staticDir: DIST_DIR,
    version: app.getVersion(),
    port: 0, // OS picks a free port
  });
  return localServer;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'NEXORA Hotel OS',
    backgroundColor: '#1d1d1f',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(url);

  // Open any external links (docs, seller site) in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://')) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(localServer?.localUrl || 'http://127.0.0.1')) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function start() {
  Menu.setApplicationMenu(null);
  const server = await bootServer();
  createWindow(server.localUrl);
  console.log(`[nexora] desktop ready → ${server.localUrl} (data: ${server.store.dbPath})`);
}

// Single instance — focus the existing window when a second copy starts.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start).catch((err) => {
    console.error('[nexora] failed to start:', err);
    app.quit();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', async () => {
  try {
    if (localServer) await localServer.close();
  } catch {
    /* ignore */
  }
});

ipcMain.handle('nexora:meta', () => ({
  mode: 'local',
  version: app.getVersion(),
  platform: process.platform,
}));
