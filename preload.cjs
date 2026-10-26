/**
 * Qin preload bridge.
 *
 * Runs in an isolated world with `sandbox: true` and `contextIsolation: true`,
 * so the renderer never gets Node, `require`, or the raw IPC surface. Only the
 * narrow API below is exposed, on `window.qin`.
 */

const { contextBridge, ipcRenderer } = require('electron');

// One synchronous round-trip at startup: the renderer needs the proxy port and
// auth token before its first request, and there is no safe way to hand them
// over through argv in a sandboxed preload.
let config = { proxyPort: 0, proxyToken: '', userDataPath: '', version: '0.0.0' };
try {
  config = ipcRenderer.sendSync('qin:config');
} catch (err) {
  // Leave the defaults: the renderer will surface "proxy unavailable" rather
  // than crashing the window.
  console.error('[qin] failed to read main-process config:', err);
}

contextBridge.exposeInMainWorld('qin', {
  config: Object.freeze({ ...config }),

  storage: {
    get: key => ipcRenderer.invoke('qin:storage:get', key),
    set: (key, value) => ipcRenderer.invoke('qin:storage:set', key, value),
    remove: key => ipcRenderer.invoke('qin:storage:remove', key),
    keys: () => ipcRenderer.invoke('qin:storage:keys'),
  },

  // Renderer is never allowed to spawn windows itself.
  openExternal: url => ipcRenderer.invoke('qin:open-external', url),
});
