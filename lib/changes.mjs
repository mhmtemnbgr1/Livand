// LIVAND Ofis — onaysız çalışan CLI'lerin (Codex, Antigravity) yaptığı değişikliklerin sonradan denetimi (saf işlevler, token harcamaz).
// Bu CLI'ler ofisin onay kutusuna bağlanamaz; bu yüzden her görevden sonra kayıt noktaları arasındaki fark okunur ve riskli
// değişiklikler kullanıcıya gösterilir (geri alma tek tıkla mümkün).

const EXEC = /\.(bat|cmd|ps1|psm1|vbs|vbe|wsf|sh|bash|exe|dll|msi|scr|com|jar|reg|lnk)$/i;
const SECRET = /(^|\/)(\.env(\.[\w-]+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|[\w-]*\.(pem|key|pfx|p12)|credentials(\.json)?|secrets?\.(json|ya?ml))$/i;
const CONFIG = /(^|\/)(\.github\/workflows\/|\.husky\/|\.git\/|\.vscode\/tasks\.json$|\.claude\/|\.codex\/|\.gemini\/|\.agents\/)/i;
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preuninstall', 'postuninstall'];

const pkg = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const deps = j => ({ ...(j?.dependencies || {}), ...(j?.devDependencies || {}), ...(j?.optionalDependencies || {}) });

// changes: [{status: A|M|D, file}]; pkgBefore/pkgAfter: package.json içerikleri (metin, yoksa null)
// → [{level: 'yuksek'|'orta', file, why}]
export function riskyChanges(changes = [], { pkgBefore = null, pkgAfter = null } = {}) {
  const out = [];
  for (const c of changes) {
    const f = String(c.file || '').replace(/\\/g, '/');
    if (c.status !== 'D' && EXEC.test(f)) out.push({ level: 'yuksek', file: f, why: 'çalıştırılabilir dosya ya da betik ' + (c.status === 'A' ? 'eklendi' : 'değişti') });
    if (c.status !== 'D' && SECRET.test(f)) out.push({ level: 'yuksek', file: f, why: 'gizli bilgi/kimlik dosyası ' + (c.status === 'A' ? 'oluşturuldu' : 'değişti') });
    if (CONFIG.test(f)) out.push({ level: 'orta', file: f, why: 'araç/otomasyon ayarı değişti (CI, kanca, ajan ayarı)' });
  }
  const del = changes.filter(c => c.status === 'D');
  if (del.length >= 5 || (del.length && del.length >= changes.length / 2 && changes.length >= 4)) out.push({ level: 'yuksek', file: del.slice(0, 3).map(c => c.file).join(', ') + (del.length > 3 ? '…' : ''), why: `${del.length} dosya silindi` });
  const a = pkg(pkgAfter), b = pkg(pkgBefore);
  if (a) {
    const added = Object.keys(deps(a)).filter(k => !(k in deps(b)));
    if (added.length) out.push({ level: 'orta', file: 'package.json', why: 'yeni bağımlılık: ' + added.slice(0, 6).join(', ') + (added.length > 6 ? '…' : '') });
    const life = LIFECYCLE.filter(k => a.scripts?.[k] && a.scripts[k] !== b?.scripts?.[k]);
    if (life.length) out.push({ level: 'yuksek', file: 'package.json', why: 'kurulumda kendiliğinden çalışan betik: ' + life.map(k => `${k}="${String(a.scripts[k]).slice(0, 60)}"`).join(', ') });
  }
  return out;
}

export const changeSummary = (changes = []) => {
  const n = s => changes.filter(c => c.status === s).length;
  return `${changes.length} dosya (${n('A')} yeni, ${n('M')} değişti, ${n('D')} silindi)`;
};
