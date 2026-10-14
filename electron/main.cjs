// Electron ile gerçek masaüstü uygulaması (kurulum: `npm install electron`, çalıştırma: `npm run electron`).
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// profil ve önbellek proje klasöründe kalsın (kullanıcı klasörlerine yazma)
const DATA = path.join(__dirname, '..', 'data', 'electron-profile');
app.setPath('userData', DATA); app.setPath('sessionData', path.join(DATA, 'session')); app.setPath('crashDumps', path.join(DATA, 'crash')); app.setPath('logs', path.join(DATA, 'logs'));
process.env.PORT = process.env.PORT || '3000';
const URL_ = `http://127.0.0.1:${process.env.PORT}`;
let win = null;

// bellek: V8 boyut için optimize, yazım denetimi kapalı (metin kutularında gereksiz sözlük yüklenmesin)
app.commandLine.appendSwitch('js-flags', '--optimize-for-size');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#1c1a16', title: 'Ofis', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true } });
  let normal = null;
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // mini mod: aynı pencere küçülür ve hep üstte kalır (ikinci bir 3B sahne yüklenmez, ekran kararmaz)
    if (frameName === 'ofis-mini-on') { if (!normal) normal = { b: win.getBounds(), max: win.isMaximized() }; if (win.isMaximized()) win.unmaximize(); win.setMinimumSize(360, 260); const wa = require('electron').screen.getDisplayMatching(win.getBounds()).workArea; win.setBounds({ width: 480, height: 360, x: wa.x + wa.width - 500, y: wa.y + wa.height - 380 }); win.setAlwaysOnTop(true, 'floating'); return { action: 'deny' }; }
    if (frameName === 'ofis-mini-off') { win.setAlwaysOnTop(false); win.setMinimumSize(900, 600); if (normal) { win.setBounds(normal.b); if (normal.max) win.maximize(); normal = null; } return { action: 'deny' }; }
    if (url.startsWith(URL_) && frameName === 'ofis-mini') return { action: 'allow', overrideBrowserWindowOptions: { width: 480, height: 360, alwaysOnTop: true, autoHideMenuBar: true, icon: path.join(__dirname, 'icon.ico'), backgroundColor: '#1c1a16', title: 'Ofis (mini)' } };
    if (/^https?:/i.test(url) && !url.startsWith(URL_)) shell.openExternal(url); return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL_)) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL(URL_);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try { await require('electron').session.defaultSession.clearCache(); } catch {}   // güncellenen arayüz dosyaları her açılışta taze yüklensin
  await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);   // sunucu bu işlemin içinde başlar (port doluysa mevcut oturuma bağlanır)
  await new Promise(r => setTimeout(r, 600));
  createWindow();
});
// grafik süreci çökerse (ekran kararması) pencereyi otomatik yenile; sorun sürerse OFIS_NO_GPU=1 ile donanım hızlandırmayı kapat
if (process.env.OFIS_NO_GPU) app.disableHardwareAcceleration();
app.on('child-process-gone', (e, d) => { if (d.type === 'GPU' && win) setTimeout(() => win && win.webContents.reload(), 800); });
app.on('render-process-gone', () => { if (win) setTimeout(() => win && win.webContents.reload(), 800); });
app.on('window-all-closed', () => app.quit());
