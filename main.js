const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;

function showError(title, detail) {
  if (!mainWindow) return;
  const html = `<!DOCTYPE html>
<html style="margin:0;background:#0a0a0a;height:100vh;font-family:'Segoe UI',sans-serif;color:#e8e8e8;overflow:auto;">
<body style="padding:32px;margin:0;">
  <div style="max-width:800px;margin:0 auto;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
      <div style="width:40px;height:40px;background:#c9f135;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#0a0a0a;font-weight:800;font-size:14px;flex-shrink:0;">LF</div>
      <div style="color:#c9f135;font-size:20px;font-weight:700;">LeadFinder</div>
    </div>
    <div style="color:#f03d3d;font-size:18px;font-weight:700;margin-bottom:16px;">&#9888; ${escHtml(title)}</div>
    <pre style="background:#141414;border:1px solid #1e1e1e;border-radius:8px;padding:20px;font-size:12px;color:#c8c8c8;white-space:pre-wrap;word-break:break-all;line-height:1.6;">${escHtml(detail)}</pre>
    <p style="font-size:12px;color:#484848;margin-top:16px;">Bitte sende diesen Fehler an den Support.</p>
  </div>
</body>
</html>`;
  mainWindow.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function waitForServer(port, retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${port}/api/stats`, res => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        attempts++;
        if (attempts >= retries) return reject(new Error('Server did not start in time'));
        setTimeout(check, 500);
      });
      req.setTimeout(1000, () => { req.destroy(); });
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
  const loadingHtml = Buffer.from(`<!DOCTYPE html>
<html style="margin:0;background:#0a0a0a;height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',sans-serif;">
<body style="margin:0;display:flex;flex-direction:column;align-items:center;gap:16px;">
  <div style="width:48px;height:48px;background:#c9f135;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#0a0a0a;font-weight:800;font-size:16px;">LF</div>
  <div style="color:#c9f135;font-size:18px;font-weight:600;letter-spacing:0.05em;">LeadFinder startet\u2026</div>
</body>
</html>`).toString('base64');
  mainWindow.loadURL('data:text/html;base64,' + loadingHtml);
  mainWindow.show();

  // Catch unhandled errors from async server code
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    if (mainWindow && !mainWindow.webContents.getURL().startsWith('http://localhost')) {
      showError('Unerwarteter Fehler', err.stack || err.message);
    }
  });

  // Start server
  try {
    require('./server');
  } catch (e) {
    showError('Server konnte nicht gestartet werden', e.stack || e.message || String(e));
    return;
  }

  // Wait until server responds
  try {
    await waitForServer(3737);
    mainWindow.loadURL('http://localhost:3737');
  } catch (e) {
    showError(
      'Server antwortet nicht',
      'Port 3737 konnte nicht erreicht werden.\n\n' +
      'Mögliche Ursachen:\n' +
      '- Port 3737 wird von einem anderen Programm belegt\n' +
      '- Windows Firewall blockiert den Port\n' +
      '- Der Server ist abgestürzt\n\n' +
      e.message
    );
  }

  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => app.quit());
