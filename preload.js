const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoro', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  setSizeLocked: (flag) => ipcRenderer.invoke('window:setSizeLocked', flag),
  toggleFullscreen: (restoreSize) => ipcRenderer.invoke('window:toggleFullscreen', restoreSize),
  setMinimizeToTray: (flag) => ipcRenderer.invoke('window:setMinimizeToTray', flag),
  setCloseToTray: (flag) => ipcRenderer.invoke('window:setCloseToTray', flag),
  getDisplays: () => ipcRenderer.invoke('window:getDisplays'),
  snapToCorner: (displayId, corner) => ipcRenderer.invoke('window:snapToCorner', { displayId, corner }),
  resizeWindow: (width, height) => ipcRenderer.invoke('window:resize', { width, height }),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  closeNotification: () => ipcRenderer.invoke('notify:close'),
  pickBackgroundImage: () => ipcRenderer.invoke('background:pick'),
  clearBackgroundImage: () => ipcRenderer.invoke('background:clear'),
  getBackgroundImage: () => ipcRenderer.invoke('background:get'),
});
