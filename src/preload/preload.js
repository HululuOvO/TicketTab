'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ticketAPI', {
  getState: () => ipcRenderer.invoke('ticket:get-state'),
  setActiveDate: (dateKey) => ipcRenderer.invoke('ticket:set-active-date', dateKey),
  addTask: (text, priority = 'normal', dateKey = null) => ipcRenderer.invoke('ticket:add', { text, priority, dateKey }),
  importClipboard: () => ipcRenderer.invoke('ticket:import-clipboard'),
  importText: (text) => ipcRenderer.invoke('ticket:import-text', text),
  copyText: (text) => ipcRenderer.invoke('ticket:copy-text', text),
  toggleTask: (id) => ipcRenderer.invoke('ticket:toggle', id),
  updateTask: (id, patch) => ipcRenderer.invoke('ticket:update', { id, patch }),
  deleteTask: (id) => ipcRenderer.invoke('ticket:delete', id),
  clearDone: () => ipcRenderer.invoke('ticket:clear-done'),
  setExpanded: (expanded) => ipcRenderer.invoke('ticket:set-expanded', expanded),
  setIgnoreMouse: (ignore) => ipcRenderer.send('ticket:set-ignore-mouse', Boolean(ignore)),
  updateSettings: (patch) => ipcRenderer.invoke('ticket:update-settings', patch),
  testReminder: (taskId) => ipcRenderer.invoke('ticket:test-reminder', taskId),
  dragMove: (screenX, screenY) => ipcRenderer.send('ticket:drag-move', { screenX, screenY }),
  dragEnd: (screenX, screenY) => ipcRenderer.invoke('ticket:drag-end', { screenX, screenY }),
  onStateChange: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('ticket:state', listener);
    return () => ipcRenderer.removeListener('ticket:state', listener);
  }
});
