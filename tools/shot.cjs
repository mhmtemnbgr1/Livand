// LIVAND Ofis — görsel doğrulama: bir HTML sayfasını gizli Electron penceresinde açar, masaüstü ve mobil ekran görüntüsü alır,
// konsol/sayfa hatalarını toplar. Kullanım: electron shot.cjs <sayfa.html> <çıktı klasörü>  → stdout'a JSON
// Güvenlik: sayfa sandbox'ta, node erişimi olmadan açılır; dış ağ istekleri engellenir (yalnızca file:// ve data:).
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const [html, outDir] = process.argv.slice(-2);
const SIZES = [['masaustu', 1280, 800, false], ['mobil', 390, 844, true]];
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
// sonuç hem stdout'a hem <çıktı>/sonuc.json'a yazılır (Windows'ta Electron'un stdout'u her zaman bağlı olmayabilir)
const done = r => { const s = JSON.stringify(r); try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'sonuc.json'), s); } catch {} try { process.stdout.write(s + '\n'); } catch {} app.exit(0); };
app.on('window-all-closed', () => {});   // pencereler arasında uygulama kapanmasın
setTimeout(() => done({ error: 'zaman aşımı' }), 40000).unref?.();

app.whenReady().then(async () => {
  try {
    if (!html || !fs.existsSync(html)) return done({ error: 'sayfa bulunamadı' });
    fs.mkdirSync(outDir, { recursive: true });
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools):/i.test(d.url) }));
    const errors = [], shots = [];
    for (const [name, w, h, mobile] of SIZES) {
      const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      if (mobile) win.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36');
      win.webContents.on('console-message', (...a) => {
        const e = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] };
        if (e.level === 'error' || e.level === 3) errors.push(`[${name}] ${String(e.message).slice(0, 200)}${e.sourceId ? ` (${path.basename(String(e.sourceId))}:${e.lineNumber})` : ''}`);
      });
      win.webContents.on('did-fail-load', (_e, code, desc, url) => { if (code !== -3) errors.push(`[${name}] yüklenemedi: ${desc} ${path.basename(String(url))}`); });
      await win.loadFile(html).catch(e => errors.push(`[${name}] ${e.message}`));
      await new Promise(r => setTimeout(r, 1500));
      const scroll = await win.webContents.executeJavaScript('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight})').catch(() => null);
      if (scroll && scroll.sw > scroll.cw + 2) errors.push(`[${name}] yatay taşma: sayfa ${scroll.sw}px, ekran ${scroll.cw}px`);
      const img = await win.webContents.capturePage();
      const f = path.join(outDir, `${name}.png`); fs.writeFileSync(f, img.toPNG()); shots.push(f);
      win.destroy();
    }
    done({ shots, errors: [...new Set(errors)].slice(0, 20) });
  } catch (e) { done({ error: e.message }); }
});
