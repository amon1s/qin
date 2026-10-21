const { app, BrowserWindow } = require('electron');
const path = require('path');
const express = require('express');

let server = null;
const PORT = 3000;

function startServer() {
  const expressApp = express();
  expressApp.use(express.json({ limit: '10mb' }));

  // Serve static React build files from dist directory
  expressApp.use(express.static(path.join(__dirname, 'dist')));

  // Embedded API proxy route (eliminates CORS / network errors)
  expressApp.all('/api/proxy', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, x-target-url');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
      const targetUrl = req.headers['x-target-url'];
      if (!targetUrl) return res.status(400).json({ error: 'Missing target URL' });

      const response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          ...(req.headers['authorization'] && { 'Authorization': req.headers['authorization'] }),
          ...(req.headers['x-api-key'] && { 'x-api-key': req.headers['x-api-key'] }),
          ...(req.headers['anthropic-version'] && { 'anthropic-version': req.headers['anthropic-version'] }),
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });

      res.status(response.status);
      response.headers.forEach((val, key) => {
        if (!['content-encoding', 'content-length'].includes(key.toLowerCase())) {
          res.setHeader(key, val);
        }
      });
      res.send(await response.text());
    } catch (err) {
      res.status(502).json({ error: 'Proxy failed', details: err?.message });
    }
  });

  server = expressApp.listen(PORT);
}

function createWindow() {
  startServer();
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Qin',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // Wait briefly for express to bind port 3000, then load
  setTimeout(() => mainWindow.loadURL(`http://localhost:${PORT}`), 400);

  mainWindow.on('closed', () => {
    if (server) server.close();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});
