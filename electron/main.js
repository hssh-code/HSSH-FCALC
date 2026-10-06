// Desktop wrapper: opens the same index.html the browser version uses in a
// native window. Nothing here touches the calculator itself.
const { app, BrowserWindow, nativeTheme, shell } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 400,
    minHeight: 560,
    title: 'HSSH FCalc',
    icon: path.join(ROOT, 'assets', 'icons', 'icon-512.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1419' : '#edf0f3',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'index.html'));

  // Links to websites open in the default browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
