// README görsellerini üretir: docs/img/*.png ve docs/img/ofis-calisiyor.png (animasyonlu PNG / APNG).
// Test modunda (gerçek CLI çalışmaz, token harcanmaz) ve geçici bir veri klasörüyle çalışır: kendi verine ve CLI girişlerine dokunmaz.
// Çalıştırma: npm run shots
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..'), OUT = path.join(root, 'docs', 'img');
const PORT = 3990, BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ofis-shots-'));
app.setPath('userData', path.join(TMP, 'profile'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = (p, body) => fetch(BASE + '/api/' + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

// ---- APNG (bağımlılıksız): her karede sadece değişen dikdörtgen saklanır ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
function rgbaRows(bgra, W, x0, y0, w, h) {   // BGRA → RGBA, satır başına "Up" filtresi (sıkıştırmayı iyileştirir)
  const out = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1); out[o] = y ? 2 : 0;
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * W + x0 + x) * 4, d = o + 1 + x * 4, p = s - W * 4;
      const px = [bgra[s + 2], bgra[s + 1], bgra[s], 255];
      for (let k = 0; k < 4; k++) out[d + k] = y ? (px[k] - (k === 3 ? 255 : bgra[p + [2, 1, 0][k]])) & 255 : px[k];
    }
  }
  return out;
}
function apng(frames, W, H, delayMs) {
  const u32 = (...v) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', Buffer.concat([u32(W, H), Buffer.from([8, 6, 0, 0, 0])])), chunk('acTL', u32(frames.length, 0))];
  let seq = 0, prev = null;
  frames.forEach((f, i) => {
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (prev) {   // değişen bölge
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 4; if (Math.abs(f[s] - prev[s]) + Math.abs(f[s + 1] - prev[s + 1]) + Math.abs(f[s + 2] - prev[s + 2]) > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const fc = Buffer.concat([u32(seq++, w, h, x0, y0), Buffer.from([delayMs >> 8, delayMs & 255, 1000 >> 8, 1000 & 255, 0, 0])]);
    parts.push(chunk('fcTL', fc));
    const z = zlib.deflateSync(rgbaRows(f, W, x0, y0, w, h), { level: 9 });
    parts.push(i === 0 ? chunk('IDAT', z) : chunk('fdAT', Buffer.concat([u32(seq++), z])));
    prev = f;
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

app.whenReady().then(async () => {
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OFIS_DEMO: '1', OFIS_SHOWCASE: '1', OFIS_DEMO_MS: '5000', PORT: String(PORT), OFIS_DATA: path.join(TMP, 'data') } });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  const quit = code => { try { srv.kill(); } catch {} setTimeout(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} app.exit(code); }, 500); };
  try {
    for (let i = 0; !/Ofis hazır/.test(log); i++) { if (i > 100) throw new Error('sunucu açılmadı: ' + log); await sleep(100); }
    await api('settings', { lang: 'tr', providers: { codex: { on: true }, antigravity: { on: true } } });   // test modunda üç CLI de "bağlı" görünür
    const p = await api('projects', { name: 'Kahve Dükkanı Sitesi', template: 'landing', brief: 'Mahalledeki kahve dükkanım için tek sayfalık tanıtım sitesi: menü, çalışma saatleri, iletişim.' });

    const win = new BrowserWindow({ width: 1440, height: 900, show: true, backgroundColor: '#1c1a16', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } });
    await win.loadURL(BASE); await sleep(7000);
    const js = s => win.webContents.executeJavaScript(s);
    const shot = async (name, prep, wait = 1200) => { if (prep) await js(prep); await sleep(wait); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name), img.toPNG()); console.log('✓', name); };

    // çalışırken animasyon
    await api(`projects/${p.id}/plan`, { action: 'approve' });
    await sleep(6500);   // ajanlar masalarına geçip çalışmaya başlasın
    const W = 960, frames = []; let H = 0;
    for (let i = 0; i < 24; i++) {
      const img = (await win.webContents.capturePage()).resize({ width: W, quality: 'good' }); H = img.getSize().height;
      frames.push(img.toBitmap()); await sleep(450);
    }
    fs.writeFileSync(path.join(OUT, 'ofis-calisiyor.png'), apng(frames, W, H, 160)); console.log('✓ ofis-calisiyor.png (animasyon)');

    for (let i = 0; i < 120; i++) { const s = await api('state'); const q = s.projects.find(x => x.id === p.id); if (q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti')) break; await sleep(1000); }
    await api(`projects/${p.id}/finish`, { rating: 5, note: 'Sade ve hızlı oldu' }); await sleep(5000);

    await shot('ofis.png', "closeModal&&closeModal();openPanel();setTab('feed')", 2500);
    await shot('pano.png', "setTab('board')");
    await shot('gunluk.png', "setTab('log')");
    await shot('analiz.png', "setTab('anal');[...document.querySelectorAll('#anal .ch')].find(e=>/CLI sağlayıcıları/.test(e.textContent))?.scrollIntoView({block:'start'})");
    await shot('ajan.png', "editAgent('developer')");
    await shot('duzenle.png', "closeModal();setEdit(true)", 2000);
    quit(0);
  } catch (e) { console.error(e); quit(1); }
});
