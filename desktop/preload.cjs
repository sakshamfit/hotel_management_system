/**
 * Preload — exposes a tiny, read-only runtime descriptor to the React app so
 * it knows it is inside the Desktop Edition (and can talk to /local/api).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__NEXORA_RUNTIME__', {
  mode: 'local',
  version: '1.0.0',
  platform: process.platform,
  getMeta: () => ipcRenderer.invoke('nexora:meta'),
});
