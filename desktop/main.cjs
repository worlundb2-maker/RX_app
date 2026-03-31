const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5000);
const APP_URL = `http://${HOST}:${PORT}`;
const BOOTSTRAP_URL = `${APP_URL}/api/bootstrap`;

let serverProcess = null;
let mainWindow = null;

function getAppRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, '..');
}

function getDataRoot() {
  return path.join(app.getPath('userData'), 'local-data');
}

function getTsxCliPath(appRoot) {
  return path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

function getServerEntryPath(appRoot) {
  return path.join(appRoot, 'server', 'index.ts');
}

function startServer() {
  const appRoot = getAppRoot();
  const tsxCli = getTsxCliPath(appRoot);
  const serverEntry = getServerEntryPath(appRoot);

  serverProcess = spawn(process.execPath, [tsxCli, serverEntry, '--production'], {
    cwd: appRoot,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      USE_DIST: '1',
      PORT: String(PORT),
      RX_APP_ROOT: appRoot,
      RX_APP_DATA_ROOT: getDataRoot(),
    },
    windowsHide: true,
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0) {
      dialog.showErrorBox(
        'Pharmacy Analytics failed to start',
        'The local analytics server exited unexpectedly. Please reopen the app.'
      );
    }
  });
}

async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BOOTSTRAP_URL);
      if (response.ok) return;
    } catch (_error) {
      // ignore until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for local server startup');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function launch() {
  startServer();
  await waitForServer();
  createWindow();
  await mainWindow.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  try {
    await launch();
  } catch (error) {
    dialog.showErrorBox('Pharmacy Analytics', `Unable to open the local app.\n\n${error.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
