// Tıklama testi: gizli Electron penceresi her düğme/bağlantıya gerçekten tıklar — çalıştır: npm test
// Electron kurulu değilse atlanır (npm install).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let ELECTRON = null; try { ELECTRON = require('electron'); } catch {}
const TOOL = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'tools', 'shot.cjs');
const run = (html, out) => new Promise(res => { const env = { ...process.env, OFIS_SHOT_OFFLINE: '1' }; delete env.ELECTRON_RUN_AS_NODE; execFile(ELECTRON, [TOOL, html, out], { env, timeout: 150000, windowsHide: true }, () => res(JSON.parse(fs.readFileSync(path.join(out, 'sonuc.json'), 'utf8')))); });

test('tıklama testi: işlevsiz düğme, örtülen düğme, href="#" ve kırık hedef yakalanır; çalışanlar temiz', { skip: !ELECTRON && 'electron yok', timeout: 200000 }, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'livand-tik-'));
  try {
    fs.writeFileSync(path.join(d, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>T</title>
<style>.kapak{position:fixed;left:0;right:0;bottom:0;height:120px;background:rgba(0,0,0,.01)} body{min-height:2000px}</style></head><body>
<header><a href="#" class="logo">Logo</a><nav><a href="#hikaye">Hikaye</a><a href="#hikaye">Yine hikaye</a><a href="#yok">Kırık</a></nav></header>
<button id="calisan">Sayaç</button><span id="n">0</span><button>Sepete ekle</button><a href="#">Detay</a>
<a href="https://example.com" target="_blank">Dış</a><a href="tel:+902165551234">Ara</a><details><summary>SSS</summary>Cevap</details>
<form><input name="e"><button>Gönder</button></form>
<section id="hikaye" style="margin-top:900px"><h2>Hikaye</h2></section>
<button style="position:fixed;bottom:20px;left:20px">Alttaki</button><div class="kapak"></div>
<script>document.getElementById('calisan').onclick=()=>{n.textContent=+n.textContent+1}</script></body></html>`);
    const r = await run(path.join(d, 'index.html'), path.join(d, 'out'));
    assert.ok(!r.error, r.error);
    const m = r.errors.filter(e => e.startsWith('[mobil]')).join('\n');
    assert.match(m, /hiçbir şey olmuyor: "Sepete ekle"/); assert.match(m, /hiçbir şey olmuyor: "Detay"/);
    assert.match(m, /başka bir öğenin altında: "Alttaki → üstünde: div\.kapak"/); assert.match(m, /hedefi sayfada yok: "Kırık \(#yok\)"/);
    for (const ok of ['Sayaç', 'Hikaye', 'Yine hikaye', 'Logo', 'Dış', 'Ara', 'SSS', 'Gönder']) assert.doesNotMatch(m, new RegExp(`"${ok}`), ok + ' çalışıyor sayılmalı');
    assert.ok(r.pages.mobil.clicks >= 10);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
