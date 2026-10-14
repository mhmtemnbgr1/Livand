// Masaüstü penceresi: sunucuyu başlatır ve Edge/Chrome'u adres çubuksuz "uygulama" penceresinde açar (ek indirme gerekmez).
// Kendi profil klasörünü (data/app-profile) kullanır; tarayıcının kişisel profiline dokunmaz. Pencere kapanınca sunucu da kapanır.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000, url = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const up = async () => { try { return (await fetch(url + '/api/state')).ok; } catch { return false; } };

let server = null;
if (!(await up())) {
  server = spawn(process.execPath, [path.join(dir, 'server.js')], { cwd: dir, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(250);
}
const profile = path.join(dir, 'data', 'app-profile');
const tryApp = browser => new Promise(resolve => {
  const t0 = Date.now();
  const c = spawn('cmd', ['/c', 'start', '/wait', '', browser, `--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore', windowsHide: true });
  c.on('close', code => resolve(code !== 0 && Date.now() - t0 < 2500 ? 'yok' : 'kapandı'));
});
let r = await tryApp('msedge'); if (r === 'yok') r = await tryApp('chrome');
if (r === 'yok') { console.log(`Edge/Chrome bulunamadı. Tarayıcıdan aç: ${url}`); spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true }); }
else { server?.kill(); process.exit(0); }
