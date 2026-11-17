// Bridges the few things a web page can't do on its own: the Dock badge, bouncing the Dock, update notices, the hub.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apojiDesktop', {
  badge: n => ipcRenderer.send('badge', n),
  attention: () => ipcRenderer.send('attention'),
  version: () => ipcRenderer.invoke('version'),
  onUpdate: fn => ipcRenderer.on('update', (_e, u) => fn(u)),
  // 1.2: the Mac hub (Tailscale, phone notifications, keep awake, schedules)
  hub: {
    status: fresh => ipcRenderer.invoke('hub:status', !!fresh),
    set: patch => ipcRenderer.invoke('hub:set', patch),
    lid: on => ipcRenderer.invoke('hub:lid', !!on),
    lidRevoke: () => ipcRenderer.invoke('hub:lidRevoke'),
    push: ev => ipcRenderer.invoke('hub:push', ev),
    note: ev => ipcRenderer.invoke('hub:note', ev),
    removeDevice: id => ipcRenderer.invoke('hub:removeDevice', id),
    onNudge: fn => ipcRenderer.on('hub:nudge', (_e, w) => fn(w)),
    onChange: fn => ipcRenderer.on('hub:changed', (_e, s) => fn(s))
  }
});
// Room for the window buttons, and a draggable title bar
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('desktop-app'));
