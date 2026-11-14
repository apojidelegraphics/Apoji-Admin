// Bridges the few things a web page can't do on its own: the Dock badge, bouncing the Dock, update notices.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apojiDesktop', {
  badge: n => ipcRenderer.send('badge', n),
  attention: () => ipcRenderer.send('attention'),
  version: () => ipcRenderer.invoke('version'),
  onUpdate: fn => ipcRenderer.on('update', (_e, u) => fn(u))
});
// Room for the window buttons, and a draggable title bar
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('desktop-app'));
