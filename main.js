const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;

function waitForServer(port, retries = 20) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http.get(`http://localhost:${port}/api/stats`, res => {
        resolve();
      }).on('error', () => {
        attempts++;
        if (attempts >= retries) return reject(new Error('Server did not start'));
        setTimeout(check, 500);
      });
    };
    check();
  });
}

app.whenReady().then(async () => {
  if (app.isPackaged) {
    process.env.DATA_DIR        = path.join(app.getPath('userData'), 'data');
    process.env.PUBLIC_DIR      = path.join(process.resourcesPath, 'public');
    process.env.SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots');
  }

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
    backgroundColor: '#0a0a0a'
  });

  mainWindow.setMenuBarVisibility(false);

  // Show loading screen immediately so window is visible
  mainWindow.loadURL('data:text/html,<html style="background:%230a0a0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:%23c9f135;font-size:18px;">LeadFinder startet…</html>');
  mainWindow.show();

  // Start server
  try {
    require('./server');
  } catch (e) {
    mainWindow.loadURL('data:text/html,<html style="background:%230a0a0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:%23f03d3d;font-size:16px;">Server-Fehler: ' + e.message + '</html>');
    return;
  }

  // Wait until server responds
  try {
    await waitForServer(3737);
    mainWindow.loadURL('http://localhost:3737');
  } catch (e) {
    mainWindow.loadURL('data:text/html,<html style="background:%230a0a0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:%23f03d3d;font-size:16px;">Server antwortet nicht. Port 3737 blockiert?</html>');
  }

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => app.quit());
