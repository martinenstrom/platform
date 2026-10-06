/**
 * The bridge between the page and the desktop host — deliberately narrow.
 *
 * The page may ask the host to pick a folder or a file, to open a path in
 * the operating system, to relaunch, and to read or set "start with
 * Windows". Nothing else of the host reaches the page: no file system, no
 * process, no module loader.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('financialOsDesktop', {
  info: () => ipcRenderer.invoke('fos:info'),
  chooseFolder: (title) => ipcRenderer.invoke('fos:choose-folder', title ?? null),
  chooseFile: (options) => ipcRenderer.invoke('fos:choose-file', options ?? null),
  openPath: (path) => ipcRenderer.invoke('fos:open-path', path),
  relaunch: () => ipcRenderer.invoke('fos:relaunch'),
  autostart: {
    get: () => ipcRenderer.invoke('fos:autostart-get'),
    set: (enabled) => ipcRenderer.invoke('fos:autostart-set', Boolean(enabled)),
  },
})
