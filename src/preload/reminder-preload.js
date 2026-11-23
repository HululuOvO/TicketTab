'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reminderAPI', {
  onShow: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('reminder:show', listener);
    return () => ipcRenderer.removeListener('reminder:show', listener);
  },
  respond: (payload) => ipcRenderer.send('reminder:action', payload)
});
