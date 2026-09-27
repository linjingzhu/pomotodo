const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoro', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  onPrepareQuit: (callback) => {
    ipcRenderer.on('app:prepareQuit', async () => {
      try {
        await callback();
        ipcRenderer.send('app:quitPrepared', null);
      } catch {
        ipcRenderer.send('app:quitPrepared', true);
      }
    });
    ipcRenderer.send('app:rendererReady');
  },
  resetConfig: () => ipcRenderer.invoke('settings:resetConfig'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  setSizeLocked: (flag) => ipcRenderer.invoke('window:setSizeLocked', flag),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  setPanelOpen: (open) => ipcRenderer.invoke('window:setPanelOpen', open),
  resetSize: () => ipcRenderer.invoke('window:resetSize'),
  fitAspect: (keep, width, height) => ipcRenderer.invoke('window:fitAspect', { keep, width, height }),
  setProgress: (state, fraction, label) => ipcRenderer.send('window:progress', { state, fraction, label }),
  moveStart: () => ipcRenderer.send('window:moveStart'),
  moveEnd: () => ipcRenderer.send('window:moveEnd'),
  resizeStart: (edge) => ipcRenderer.send('window:resizeStart', { edge }),
  resizeEnd: () => ipcRenderer.send('window:resizeEnd'),
  onSuspend: (callback) => ipcRenderer.on('power:suspend', () => callback()),
  onFullscreenChange: (callback) => ipcRenderer.on('window:fullscreen', (_evt, on) => callback(on)),
  setMinimizeToTray: (flag) => ipcRenderer.invoke('window:setMinimizeToTray', flag),
  setCloseToTray: (flag) => ipcRenderer.invoke('window:setCloseToTray', flag),
  getDisplays: () => ipcRenderer.invoke('window:getDisplays'),
  snapToCorner: (displayId, corner) => ipcRenderer.invoke('window:snapToCorner', { displayId, corner }),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  confirmResetSession: () => ipcRenderer.invoke('confirm:resetSession'),
  closeNotification: () => ipcRenderer.invoke('notify:close'),
  onPointerInside: (callback) => ipcRenderer.on('window:pointer', (_evt, inside) => callback(inside)),
  pickBackgroundImage: () => ipcRenderer.invoke('background:pick'),
  clearBackgroundImage: () => ipcRenderer.invoke('background:clear'),
  getBackgroundImage: () => ipcRenderer.invoke('background:get'),
  addSession: (session) => ipcRenderer.invoke('records:addSession', session),
  updateSessionNote: (id, note) => ipcRenderer.invoke('records:updateNote', { id, note }),
  deleteSession: (id) => ipcRenderer.invoke('records:deleteSession', id),
  hasAnyRecords: () => ipcRenderer.invoke('records:hasAny'),
  confirmResetAllRecords: () => ipcRenderer.invoke('confirm:resetAllRecords'),
  resetAllRecords: () => ipcRenderer.invoke('records:resetAll'),
  getMonthRecords: (month) => ipcRenderer.invoke('records:month', month),
  listGoals: () => ipcRenderer.invoke('goals:list'),
  addGoal: (title, groupId) => ipcRenderer.invoke('goals:add', { title, groupId }),
  renameGoal: (id, title) => ipcRenderer.invoke('goals:rename', { id, title }),
  setGoalDone: (id, done) => ipcRenderer.invoke('goals:setDone', { id, done }),
  deleteGoal: (id) => ipcRenderer.invoke('goals:delete', id),
  reorderGoal: (id, beforeId) => ipcRenderer.invoke('goals:reorder', { id, beforeId }),
  setGoalGroup: (id, groupId) => ipcRenderer.invoke('goals:setGroup', { id, groupId }),
  listGroups: () => ipcRenderer.invoke('groups:list'),
  addGroup: (name) => ipcRenderer.invoke('groups:add', name),
  renameGroup: (id, name) => ipcRenderer.invoke('groups:rename', { id, name }),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),
});
