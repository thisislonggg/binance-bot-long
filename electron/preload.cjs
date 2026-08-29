const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  version: process.versions.electron,
  isDesktop: true,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  reload: () => ipcRenderer.send("app:reload"),
});
