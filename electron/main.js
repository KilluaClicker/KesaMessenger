const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 950, minHeight: 650,
    backgroundColor: '#090d1b',
    title: 'KESA',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, '..', 'client', 'index.html'));
  win.webContents.setWindowOpenHandler(({url}) => { shell.openExternal(url); return {action:'deny'}; });
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });