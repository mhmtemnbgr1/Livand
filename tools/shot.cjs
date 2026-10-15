// LIVAND Ofis — görsel doğrulama: bir HTML sayfasını gizli Electron penceresinde açar, masaüstü ve mobil TAM SAYFA ekran görüntüsü alır,
// konsol/sayfa hatalarını toplar. Kullanım: electron shot.cjs <sayfa.html> <çıktı klasörü>  → stdout'a JSON
// Tam sayfa: sayfa ekran yüksekliği kadar dilimlerle kaydırılarak çekilir (masaustu-1.png, masaustu-2.png…). Pencereyi sayfa boyuna
// büyütmek yerine kaydırıyoruz: büyütmek 100vh bölümleri şişirir ve kaydırınca beliren (IntersectionObserver) öğeleri gizli bırakır.
// Çekmeden önce ağın boşalması (networkidle), web fontları (document.fonts.ready) ve görsellerin yüklenmesi beklenir.
// Güvenlik: sayfa sandbox'ta, node erişimi olmadan açılır. Dış ağda yalnızca font/CDN/görsel sunucularından GET isteğine izin var
// (OFIS_SHOT_OFFLINE=1 hepsini kapatır); gerisi engellenir ve uyarı olarak raporlanır.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const [html, outDir] = process.argv.slice(-2);
const SIZES = [['masaustu', 1280, 800, false], ['mobil', 390, 844, true]];
const MAX_TILES = 6;   // görünüm başına en fazla dilim (masaüstünde ~4800px)
const ALLOW_HOSTS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.bunny\.net|api\.fontshare\.com|cdn\.fontshare\.com|use\.typekit\.net|p\.typekit\.net|rsms\.me|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdn\.tailwindcss\.com|code\.jquery\.com|images\.unsplash\.com|picsum\.photos|fastly\.picsum\.photos)$/i;
const OFFLINE = process.env.OFIS_SHOT_OFFLINE === '1';
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();
// sonuç hem stdout'a hem <çıktı>/sonuc.json'a yazılır (Windows'ta Electron'un stdout'u her zaman bağlı olmayabilir)
const done = r => { const s = JSON.stringify(r); try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'sonuc.json'), s); } catch {} try { process.stdout.write(s + '\n'); } catch {} app.exit(0); };
app.on('window-all-closed', () => {});   // pencereler arasında uygulama kapanmasın
setTimeout(() => done({ error: 'zaman aşımı' }), 80000).unref?.();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const local = u => /^(file|data|blob|devtools|chrome-extension):/i.test(u);
const allowed = (u, method) => { if (local(u)) return true; if (OFFLINE || method !== 'GET') return false; try { const x = new URL(u); return x.protocol === 'https:' && ALLOW_HOSTS.test(x.hostname); } catch { return false; } };
const hostOf = u => { try { return new URL(u).hostname; } catch { return String(u).slice(0, 60); } };

// sayfa hazır mı: fontlar, görseller ve iki çizim karesi (çekimden hemen önce)
const SETTLE = `(async () => {
  const t = ms => new Promise(r => setTimeout(r, ms));
  await Promise.race([document.fonts ? document.fonts.ready : null, t(4000)]);
  await Promise.race([Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; }))), t(4000)]);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
})()`;

app.whenReady().then(async () => {
  try {
    if (!html || !fs.existsSync(html)) return done({ error: 'sayfa bulunamadı' });
    fs.mkdirSync(outDir, { recursive: true });
    const live = new Set(), blocked = new Set(), failedExt = new Set();
    let lastNet = Date.now();
    const wr = session.defaultSession.webRequest;
    wr.onBeforeRequest((d, cb) => {
      const ok = allowed(d.url, d.method);
      if (!ok) { blocked.add(hostOf(d.url)); return cb({ cancel: true }); }
      live.add(d.id); lastNet = Date.now(); cb({});
    });
    const end = d => { if (live.delete(d.id)) lastNet = Date.now(); };
    wr.onCompleted(end);
    wr.onErrorOccurred(d => { if (!local(d.url) && !/ERR_(BLOCKED_BY_CLIENT|ABORTED)/.test(d.error)) failedExt.add(hostOf(d.url)); end(d); });
    // networkidle: 500 ms boyunca açık istek yok (en fazla 10 sn beklenir)
    const idle = async () => { const t0 = Date.now(); while (Date.now() - t0 < 10000) { if (!live.size && Date.now() - lastNet > 500) return true; await sleep(100); } return false; };

    const errors = [], warnings = [], shots = [], pages = {};
    for (const [name, w, h, mobile] of SIZES) {
      const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.setFrameRate(30);
      if (mobile) win.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36');
      win.webContents.on('console-message', (...a) => {
        const e = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] };
        if (!(e.level === 'error' || e.level === 3)) return;
        const msg = `[${name}] ${String(e.message).slice(0, 200)}${e.sourceId ? ` (${path.basename(String(e.sourceId))}:${e.lineNumber})` : ''}`;
        (/net::ERR_(BLOCKED_BY_CLIENT|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION)/.test(e.message) ? warnings : errors).push(msg);   // engellenen/ulaşılamayan dış kaynak sayfanın hatası değildir
      });
      win.webContents.on('did-fail-load', (_e, code, desc, url, main) => { if (code !== -3 && main !== false) errors.push(`[${name}] yüklenemedi: ${desc} ${path.basename(String(url))}`); });
      await win.loadFile(html).catch(e => errors.push(`[${name}] ${e.message}`));
      await idle();
      const js = s => win.webContents.executeJavaScript(s).catch(() => null);
      await js(SETTLE);
      // sayfayı bir kez baştan sona kaydır: tembel yüklenen görseller ve kaydırınca beliren bölümler tetiklensin
      const H0 = (await js('document.documentElement.scrollHeight')) || h;
      for (let y = 0; y < Math.min(H0, h * MAX_TILES); y += Math.round(h * 0.8)) { await js(`window.scrollTo(0, ${y})`); await sleep(120); }
      await js('window.scrollTo(0, 0)'); await idle(); await js(SETTLE); await sleep(250);
      const m = await js('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), vh: window.innerHeight})');
      if (m && m.sw > m.cw + 2) errors.push(`[${name}] yatay taşma: sayfa ${m.sw}px, ekran ${m.cw}px`);
      const H = m?.h || h, vh = m?.vh || h, n = Math.max(1, Math.min(MAX_TILES, Math.ceil((H - 4) / vh)));
      for (let i = 0; i < n; i++) {
        await js(`window.scrollTo(0, ${i * vh})`); await js(SETTLE); await sleep(150);
        const img = await win.webContents.capturePage();
        const f = path.join(outDir, `${name}-${i + 1}.png`); fs.writeFileSync(f, img.toPNG()); shots.push(f);
      }
      pages[name] = { height: H, tiles: n, truncated: Math.ceil((H - 4) / vh) > n };
      win.destroy();
    }
    if (blocked.size) warnings.push(`Engellenen dış istekler (yalnızca font/CDN/görsel sunucularına izin var): ${[...blocked].slice(0, 6).join(', ')}`);
    if (failedExt.size) warnings.push(`Yüklenemeyen dış kaynaklar (ağ?): ${[...failedExt].slice(0, 6).join(', ')}`);
    done({ shots, pages, errors: [...new Set(errors)].slice(0, 20), warnings: [...new Set(warnings)].slice(0, 10) });
  } catch (e) { done({ error: e.message }); }
});
