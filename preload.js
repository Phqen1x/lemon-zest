const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readFileAsDataURL: (filePath) => ipcRenderer.invoke('read-file-as-dataurl', filePath),
  saveFileDialog: (dataURL) => ipcRenderer.invoke('save-file-dialog', dataURL),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close')
});
