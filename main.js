const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

app.whenReady().then(async () => {
  // Set writable paths before loading server
  if (app.isPackaged) {
    process.env.DATA_DIR        = path.join(app.getPath('userData'), 'data');
    process.env.PUBLIC_DIR      = path.join(process.resourcesPath, 'public');
    process.env.SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots');
  }

  // Start Express server
  require('./server');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'LeadFinder',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#0a0a0a',
    show: false
  });

  mainWindow.setMenuBarVisibility(false);

  // Wait for server to boot
  await new Promise(r => setTimeout(r, 1500));

  mainWindow.loadURL('http://localhost:3737');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => app.quit());
