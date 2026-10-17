// LIVAND Ofis — git tabanlı kayıt noktaları (geri alma).
// Projenin çalışma klasörü için uygulamanın veri klasöründe AYRI bir "gölge" git deposu tutulur (GIT_DIR=data/snaps/<proje>/repo.git,
// GIT_WORK_TREE=çalışma klasörü). Kullanıcının kendi .git'ine, dallarına ve ayarlarına dokunulmaz; git kendi .git klasörlerini zaten atlar.
// Kopyalamaya göre farkı: yalnızca değişen dosyalar saklanır, boyut sınırı yoktur (görselli oyun projeleri de geri alınabilir).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SHA_RE = /^[0-9a-f]{40}$/;
const EXCLUDE = ['node_modules/', '.agents/mcp_config.json', '*.tmp', '~$*', 'Thumbs.db', 'desktop.ini'];
// kullanıcının genel git ayarları (kancalar, imza, satır sonu dönüşümü) gölge depoyu etkilemesin
const CFG = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.longpaths=true', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false',
  '-c', 'commit.gpgsign=false', '-c', 'gc.auto=0', '-c', 'user.name=LIVAND', '-c', 'user.email=ofis@livand.local'];

let gitOk = null;
export function gitAvailable() {
  if (gitOk !== null) return Promise.resolve(gitOk);
  return new Promise(r => execFile('git', ['--version'], { windowsHide: true, timeout: 10000 }, e => r(gitOk = !e)));
}

function git(repo, work, args, { timeout = 120000 } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
  Object.assign(env, { GIT_DIR: repo, GIT_WORK_TREE: work, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
  return new Promise((resolve, reject) => execFile('git', [...CFG, ...args], { cwd: work, env, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 },
    (e, out, err) => e ? reject(new Error(String(err || e.message).trim().split('\n').slice(-2).join(' '))) : resolve(String(out))));
}

// aynı depoda git komutları sırayla çalışsın (paralel görevler aynı anda kayıt noktası alır → index.lock çakışması olmasın)
const queues = new Map();
function locked(repo, fn) {
  const prev = queues.get(repo) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(repo, next.catch(() => {}));
  return next;
}

async function ensure(repo, work) {
  if (!fs.existsSync(path.join(repo, 'HEAD'))) {
    fs.mkdirSync(repo, { recursive: true });
    await git(repo, work, ['init', '-q']);
  }
  const ex = path.join(repo, 'info', 'exclude');
  fs.mkdirSync(path.dirname(ex), { recursive: true });
  fs.writeFileSync(ex, EXCLUDE.join('\n') + '\n');
}

// Çalışma klasörünün o anki hâlini kaydeder; kayıt noktasının kimliğini (commit sha) döndürür. Değişiklik yoksa da yeni bir nokta açılır.
export function checkpoint(repo, work, message) {
  return locked(repo, async () => {
    await ensure(repo, work);
    await git(repo, work, ['add', '-A', '--', '.']);
    await git(repo, work, ['commit', '-q', '--allow-empty', '--no-verify', '-m', String(message || 'kayıt noktası').slice(0, 200)]);
    return (await git(repo, work, ['rev-parse', 'HEAD'])).trim();
  });
}

const parseStatus = out => out.split('\n').filter(Boolean).map(l => { const [st, ...ps] = l.split('\t'); return { status: st[0], file: ps[ps.length - 1] }; });

// İki kayıt noktası arasında değişen dosyalar: [{status: A|M|D|R, file}]
export function changes(repo, work, from, to) {
  if (!SHA_RE.test(from) || !SHA_RE.test(to)) return Promise.resolve([]);
  return locked(repo, async () => parseStatus(await git(repo, work, ['diff', '--name-status', '--no-renames', from, to])));
}

// Bir kayıt noktasındaki dosyanın içeriği (risk denetimi için; yoksa null)
export function fileAt(repo, work, sha, file) {
  if (!SHA_RE.test(sha)) return Promise.resolve(null);
  return locked(repo, () => git(repo, work, ['show', `${sha}:${file}`]).catch(() => null));
}

export function exists(repo, work, sha) {
  if (!SHA_RE.test(sha) || !fs.existsSync(path.join(repo, 'HEAD'))) return Promise.resolve(false);
  return locked(repo, () => git(repo, work, ['cat-file', '-e', `${sha}^{commit}`]).then(() => true, () => false));
}

// Klasörü kayıt noktasındaki hâline döndürür. Önce şimdiki hâl kaydedilir (geri almanın kendisi de geri alınabilsin).
// Sonradan oluşan dosyalar SİLİNMEZ: trash klasörüne taşınır. Değişen ve silinen dosyalar kayıt noktasından geri yazılır.
export async function restore(repo, work, sha, trash) {
  if (!SHA_RE.test(sha)) throw new Error('geçersiz kayıt noktası');
  if (!(await exists(repo, work, sha))) throw new Error('Kayıt noktası bulunamadı');
  const before = await checkpoint(repo, work, 'geri almadan önce');
  return locked(repo, async () => {
    const diff = parseStatus(await git(repo, work, ['diff', '--name-status', '--no-renames', sha, before]));
    const moved = [];
    for (const d of diff.filter(x => x.status === 'A')) {
      const src = path.join(work, d.file), dst = path.join(trash, d.file);
      try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(src, dst); moved.push(d.file); } catch {}
    }
    const back = diff.filter(x => x.status !== 'A').map(x => x.file);
    for (let i = 0; i < back.length; i += 200) await git(repo, work, ['checkout', sha, '--', ...back.slice(i, i + 200)]);   // uzun komut satırı sınırı
    await git(repo, work, ['reset', '-q', '--mixed', before]);   // dizin (index) son kayıt noktasında kalsın; dosyalar geri yüklenmiş hâliyle durur
    return { restored: back.length, moved, trash: moved.length ? trash : null, before };
  });
}
