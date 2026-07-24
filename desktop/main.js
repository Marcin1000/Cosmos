/**
 * Cosmos — aplikacja desktopowa (Electron)
 *
 * Uruchamia wbudowany serwer Cosmos i otwiera UI w natywnym oknie.
 *   npm install          (jednorazowo — pobiera Electrona)
 *   npm run desktop      (uruchamia aplikację okienkową)
 *   npm run dist         (buduje instalator .exe dla Windows)
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const cosmos = require('../server.js');

const PORT = Number(process.env.PORT || 3777);

let win = null;

async function createWindow() {
  await cosmos.start(PORT);

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#05060a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icons', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // linki zewnętrzne otwieraj w systemowej przeglądarce
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`http://localhost:${PORT}`);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});
