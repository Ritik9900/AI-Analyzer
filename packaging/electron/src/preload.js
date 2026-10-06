"use strict";
// Minimal, explicit bridge for the activation window only. The main app window gets no preload.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pa", {
  info: () => ipcRenderer.invoke("pa:info"),
  activate: (key) => ipcRenderer.invoke("pa:activate", key),
  copy: (text) => ipcRenderer.invoke("pa:copy", text),
  quit: () => ipcRenderer.invoke("pa:quit"),
});
