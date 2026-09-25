const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoro', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  setMinimizeToTray: (flag) => ipcRenderer.invoke('window:setMinimizeToTray', flag),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  getDisplays: () => ipcRenderer.invoke('window:getDisplays'),
  snapToCorner: (displayId, corner) => ipcRenderer.invoke('window:snapToCorner', { displayId, corner }),
  resizeWindow: (width, height) => ipcRenderer.invoke('window:resize', { width, height }),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
});
