// 3B izometrik ofis — Kenney Furniture Kit + Mini Characters (CC0), Three.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildWorld, setSky } from './world.js';

const NX = 16, NZ = 14, FS = 2.2;
const CHAR_H = 1.05;                         // karakterin ayakta boyu
const SIT_RAISE = 0.42;                      // oturma pozunda karakteri koltuk yüksekliğine çıkarır
const SPEED = 1.6;   // birim/sn (yürüme animasyonu bu hıza göre ölçeklenir)
const DOOR = [8, 0.3], COFFEE = [15.0, 1.5], COFFEE_AT = [15.3, 0.6];
let REDUCED = false; try { REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
const ACT_TXT = { read: 'Okuyor', search: 'Arıyor', write: 'Yazıyor', run: 'Çalıştırıyor', delegate: 'Yardımcı', think: 'Düşünüyor' };                       // kapı (arka duvar, açıklık x=7..9)
let QUALITY = (() => { try { return localStorage.getItem('quality') || (innerWidth > 1000 ? 'high' : 'low'); } catch { return 'high'; } })();

// ---- masalar dinamik: her ajanın kendi masası (ajan eklenince/silinince değişir) ----
const DESKS = {};                            // id -> [x, z]
const deskGroups = {};
const SLOT_USER = [2.5, 3.2], SLOT_CEO = [6.5, 3.2];
const SLOTS = [[2.5, 6.6], [6.5, 6.6], [10.5, 6.6], [2.5, 10.0], [6.5, 10.0], [10.5, 10.0], [2.5, 13.4], [6.5, 13.4], [10.5, 13.4]];
function slotFor(id) {
  if (id === 'user') return SLOT_USER; if (id === 'ceo') return SLOT_CEO;
  const used = new Set(Object.entries(DESKS).filter(([k]) => k !== 'user' && k !== 'ceo').map(([, v]) => v.join()));
  return SLOTS.find(s => !used.has(s.join())) || SLOTS[SLOTS.length - 1];
}
const KNOWN_MODEL = { user: 'male-a', ceo: 'female-a', designer: 'female-c', developer: 'male-b', researcher: 'male-d', writer: 'female-e', auditor: 'male-f' };
const EXTRA_MODELS = ['female-b', 'male-c', 'female-d', 'male-e', 'female-f'];
const modelOf = {};
function modelFor(id) {
  if (modelOf[id]) return modelOf[id];
  if (KNOWN_MODEL[id]) return (modelOf[id] = KNOWN_MODEL[id]);
  const used = new Set(Object.values(modelOf)); return (modelOf[id] = EXTRA_MODELS.find(m => !used.has(m)) || EXTRA_MODELS[Object.keys(modelOf).length % EXTRA_MODELS.length]);
}
const KNOWN_ROLE = { user: 'BOSS', ceo: 'CEO', designer: 'DESIGNER', developer: 'DEVELOPER', researcher: 'RESEARCHER', writer: 'WRITER', auditor: 'AUDITOR' };
const roleOf = id => KNOWN_ROLE[id] || String(ST?.agents?.[id]?.title || id).toUpperCase();
// masaya özel eşyalar: [model, x, z, {ry, k}]  (masa yerel koordinatı)
const PROPS = {
  user: [['speakerSmall', -0.58, -0.05], ['plantSmall2', 0.62, -0.1]],
  ceo: [['laptop', -0.5, 0.12], ['lampSquareTable', 0.66, -0.2], ['plantSmall3', 0.62, 0.14]],
  designer: [['lampRoundTable', -0.62, -0.18], ['plantSmall2', 0.66, -0.12], ['books', -0.42, 0.16]],
  developer: [['computerScreen', -0.5, -0.12, { ry: 0.35, k: 0.78 }], ['laptop', 0.62, 0.12], ['computerMouse', 0.5, 0.2]],
  researcher: [['books', -0.58, -0.05], ['laptop', 0.55, 0.12], ['plantSmall3', 0.68, -0.2]],
  writer: [['books', -0.6, 0.0], ['lampRoundTable', 0.66, -0.18], ['plantSmall2', 0.45, 0.2]],
  auditor: [['books', -0.58, 0.1], ['lampSquareTable', 0.66, -0.2], ['computerMouse', 0.45, 0.2]],
};
const GENERIC_PROPS = [['books', -0.58, 0.0], ['lampRoundTable', 0.66, -0.18], ['plantSmall3', 0.5, 0.2]];
const ids = () => Object.keys(DESKS);
const seatOf = id => { const d = DESKS[id]; return [d[0], d[1] - 0.95]; };
// masanın yanı: sol sütundakiler doğu tarafına, diğerleri batı tarafına; gönderene göre z kayar
const visitOf = (id, from) => { const d = DESKS[id]; const k = ids().indexOf(from); return [d[0] + (d[0] < 3 ? 1.65 : -1.65), d[1] - 0.2 + ((k % 3) - 1) * 0.5]; };
const sideOf = id => { const d = DESKS[id]; return [d[0] + (d[0] < 3 ? 1 : -1) * 1.05, d[1] - 0.95]; };   // koltuğa yandan gir/çık

// ---- yol bulma (engeller + koridor ızgarası) ----
const rect = (cx, cz, hw, hd, inf = 0.3) => ({ x0: cx - hw - inf, x1: cx + hw + inf, z0: cz - hd - inf, z1: cz + hd + inf });
let ITEM_OBST = [];   // eşyalardan türetilir (ofis düzenleyici)
let OBST = [];
// ince ızgara (0,25 birim) üzerinde A*: masa, sandalye ve tüm eşyalar engel; duvarlardan pay bırakılır
const CELL = 0.25, GX = Math.round(NX / CELL), GZ = Math.round(NZ / CELL), WALL_PAD = 0.4;
let GRID = new Uint8Array(GX * GZ);
const blocked = (x, z) => OBST.some(o => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1);
const inRoom = (x, z) => x > WALL_PAD && x < NX - WALL_PAD && z > WALL_PAD && z < NZ - WALL_PAD;
const free = (x, z) => inRoom(x, z) && !blocked(x, z);
const clear = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.08)); for (let i = 0; i <= n; i++) { const t = i / n; if (!free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; } return true; };
const cellC = (i, k) => [(i + 0.5) * CELL, (k + 0.5) * CELL];
function rebuildNav() {
  OBST = [...ITEM_OBST];
  for (const id of ids()) { const [dx, dz] = DESKS[id]; OBST.push(rect(dx, dz, 0.8, 0.42, 0.28), rect(dx, dz - 1.0, 0.32, 0.32, 0.12)); }   // masa + sandalye
  GRID = new Uint8Array(GX * GZ); for (let k = 0; k < GZ; k++) for (let i = 0; i < GX; i++) { const [x, z] = cellC(i, k); GRID[k * GX + i] = free(x, z) ? 1 : 0; }
}
function nearestCell(p) {   // p'ye en yakın serbest hücre
  const ci = Math.min(GX - 1, Math.max(0, Math.floor(p[0] / CELL))), ck = Math.min(GZ - 1, Math.max(0, Math.floor(p[1] / CELL)));
  if (GRID[ck * GX + ci]) return ck * GX + ci;
  for (let r = 1; r < 14; r++) { let best = -1, bd = 1e9; for (let k = ck - r; k <= ck + r; k++) for (let i = ci - r; i <= ci + r; i++) { if (i < 0 || k < 0 || i >= GX || k >= GZ || !GRID[k * GX + i]) continue; const [x, z] = cellC(i, k), d = (x - p[0]) ** 2 + (z - p[1]) ** 2; if (d < bd) { bd = d; best = k * GX + i; } } if (best >= 0) return best; }
  return -1;
}
const freePoint = p => free(p[0], p[1]) ? p : (() => { const c = nearestCell(p); return c < 0 ? p : cellC(c % GX, Math.floor(c / GX)); })();
function astar(s, g) {
  const N = GX * GZ, gs = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N), heap = [];
  const [gx, gz] = [g % GX, Math.floor(g / GX)], h = n => { const dx = Math.abs(n % GX - gx), dz = Math.abs(Math.floor(n / GX) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
  gs[s] = 0; push(s, h(s));
  while (heap.length) {
    const u = pop(); if (u === g) break; if (closed[u]) continue; closed[u] = 1;
    const ux = u % GX, uz = Math.floor(u / GX);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue; const x = ux + dx, z = uz + dz; if (x < 0 || z < 0 || x >= GX || z >= GZ) continue;
      const v = z * GX + x; if (!GRID[v] || closed[v]) continue;
      if (dx && dz && (!GRID[uz * GX + x] || !GRID[z * GX + ux])) continue;   // köşeden kesme yok
      const nd = gs[u] + (dx && dz ? 1.414 : 1); if (nd < gs[v]) { gs[v] = nd; prev[v] = u; push(v, nd + h(v)); }
    }
  }
  if (s !== g && prev[g] < 0) return null;
  const out = []; for (let n = g; n !== -1; n = prev[n]) { out.unshift(cellC(n % GX, Math.floor(n / GX))); if (n === s) break; }
  return out;
}
function findPath(a, b) {
  if (clear(a, b)) return [b];
  const s = nearestCell(a), g = nearestCell(b); if (s < 0 || g < 0) return [b];
  const pts = astar(s, g); if (!pts) return [b];
  // görüş hattıyla düzleştir: sadece gerçekten gereken köşeler kalır
  const out = []; let anchor = free(a[0], a[1]) ? a : pts[0], i = 0;
  if (anchor !== a) out.push(pts[0]);
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !clear(anchor, pts[j])) j--; out.push(pts[j]); anchor = pts[j]; i = j; }
  out.push(b); return out;   // hedef eşyaya çok yakınsa son serbest noktadan kısa bir adımla girer
}
function route(id, c, dest, seat) {
  const s = seatOf(id), sd = sideOf(id), out = []; let from = [c.x, c.y];
  if (Math.hypot(c.x - s[0], c.y - s[1]) < 0.3) { out.push(sd); from = sd; }
  if (seat) out.push(...findPath(from, sd), s); else out.push(...findPath(from, freePoint(dest)));
  return out;
}

// grafik başlatılamazsa veya bağlam kaybolursa ekran kararmasın: düşük kaliteye otomatik geç
function failover(msg) {
  try {
    if (QUALITY !== 'low' && !sessionStorage.getItem('fell')) {
      sessionStorage.setItem('fell', '1'); localStorage.setItem('quality', 'low');
      window.dispatchEvent(new CustomEvent('office-error', { detail: { msg: msg + ' Düşük kaliteye geçiliyor…', reload: true } }));
      setTimeout(() => location.reload(), 1800); return;
    }
  } catch {}
  window.dispatchEvent(new CustomEvent('office-error', { detail: { msg, reload: false } }));
}
let wrap, tags = {}, ST, onClick, renderer, scene, camera, clock, chars = {}, ready = false;
const loader = new GLTFLoader();
const load = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));

function centered(gltf, scale = 1) {
  const m = gltf.scene.clone(true); const box = new THREE.Box3().setFromObject(m); const c = box.getCenter(new THREE.Vector3());
  m.position.set(-c.x, -box.min.y, -c.z); const g = new THREE.Group(); g.add(m); g.scale.setScalar(scale);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
const cache = {};
async function furn(name) { return cache[name] ||= await load(`assets/furniture/${name}.glb`); }
async function place(name, x, z, { ry = 0, y = 0, s = FS, parent = scene } = {}) {
  const g = centered(await furn(name), s); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g;
}

async function buildDesk(id) {
  const [cx, cz] = DESKS[id]; const grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = Math.PI; scene.add(grp);
  const top = 0.38 * FS;
  await place('desk', 0, 0, { parent: grp });
  await place('computerScreen', 0.15, -0.12, { parent: grp, y: top, s: FS * 0.78 });
  await place('computerKeyboard', 0.15, 0.2, { parent: grp, y: top, s: FS * 0.9 });
  for (const [m, x, z, o = {}] of (PROPS[id] || GENERIC_PROPS)) await place(m, x, z, { parent: grp, y: top, s: FS * (o.k || 0.8), ry: o.ry || 0 });
  await place('chairDesk', 0, 1.0, { parent: grp, ry: Math.PI, s: FS });
  return grp;
}

// aynı modelin çok kopyası (zemin karoları, duvarlar) tek InstancedMesh ile çizilir: yüzlerce nesne yerine birkaç çizim çağrısı
function instanced(gltf, mats, { receive = false } = {}) {
  if (!mats.length) return;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length), m = new THREE.Matrix4();
    mats.forEach((p, i) => im.setMatrixAt(i, m.multiplyMatrices(p, o.matrixWorld)));
    im.receiveShadow = receive; im.computeBoundingSphere(); scene.add(im);
  });
}
async function build() {
  const floor = await furn('floorFull'), M = (x, y, z, ry = 0, sy = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, sy, 1));
  const fl = []; for (let x = 0; x < NX; x++) for (let z = 0; z < NZ; z++) fl.push(M(x, 0, z + 1));
  instanced(floor, fl, { receive: true });
  const wall = await furn('wall'), win = await furn('wallWindow'), WH = 1.65, DX = DOOR[0], wl = [], wn = [];
  for (let x = 0; x < NX; x++) { if (x === DX - 1 || x === DX) continue; (x % 4 === 1 ? wn : wl).push(M(x, 0, 0, 0, WH)); }
  for (let z = 0; z < NZ; z++) (z % 4 === 1 ? wn : wl).push(M(0, 0, z + 1, Math.PI / 2, WH));
  instanced(wall, wl); instanced(win, wn);
  const wood = new THREE.MeshStandardMaterial({ color: 0xb98550 }), plaster = new THREE.MeshStandardMaterial({ color: 0xd9d4c8 });
  const bx = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); };
  const DH = 1.75, TOP = 1.29 * WH;
  bx(0.2, DH, 0.2, DX - 0.9, DH / 2, -0.02, wood); bx(0.2, DH, 0.2, DX + 0.9, DH / 2, -0.02, wood); bx(2.0, 0.14, 0.2, DX, DH + 0.07, -0.02, wood);
  bx(2.0, TOP - DH - 0.14, 0.1, DX, DH + 0.14 + (TOP - DH - 0.14) / 2, -0.02, plaster);
}

// ---- ofis düzenleyici: dekor eşyaları veri olarak tutulur, sürüklenir, kaydedilir ----
const DEFAULT_ITEMS = (() => {
  const L = []; let n = 0; const add = (m, x, z, o = {}) => L.push({ id: 'i' + ++n, m, x, z, ry: o.ry || 0, s: o.s || FS, y: o.y || 0 });
  add('rugDoormat', DOOR[0], 1.0, { s: 1.9, y: 0.05 }); add('rugRectangle', 6.5, 8.6, { s: 8.5, y: 0.05 }); add('rugRound', 13.2, 2.2, { s: 4.2, y: 0.05 }); add('rugRectangle', 13.4, 9.2, { s: 4.0, y: 0.05 });
  add('loungeSofa', 13.2, 0.85); add('loungeChair', 11.4, 2.5, { ry: Math.PI / 2 }); add('tableCoffee', 13.2, 2.4); add('kitchenCoffeeMachine', 15.3, 0.6);
  add('cabinetTelevision', 11.6, 0.5); add('televisionModern', 11.6, 0.5, { y: 0.31 * FS }); add('lampSquareFloor', 15.2, 2.0);
  add('table', 13.4, 9.2, { s: FS * 1.8 });
  for (const [x, z, ry] of [[12.2, 7.95, 0], [13.4, 7.95, 0], [14.6, 7.95, 0], [12.2, 10.45, Math.PI], [13.4, 10.45, Math.PI], [14.6, 10.45, Math.PI]]) add('chair', x, z, { ry });
  add('bookcaseClosedWide', 15.3, 11.8, { ry: -Math.PI / 2 }); add('bookcaseClosed', 0.6, 5.2, { ry: Math.PI / 2 }); add('bookcaseOpen', 0.6, 8.4, { ry: Math.PI / 2 });
  for (const [x, z] of [[0.6, 3.0], [15.2, 6.4], [15.2, 4.2], [4.5, 0.6], [0.6, 13.2]]) add('pottedPlant', x, z);
  add('plantSmall1', 11.2, 5.0); add('trashcan', 0.6, 10.4);
  return L;
})();
const CATALOG = [['loungeSofa', 'Kanepe'], ['loungeChair', 'Koltuk'], ['tableCoffee', 'Sehpa'], ['sideTable', 'Yan sehpa'], ['table', 'Büyük masa'], ['tableRound', 'Yuvarlak masa'], ['chair', 'Sandalye'], ['bookcaseClosed', 'Kitaplık'], ['bookcaseOpen', 'Açık kitaplık'], ['bookcaseClosedWide', 'Geniş kitaplık'], ['cabinetTelevision', 'TV dolabı'], ['televisionModern', 'Televizyon'], ['pottedPlant', 'Saksı bitkisi'], ['plantSmall1', 'Küçük bitki'], ['lampSquareFloor', 'Ayaklı lamba'], ['kitchenCoffeeMachine', 'Kahve makinesi'], ['trashcan', 'Çöp kutusu'], ['speaker', 'Hoparlör'], ['rugRectangle', 'Halı (dikdörtgen)'], ['rugRound', 'Halı (yuvarlak)']];
let ITEMS = [], itemGroups = {}, editOn = false, selId = null, undoS = [], redoS = [], saveT = 0, boxHelper = null;
const snap = () => JSON.stringify(ITEMS);
const nextId = () => 'i' + (Math.max(0, ...ITEMS.map(i => +String(i.id).replace(/\D/g, '') || 0)) + 1);
function updObst() {
  ITEM_OBST = ITEMS.map(it => { if (/^(rug|televisionModern)/.test(it.m)) return null; const g = itemGroups[it.id]; if (!g) return null; const bb = new THREE.Box3().setFromObject(g); return { x0: bb.min.x - 0.3, x1: bb.max.x + 0.3, z0: bb.min.z - 0.3, z1: bb.max.z + 0.3 }; }).filter(Boolean);
  rebuildNav();
}
async function spawnItem(it) {
  const g = centered(await furn(it.m), it.s || FS); g.position.set(it.x, it.y || 0, it.z); g.rotation.y = it.ry || 0; g.userData.itemId = it.id; scene.add(g); itemGroups[it.id] = g; return g;
}
async function rebuildItems() {
  for (const g of Object.values(itemGroups)) scene.remove(g); itemGroups = {}; selId = null; boxHelper?.removeFromParent(); boxHelper = null;
  for (const it of ITEMS) { try { await spawnItem(it); } catch (e) { console.warn('eşya yüklenemedi', it.m); } }
  updObst();
}
async function loadLayout() {
  let items = null; try { const r = await (await fetch('/api/layout')).json(); if (Array.isArray(r.items) && r.items.length) items = r.items; } catch {}
  ITEMS = (items || DEFAULT_ITEMS).map(x => ({ ...x })); await rebuildItems();
}
function saveLayout() { clearTimeout(saveT); saveT = setTimeout(() => fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: ITEMS }) }).catch(() => {}), 500); }
function pushUndo(prev) { undoS.push(prev); if (undoS.length > 60) undoS.shift(); redoS = []; }
function sync(it) { const g = itemGroups[it.id]; if (g) { g.position.set(it.x, it.y || 0, it.z); g.rotation.y = it.ry || 0; } }
function select(id) { selId = id; boxHelper?.removeFromParent(); boxHelper = null; if (id && itemGroups[id]) { boxHelper = new THREE.BoxHelper(itemGroups[id], 0xffd166); scene.add(boxHelper); } window.dispatchEvent(new CustomEvent('office-select', { detail: { id, name: id ? CATALOG.find(c => c[0] === ITEMS.find(i => i.id === id)?.m)?.[1] || '' : '' } })); }
async function applySnapshot(str) { ITEMS = JSON.parse(str); await rebuildItems(); saveLayout(); }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hs = ray.intersectObjects(Object.values(itemGroups), true); let rug = null; for (const h of hs) { let o = h.object; while (o && !o.userData.itemId) o = o.parent; if (!o) continue; const it = ITEMS.find(i => i.id === o.userData.itemId); if (it && /^rug/.test(it.m)) { rug ||= it.id; continue; } return o.userData.itemId; } return rug;
}
function groundAt(e) { const r = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; }
const snapG = v => Math.round(v * 4) / 4;
let drag = null;
function editDown(e) {
  const id = pick(e); if (!id) { if (selId) select(null); return false; }
  select(id); const it = ITEMS.find(i => i.id === id), g = groundAt(e); if (!g) return true;
  drag = { it, prev: snap(), dx: it.x - g.x, dz: it.z - g.z, moved: false }; return true;
}
function editMove(e) { if (!drag) return false; const g = groundAt(e); if (!g) return true; drag.it.x = Math.max(0.3, Math.min(NX - 0.3, snapG(g.x + drag.dx))); drag.it.z = Math.max(0.3, Math.min(NZ - 0.3 + 1, snapG(g.z + drag.dz))); drag.moved = true; sync(drag.it); boxHelper?.update(); return true; }
function editUp() { if (!drag) return false; if (drag.moved) { pushUndo(drag.prev); updObst(); saveLayout(); } drag = null; return true; }
window.addEventListener('keydown', e => {
  if (!editOn || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? Office.redo() : Office.undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); Office.redo(); }
  else if (k === 'r') Office.rotateSel(); else if (k === 'delete' || k === 'backspace') Office.deleteSel(); else if (k === 'escape') select(null);
});

// ---- ajan senkronu: masa + karakter ekle/kaldır ----
const pendingDesk = new Set();
async function addDesk(id) {
  pendingDesk.add(id); DESKS[id] = slotFor(id); rebuildNav();
  try { deskGroups[id] = await buildDesk(id); if (!DESKS[id]) { scene.remove(deskGroups[id]); delete deskGroups[id]; } } finally { pendingDesk.delete(id); }
}
function removeDesk(id) {
  if (deskGroups[id]) { scene.remove(deskGroups[id]); delete deskGroups[id]; }
  if (chars[id]?.root) scene.remove(chars[id].root);
  delete chars[id]; delete modelOf[id]; delete DESKS[id]; tags[id]?.remove(); delete tags[id]; rebuildNav();
}
function syncAgents() {
  if (!ready || !ST) return;
  const want = ['user', ...Object.keys(ST.agents)];
  for (const id of want) if (!DESKS[id] && !pendingDesk.has(id)) addDesk(id);
  for (const id of ids()) if (!want.includes(id) && !pendingDesk.has(id)) removeDesk(id);
}

async function makeChar(id) {
  const gltf = await load(`assets/chars/character-${modelFor(id)}.glb`);
  const c = chars[id]; if (!c) return;
  const obj = SkeletonUtils.clone(gltf.scene);
  const box = new THREE.Box3().setFromObject(obj); obj.scale.setScalar(CHAR_H / (box.max.y - box.min.y));
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const root = new THREE.Group(); root.add(obj); scene.add(root);
  const mixer = new THREE.AnimationMixer(obj), acts = {};
  for (const a of gltf.animations) acts[a.name] = mixer.clipAction(a);
  Object.assign(c, { root, obj, mixer, acts, cur: null, yaw: 0, armL: obj.getObjectByName('arm-left'), armR: obj.getObjectByName('arm-right'), armW: 0, sleepW: 0, typeW: 0, stretch: 0, prevWk: false, listenUntil: 0, listenFace: null, sitBlend: 1, torso: obj.getObjectByName('torso'), head: obj.getObjectByName('head') });
  root.position.set(c.x, 0, c.y); play(c, 'sit');
}
function play(c, name) {
  if (!c.acts || c.cur === name || !c.acts[name]) return;
  const n = c.acts[name], o = c.acts[c.cur];
  n.reset(); n.setLoop(THREE.LoopRepeat, Infinity); n.enabled = true; n.setEffectiveWeight(1); n.fadeIn(0.18).play(); if (o) o.fadeOut(0.18); c.cur = name;
}
function ensure(id) {
  if (chars[id]) return chars[id];
  if (!DESKS[id]) return null;
  const s = seatOf(id);   // herkes masasında; iş yoksa uyur
  chars[id] = { act: null, actW: 0, flag: null, cheer: 0, cheerW: 0, coffee: false, faceXY: null, x: s[0], y: s[1], q: [], path: null, after: null, working: false, idleSince: performance.now(), bubble: null, sitting: false, moving: false, wait: 0, note: null, faceTo: null, sitBlend: 1 };
  if (ready) { chars[id].loading = true; makeChar(id); }
  return chars[id];
}
const goTo = (c, pts, after) => { c.path = pts.slice(); c.after = after; };

const SLEEP_T = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.6)), SLEEP_H = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.8)), ARM_Z = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.5));
const ARM_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 2.9)), STR_T = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3)), STR_H = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.4));
const ARM_CHIN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.95));
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qt = new THREE.Quaternion(), qh = new THREE.Quaternion(), eu = new THREE.Euler();
function update(dt, now) {
  for (const id of ids()) {
    const c = ensure(id); if (!c || !c.root) continue;
    c.wk = c.working || now < (c.holdUntil || 0); if (c.wk) c.idleSince = now;
    if (!c.path && !c.wait) {
      const s = seatOf(id), atSeat = Math.hypot(c.x - s[0], c.y - s[1]) < .06;
      const v = c.q.shift();
      if (v && DESKS[v.to]) goTo(c, route(id, c, visitOf(v.to, id)), { t: 'say', v });
      else if (c.coffee && atSeat && !c.wk) { c.coffee = false; goTo(c, route(id, c, COFFEE), { t: 'coffee' }); }
      else if (!atSeat) goTo(c, route(id, c, s, true), { t: 'sit' });
    }
    if (c.wait > 0) { c.wait -= dt; if (c.wait <= 0) { c.wait = 0; c.bubble = null; c.faceTo = null; c.faceXY = null; } }
    c.moving = false; let face = null;
    if (c.path && c.path.length) {
      const [tx, ty] = c.path[0], dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
      const want = Math.atan2(dx, dy), turn = Math.abs(Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)));
      // kalan yol: sona yaklaşınca yavaşla; keskin dönüşte önce yerinde dön
      let rest = d; for (let i = 1; i < c.path.length; i++) rest += Math.hypot(c.path[i][0] - c.path[i - 1][0], c.path[i][1] - c.path[i - 1][1]);
      let target = turn > 1.3 && (c.spd || 0) < 0.4 && d > 0.15 ? 0 : SPEED * Math.min(1, 0.35 + rest / 0.9) * (turn > 0.8 ? 0.55 : 1);
      // başka biri tam önündeyse yol ver (öncelik sırası düşük olan bekler, en fazla 1,5 sn)
      const me = ids().indexOf(id);
      for (const o of ids()) { if (o === id) continue; const oc = chars[o]; if (!oc?.root) continue; const ox = oc.x - c.x, oy = oc.y - c.y, od = Math.hypot(ox, oy); if (od < 0.55 && (ox * dx + oy * dy) / (d || 1) > 0.2 && (!oc.moving || ids().indexOf(o) < me)) { c.yieldT = (c.yieldT || 0) + dt; if (c.yieldT < 1.5) target = Math.min(target, 0.15); } }
      if (target > 0.15) c.yieldT = 0;
      c.spd = (c.spd || 0) + Math.max(-SPEED * 4 * dt, Math.min(SPEED * 2.6 * dt, target - (c.spd || 0)));   // ivmelen / yavaşla
      const sp = Math.max(0, c.spd) * dt, last = c.path.length === 1;
      if (d <= Math.max(sp, last ? 0.02 : 0.22)) { if (last || d <= sp) { c.x = tx; c.y = ty; } c.path.shift(); }   // ara köşeleri biraz erken bırak: yumuşak dönüş
      else { c.x += dx / d * sp; c.y += dy / d * sp; }
      c.moving = c.spd > 0.05 || turn > 0.2; face = want;
      if (!c.path.length) {
        c.spd = 0;
        const a = c.after; c.path = null; c.after = null;
        if (a?.t === 'say') { c.bubble = { text: a.v.text, kind: 'say' }; c.wait = 2.6; c.faceTo = a.v.to; }
        else if (a?.t === 'coffee') { c.bubble = { text: 'Kahve', kind: 'say' }; c.wait = 4.5; c.faceXY = COFFEE_AT; }
      }
    }
    const s = seatOf(id), atSeat = Math.hypot(c.x - s[0], c.y - s[1]) < .06;
    c.sitting = !c.path && atSeat;                       // koltukta: konuşma/dinleme sırasında da oturur kalır
    const listening = now < (c.listenUntil || 0);
    const act = c.act && now < c.act.until ? c.act.kind : null;
    if (c.flag && now > c.flag.until) c.flag = null;
    if (c.cheer > 0) c.cheer = Math.max(0, c.cheer - dt);
    // yeni iş geldi ve uyuyordu: gerin, "Aaah!"
    if (c.wk && !c.prevWk && c.sleepW > 0.3) { c.stretch = 1.1; c.bubble = { text: 'Aaah!', kind: 'say', until: now + 1100 }; }
    c.prevWk = c.wk; if (c.stretch > 0) c.stretch = Math.max(0, c.stretch - dt);
    if (c.sitting) face = listening && c.listenFace != null ? c.listenFace : 0;
    if (!c.moving && !c.sitting && c.wait > 0 && c.faceXY) face = Math.atan2(c.faceXY[0] - c.x, c.faceXY[1] - c.y);
    if (!c.moving && !c.sitting && c.wait > 0 && c.faceTo && DESKS[c.faceTo]) { const [fx, fy] = DESKS[c.faceTo]; face = Math.atan2(fx - c.x, fy - c.y); }
    if (c.bubble?.until && now > c.bubble.until) c.bubble = null;
    if (c.bubble && (c.bubble.kind === 'zz' || c.bubble.byAct) && (c.flag || c.cheer > 0)) c.bubble = null;   // hata/limit/bitti, uyku ve eylem balonunun önüne geçer
    if (c.cheer > 0 && !c.bubble) c.bubble = { text: 'Bitti', kind: 'ok', until: now + 1800 };
    if (c.flag && !c.bubble) c.bubble = { text: c.flag.kind === 'error' ? 'Hata' : 'Limit', kind: c.flag.kind === 'error' ? 'err' : 'lim', flag: true };
    if (c.bubble?.flag && !c.flag) c.bubble = null;
    if (act && !c.bubble && c.sitting && ppu * camera.zoom > 30) c.bubble = { text: ACT_TXT[act] || '', kind: 'act', byAct: true };
    if (c.bubble?.byAct && !act) c.bubble = null;
    if (c.waiting && c.sitting && !c.bubble) c.bubble = { text: 'Onay?', kind: 'say', wait: true };
    if (c.bubble?.wait && !c.waiting) c.bubble = null;
    if (c.sleepW > 0.6 && !c.bubble && c.sitting && !c.wk && !c.flag) c.bubble = { text: 'Zzz...', kind: 'zz' };
    if (c.bubble?.kind === 'zz' && (c.wk || c.sleepW < 0.5)) c.bubble = null;
    c.sitBlend += ((c.sitting ? 1 : 0) - c.sitBlend) * Math.min(1, dt * 7);   // koltuğa çıkış/iniş yumuşak
    c.root.position.set(c.x, SIT_RAISE * c.sitBlend + (c.cheerW > 0.3 && !REDUCED ? 0.07 * Math.abs(Math.sin(now / 90)) : 0), c.y);
    if (face != null) { let d = face - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); c.yaw += Math.max(-6 * dt, Math.min(6 * dt, d * Math.min(1, dt * 7))); c.root.rotation.y = c.yaw; }   // dönüş hızı sınırlı: insan gibi döner
    play(c, c.moving ? 'walk' : (c.sitting || c.sitBlend > 0.5) ? 'sit' : c.wait > 0 ? 'interact-right' : 'idle');
    if (c.acts.walk) c.acts.walk.timeScale = 0.45 + 0.65 * Math.min(1, Math.max(0, c.spd || 0) / SPEED);   // ayak kayması olmasın
    c.mixer.update(dt);

    // ---- kemik üstü pozlar: yazma / dinleme / uyku / esneme ----
    const t = now / 1000, k = Math.min(1, dt * 6);
    const typing = c.sitting && c.wk && !listening && c.stretch <= 0 && act !== 'read' && act !== 'search';
    const AMP = REDUCED ? 0.25 : 1, fr = act === 'write' ? 24 : act === 'run' ? 13 : 16;
    c.actW += (((act === 'search' || act === 'read') && c.sitting ? 1 : 0) - c.actW) * k; c.cheerW += ((c.cheer > 0 ? 1 : 0) - c.cheerW) * k;
    c.armW += ((c.sitting ? 1 : 0) - c.armW) * k;
    c.typeW += ((typing ? 1 : 0) - c.typeW) * k;
    c.sleepW = Math.min(1, Math.max(0, c.sleepW + (((c.sitting && !c.wk && id !== 'user') || (c.flag && c.sitting)) ? 1 : -1) * dt * 1.8));
    const sw = c.stretch > 0 ? Math.sin(Math.PI * (1 - c.stretch / 1.1)) : 0;
    if (c.armW > 0.01 && c.armL && c.armR) {
      qa.setFromEuler(eu.set(0.05 * AMP * c.typeW * Math.sin(t * 9), 0, 0.9 + 0.1 * AMP * c.typeW * Math.sin(t * fr)));
      qb.setFromEuler(eu.set(-0.05 * AMP * c.typeW * Math.sin(t * 9 + 1), 0, -(0.9 + 0.1 * AMP * c.typeW * Math.sin(t * fr + 2.4))));
      if (c.actW > 0.01 && act === 'search') qa.slerp(ARM_CHIN, c.actW);   // arayan: bir el çeneye
      qa.slerp(ARM_Z, c.sleepW).slerp(ARM_UP, Math.max(sw, c.cheerW)); qb.slerp(ARM_Z, c.sleepW).slerp(ARM_UP, Math.max(sw, c.cheerW));
      c.armL.quaternion.slerp(qa, c.armW); c.armR.quaternion.slerp(qb, c.armW);
    }
    if (c.armW > 0.01 && c.torso && c.head) {
      qt.setFromEuler(eu.set(0, 0, -0.07 * c.typeW + 0.015 * Math.sin(t * 2))).slerp(SLEEP_T, c.sleepW).slerp(STR_T, sw);
      qh.setFromEuler(eu.set(0, (act === 'read' ? 0.38 * Math.sin(t * 1.7) : 0) * AMP * c.actW, -0.14 * c.typeW - (act === 'search' ? 0.1 + 0.16 * Math.sin(t * 2.2) * AMP : 0) * c.actW - (listening ? 0.12 * (0.5 + 0.5 * Math.sin(t * 6)) : 0))).slerp(SLEEP_H, c.sleepW).slerp(STR_H, sw);
      c.torso.quaternion.slerp(qt, c.armW); c.head.quaternion.slerp(qh, c.armW);
    }
    // ayakta konuşurken başını hafifçe sallar, beklerken nefes alır gibi salınır
    if (c.head && c.sitBlend < 0.5 && !c.moving && !REDUCED) {
      const talk = c.wait > 0 && c.bubble?.kind === 'say' ? 1 : 0;
      qh.setFromEuler(eu.set(0, 0.12 * Math.sin(t * 1.3) * (1 - talk), -0.06 * talk * (0.5 + 0.5 * Math.sin(t * 7)) + 0.02 * Math.sin(t * 2.1)));
      c.head.quaternion.multiply(qh);
    }
  }
}

// ---- yardımcı (alt ajan) karakterleri: Agent aracı kullanılınca masanın yanında belirir ----
const helpers = {};
async function addHelper(agent, id, text) {
  if (helpers[id] || !DESKS[agent]) return; const n = Object.keys(helpers).length;
  const h = helpers[id] = { agent, text, root: null, mixer: null };
  const gltf = await load('assets/chars/character-' + EXTRA_MODELS[n % EXTRA_MODELS.length] + '.glb');
  if (!helpers[id]) return;   // bu arada kapandıysa
  const obj = SkeletonUtils.clone(gltf.scene), box = new THREE.Box3().setFromObject(obj); obj.scale.setScalar(CHAR_H * 0.72 / (box.max.y - box.min.y));
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const root = new THREE.Group(); root.add(obj); const d = DESKS[agent]; root.position.set(d[0] + (d[0] < 3 ? 1.5 : -1.5), 0, d[1] - 0.7 - n * 0.5); root.rotation.y = d[0] < 3 ? -1.2 : 1.2; scene.add(root);
  const mixer = new THREE.AnimationMixer(obj), clip = gltf.animations.find(a => a.name === 'idle') || gltf.animations[0]; if (clip) mixer.clipAction(clip).play();
  Object.assign(h, { root, mixer });
  const el = document.createElement('div'); el.className = 'otag'; el.innerHTML = '<div class="ob" style="display:block"></div><div class="on"></div>'; el.firstChild.textContent = text || 'Yardımcı'; el.lastChild.textContent = 'YARDIMCI'; el.style.setProperty('--c', '#9aa4c7'); wrap.appendChild(el); h.el = el;
}
function removeHelper(id) { const h = helpers[id]; if (!h) return; if (h.root) scene.remove(h.root); h.el?.remove(); delete helpers[id]; }

// ---- konfeti ----
let confetti = null;
function startConfetti() {
  if (REDUCED) return; if (confetti) { scene.remove(confetti.pts); confetti = null; }
  const N = 160, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N * 3), c = new THREE.Color();
  for (let i = 0; i < N; i++) { pos.set([1 + Math.random() * 14, 7 + Math.random() * 3, 1 + Math.random() * 12], i * 3); vel.set([(Math.random() - .5) * 1.2, -1.2 - Math.random() * 1.8, (Math.random() - .5) * 1.2], i * 3); c.setHSL(Math.random(), 0.85, 0.62); col.set([c.r, c.g, c.b], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true })); pts.frustumCulled = false; scene.add(pts); confetti = { pts, vel, t: 0 };
}
function stepConfetti(dt) {
  if (!confetti) return; confetti.t += dt; const p = confetti.pts.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { p.array[i * 3] += confetti.vel[i * 3] * dt; p.array[i * 3 + 1] += confetti.vel[i * 3 + 1] * dt; p.array[i * 3 + 2] += confetti.vel[i * 3 + 2] * dt; if (p.array[i * 3 + 1] < 0.05) { p.array[i * 3 + 1] = 0.05; confetti.vel[i * 3 + 1] = 0; } }
  p.needsUpdate = true; confetti.pts.material.opacity = Math.max(0, 1 - Math.max(0, confetti.t - 3) / 1.5);
  if (confetti.t > 4.5) { scene.remove(confetti.pts); confetti = null; }
}

// ---- günün saatine göre ışık ve gökyüzü ----
let lights = null, todMode = '';
function applyTimeOfDay(force) {
  if (!lights) return; const h = new Date().getHours() + new Date().getMinutes() / 60;
  const mode = h >= 20 || h < 5.5 ? 'night' : h >= 17 || h < 8 ? 'dusk' : 'day';
  if (mode === todMode && !force) return; todMode = mode;
  const P = { day: { hc: 0xfff4e4, hg: 0x7d7a96, hi: 1.35, sc: 0xffe9c8, si: 2.4, sp: [14, 22, 12], ex: 1.12, pl: 1 }, dusk: { hc: 0xffd9c0, hg: 0x6a5a86, hi: 1.15, sc: 0xffb27a, si: 1.9, sp: [24, 9, 6], ex: 1.08, pl: 1.6 }, night: { hc: 0x9fb0ff, hg: 0x34385c, hi: 0.6, sc: 0x9fb4ff, si: 0.6, sp: [-10, 20, 10], ex: 0.95, pl: 2.6 } }[mode];
  lights.hemi.color.setHex(P.hc); lights.hemi.groundColor.setHex(P.hg); lights.hemi.intensity = P.hi * (QUALITY === 'low' ? 1.45 : 1);   // düşük kalitede nokta ışıklar yok: ortam ışığı telafi eder lights.sun.color.setHex(P.sc); lights.sun.intensity = P.si; lights.sun.position.set(...P.sp);
  renderer.toneMappingExposure = P.ex; for (const pl of lights.pts) pl.intensity = 9 * P.pl; setSky(scene, mode);
}

const v3 = new THREE.Vector3();
function overlay() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const hp of Object.values(helpers)) if (hp.root && hp.el) { v3.set(hp.root.position.x, 1.05, hp.root.position.z).project(camera); hp.el.style.left = (v3.x * .5 + .5) * w + 'px'; hp.el.style.top = (-v3.y * .5 + .5) * h + 'px'; hp.el.style.fontSize = Math.max(8, Math.min(11, ppu * 0.36 * camera.zoom)) + 'px'; }
  for (const id of ids()) {
    const c = chars[id]; if (!c || !c.root) continue; const a = id === 'user' ? ST.user : ST.agents[id]; if (!a) continue;
    let el = tags[id];
    if (!el) {
      el = tags[id] = document.createElement('div'); el.className = 'otag'; el.innerHTML = '<div class="ob"></div><div class="on"></div>'; wrap.appendChild(el);
      const lab = el.querySelector('.on'); lab.onclick = () => focus(id); lab.ondblclick = () => id !== 'user' && onClick(id); lab.title = 'Tıkla: yakınlaş · çift tıkla: ayarlar';
    }
    const hy = 1.32 + 0.2 * c.sitBlend - 0.18 * c.sleepW;   // kafanın hemen üstü
    v3.set(c.root.position.x, hy, c.root.position.z).project(camera);
    const px = (v3.x * .5 + .5) * w, py = (-v3.y * .5 + .5) * h;
    el.style.left = px + 'px'; el.style.top = py + 'px'; el.style.zIndex = 5 + Math.round(py);
    const b = el.firstChild, n = el.lastChild;
    n.textContent = roleOf(id); el.style.setProperty('--c', c.flag ? (c.flag.kind === 'error' ? '#ff7a85' : '#ffa94d') : a.color);
    if (c.bubble && !(ppu < 26 && c.bubble.kind === 'zz')) { b.style.display = 'block'; b.textContent = String(c.bubble.text).replace(/\s+/g, ' ').slice(0, 38); b.className = 'ob ' + c.bubble.kind; } else b.style.display = 'none';
    el.style.fontSize = Math.max(8.5, Math.min(13, ppu * 0.42 * camera.zoom)) + 'px';
  }
}

// ---- görüş: sürükle/kaydır, tekerlek/pinch yakınlaştırma, karaktere odaklanma ----
const baseTarget = new THREE.Vector3(NX / 2 - 0.3, 0.4, NZ / 2 - 0.5), BASE_OFF = [17, 16, 18];
const cur = { x: 0, z: 0, zoom: 1 }, goal = { x: 0, z: 0, zoom: 1 };
let focusId = null;
const clampZ = z => Math.min(4, Math.max(0.5, z));
function applyView(dt) {
  const k = 1 - Math.exp(-dt * 9);
  cur.x += (goal.x - cur.x) * k; cur.z += (goal.z - cur.z) * k; cur.zoom += (goal.zoom - cur.zoom) * k;
  camera.zoom = cur.zoom;
  camera.position.set(baseTarget.x + BASE_OFF[0] + cur.x, BASE_OFF[1], baseTarget.z + BASE_OFF[2] + cur.z);
  camera.lookAt(baseTarget.x + cur.x, baseTarget.y, baseTarget.z + cur.z);
  camera.updateProjectionMatrix();
}
const rightV = new THREE.Vector3();
function pan(dx, dy) {
  const wpp = (camera.right - camera.left) / (renderer.domElement.clientWidth * camera.zoom), sinE = BASE_OFF[1] / Math.hypot(...BASE_OFF);
  camera.updateMatrixWorld(); rightV.setFromMatrixColumn(camera.matrixWorld, 0); rightV.y = 0; rightV.normalize();
  const fx = -BASE_OFF[0], fz = -BASE_OFF[2], fl = Math.hypot(fx, fz);     // yer düzleminde "ekranın yukarısı" yönü
  goal.x += (-rightV.x * dx + (fx / fl) * dy / sinE) * wpp; goal.z += (-rightV.z * dx + (fz / fl) * dy / sinE) * wpp;
  goal.x = Math.max(-16, Math.min(16, goal.x)); goal.z = Math.max(-16, Math.min(16, goal.z)); focusId = null;
}
function resetView() { focusId = null; goal.x = 0; goal.z = 0; const narrow = innerWidth < 860 && !document.body.classList.contains('mini'); goal.zoom = narrow ? 1.5 : 1; if (narrow) { goal.x = 0.5; goal.z = 1.5; } }
function focus(id) {
  const c = chars[id]; if (!c) return;
  if (focusId === id) return resetView();
  focusId = id; goal.x = c.x - baseTarget.x; goal.z = c.y - baseTarget.z; goal.zoom = innerWidth < 860 ? 2.6 : 2.1;
}
function setupControls(el) {
  const ptrs = new Map(); let pd = 0;
  const dist = () => { const p = [...ptrs.values()]; return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0; };
  el.addEventListener('pointerdown', e => { if (e.target.closest('.otag')) return; if (editOn && editDown(e)) { el.setPointerCapture?.(e.pointerId); return; } el.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); pd = dist(); });
  el.addEventListener('pointermove', e => {
    if (editOn && drag) { editMove(e); return; }
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) pan(dx, dy);
    else if (ptrs.size === 2) { const d = dist(); if (pd) goal.zoom = clampZ(goal.zoom * d / pd); pd = d; }
  });
  const up = e => { if (editUp()) return; ptrs.delete(e.pointerId); pd = dist(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => { e.preventDefault(); goal.zoom = clampZ(goal.zoom * Math.exp(-e.deltaY * 0.0014)); }, { passive: false });
  el.addEventListener('dblclick', e => { if (!e.target.closest('.otag')) resetView(); });
}

let inset = 0, insetY = 0, ppu = 40;
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const key = w + 'x' + h + 'x' + inset + 'x' + insetY; if (renderer.domElement.dataset.k == key || !w || !h) return; renderer.domElement.dataset.k = key;
  renderer.setSize(w, h, false); renderer.domElement.style.height = '100%'; renderer.domElement.style.width = '100%';
  // ofis her ekranda sığsın: yükseklikten ve genişlikten büyük olanı kullan
  const asp = w / h; let vh = Math.max(17, 33 / asp);
  if (insetY) vh = Math.max(vh, 15 * h / Math.max(80, h - insetY));   // alttan açılan panelin üstünde kalan alana sığdır
  ppu = h / vh;
  camera.left = -vh * asp / 2; camera.right = vh * asp / 2; camera.top = vh / 2; camera.bottom = -vh / 2;
  if (inset || insetY) camera.setViewOffset(w, h, inset / 2, insetY / 2, w, h); else camera.clearViewOffset();   // yan panel açıkken sahne boş alana ortalanır
  camera.updateProjectionMatrix();
}

let todN = 0, coffeeT = 45 + Math.random() * 30;
let wdN = 0, wdSum = 0, wdDone = QUALITY === 'low';
let idleAcc = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!ready || !ST || !wrap.clientWidth) return;
  try {
    resize();
    const lively = editOn || confetti || ids().some(i => chars[i]?.moving || chars[i]?.path) || Math.abs(goal.zoom - cur.zoom) > 0.002 || Math.abs(goal.x - cur.x) + Math.abs(goal.z - cur.z) > 0.005;
    if (!lively) { idleAcc += clock.getDelta(); if (idleAcc < 1 / 31) return; }
    const raw = (lively ? clock.getDelta() : 0) + idleAcc; idleAcc = 0; const dt = Math.min(0.1, raw);
    // performans bekçisi: yüksek kalitede ilk ~3 sn ortalama 12 FPS'in altındaysa düşüğe geç
    if (!wdDone && document.visibilityState === 'visible' && raw < 0.25 && wdN++ > 20) { wdSum += raw; /* arka planda kısılan kareler sayılmaz */ if (wdN > 110) { wdDone = true; if (wdSum / 90 > 0.085) failover('Grafik çok yavaş çalışıyor.'); } }
    syncAgents(); update(dt, performance.now()); applyView(dt);
    for (const h of Object.values(helpers)) if (h.mixer) { h.mixer.update(dt); if (!REDUCED) h.root.position.y = 0.03 * Math.abs(Math.sin(performance.now() / 380)); }
    stepConfetti(dt);
    if ((todN += dt) > 30) { todN = 0; applyTimeOfDay(); }
    if (!REDUCED && (coffeeT -= dt) <= 0) {
      coffeeT = 70 + Math.random() * 60;
      const busy = ids().some(i => chars[i]?.wk || chars[i]?.flag || chars[i]?.path), sl = ids().filter(i => i !== 'user' && chars[i]?.root && chars[i].sleepW > 0.8 && !chars[i].wk && !chars[i].path);
      if (!busy && sl.length) chars[sl[Math.floor(Math.random() * sl.length)]].coffee = true;
    }
    renderer.render(scene, camera);
    overlay();
  } catch (e) { console.error(e); ready = false; failover('Çizim hatası (' + (e.message || e) + ').'); }
}

// kalite değişince sayfa yenilenmez: yeni çizici hazırlanır, ilk karesi çizilince eskisinin yerine geçer (siyah ekran olmaz)
function makeRenderer(low) {
  const r = new THREE.WebGLRenderer({ antialias: !low });
  r.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.25));   // kenar yumuşatma açıkken yüksek çözünürlük GPU belleğini katlar
  r.shadowMap.enabled = true; r.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  r.setClearColor(0x2a211a); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.12; r.outputColorSpace = THREE.SRGBColorSpace;
  r.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); if (r !== renderer) return; ready = false; failover('Grafik bağlamı kayboldu.'); });
  return r;
}
let worldGroup = null;
function applyQuality(q) {
  QUALITY = q === 'low' ? 'low' : 'high'; const low = QUALITY === 'low';
  const old = renderer, nr = makeRenderer(low);
  nr.domElement.style.cssText = old.domElement.style.cssText; old.domElement.after(nr.domElement);
  renderer = nr; delete nr.domElement.dataset.k; resize();
  if (lights) {
    const sm = low ? 1024 : 1536; lights.sun.shadow.mapSize.set(sm, sm); lights.sun.shadow.map?.dispose(); lights.sun.shadow.map = null;
    for (const p of lights.pts) p.visible = !low;
  }
  if (worldGroup) { scene.remove(worldGroup); worldGroup.traverse(o => { if (o.isMesh) o.geometry?.dispose(); }); }
  worldGroup = buildWorld(scene, { nx: NX, nz: NZ, doorX: DOOR[0], quality: QUALITY }); applyTimeOfDay(true);
  renderer.render(scene, camera);
  requestAnimationFrame(() => { old.domElement.remove(); old.dispose(); old.forceContextLoss?.(); });
  wdDone = true;
}
const Office = {
  async init(o) {
    wrap = o.wrap; onClick = o.onClick;
    const low = QUALITY === 'low';
    renderer = makeRenderer(low); wrap.appendChild(renderer.domElement);
    scene = new THREE.Scene(); clock = new THREE.Clock();
    camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 220);
    scene.add(new THREE.HemisphereLight(0xfff4e4, 0x7d7a96, 1.35));
    const hemi = scene.children.find(o => o.isHemisphereLight), sun = new THREE.DirectionalLight(0xffe9c8, 2.4); sun.position.set(14, 22, 12); sun.castShadow = true;
    const sm = low ? 1024 : 1536; sun.shadow.mapSize.set(sm, sm); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 }); scene.add(sun);
    const pts = [];
    for (const [x, z] of [[4.5, 4.8], [10.5, 8.0], [13.2, 2.0]]) { const pl = new THREE.PointLight(0xffd9a8, 9, 9, 1.6); pl.position.set(x, 3.2, z); pl.visible = !low; scene.add(pl); pts.push(pl); }
    try {
      rebuildNav(); resetView(); Object.assign(cur, goal);
      await build(); worldGroup = buildWorld(scene, { nx: NX, nz: NZ, doorX: DOOR[0], quality: QUALITY }); await loadLayout(); ready = true;
      setupControls(wrap);
      syncAgents();
      requestAnimationFrame(frame);
      lights = { hemi, sun, pts }; applyTimeOfDay(true);
      window.dispatchEvent(new Event('office-loaded'));
    } catch (e) { console.error(e); failover('Ofis yüklenemedi (' + (e.message || e) + ').'); }
  },
  activity(id, kind) { const c = chars[id]; if (c) c.act = { kind, until: performance.now() + 3800 }; },
  celebrate() { startConfetti(); for (const id of ids()) if (chars[id] && !chars[id].flag) chars[id].cheer = 2.4; },
  sub(agent, id, on, text) { on ? addHelper(agent, id, text) : removeHelper(id); },
  setQuality(q) { if (ready) applyQuality(q); },
  get quality() { return QUALITY; },
  snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  setReduced(b) { REDUCED = !!b; },
  pan(dx, dy) { pan(dx, dy); },
  catalog: CATALOG,
  setEdit(on) { editOn = !!on; if (!on) select(null); },
  async addItem(m) {
    if (!CATALOG.some(c => c[0] === m)) return; pushUndo(snap());
    const c0 = [baseTarget.x + cur.x, baseTarget.z + cur.z], it = { id: nextId(), m, x: snapG(c0[0]), z: snapG(c0[1]), ry: 0, s: m === 'table' ? FS * 1.8 : FS, y: /^rug/.test(m) ? 0.05 : 0 };
    ITEMS.push(it); const g = await spawnItem(it);
    if (!/^rug/.test(m)) {   // eşyanın gerçek ölçüsüyle, görünüm ortasına en yakın boş yeri ara (masa, eşya, duvar ve yürüme payı)
      const bb = new THREE.Box3().setFromObject(g), hw = (bb.max.x - bb.min.x) / 2 + 0.25, hd = (bb.max.z - bb.min.z) / 2 + 0.25;
      const fits = (x, z) => { for (let dx = -hw; dx <= hw + 1e-6; dx += Math.min(0.25, hw)) for (let dz = -hd; dz <= hd + 1e-6; dz += Math.min(0.25, hd)) if (!free(x + dx, z + dz)) return false; return true; };
      let at = null; for (let r = 0; r < 14 && !at; r += 0.5) for (let k = 0, n = r ? Math.ceil(r * 8) : 1; k < n; k++) { const x = snapG(c0[0] + Math.cos(k / n * Math.PI * 2) * r), z = snapG(c0[1] + Math.sin(k / n * Math.PI * 2) * r); if (fits(x, z)) { at = [x, z]; break; } }
      if (at) { it.x = at[0]; it.z = at[1]; g.position.set(it.x, it.y || 0, it.z); }
    }
    updObst(); select(it.id); saveLayout();
  },
  rotateSel() { const it = ITEMS.find(i => i.id === selId); if (!it) return; pushUndo(snap()); it.ry = ((it.ry || 0) + Math.PI / 2) % (Math.PI * 2); sync(it); boxHelper?.update(); updObst(); saveLayout(); },
  deleteSel() { const it = ITEMS.find(i => i.id === selId); if (!it) return; pushUndo(snap()); ITEMS = ITEMS.filter(i => i !== it); scene.remove(itemGroups[it.id]); delete itemGroups[it.id]; select(null); updObst(); saveLayout(); },
  async undo() { if (!undoS.length) return; redoS.push(snap()); await applySnapshot(undoS.pop()); },
  async redo() { if (!redoS.length) return; undoS.push(snap()); await applySnapshot(redoS.pop()); },
  exportLayout() { return JSON.stringify(ITEMS, null, 1); },
  async importLayout(str) {
    let arr; try { arr = JSON.parse(str); } catch { return { ok: false, error: 'Geçerli JSON değil' }; }
    if (!Array.isArray(arr) || arr.length > 200 || !arr.every(x => x && typeof x.m === 'string' && CATALOG.some(c => c[0] === x.m) && Number.isFinite(+x.x) && Number.isFinite(+x.z))) return { ok: false, error: 'Düzen biçimi geçersiz (m, x, z gerekli; bilinmeyen eşya olamaz)' };
    pushUndo(snap()); ITEMS = arr.map((x, i) => ({ id: 'i' + (i + 1), m: x.m, x: +x.x, z: +x.z, ry: +x.ry || 0, s: +x.s || FS, y: +x.y || 0 })); await rebuildItems(); saveLayout(); return { ok: true };
  },
  async resetLayout() { pushUndo(snap()); ITEMS = DEFAULT_ITEMS.map(x => ({ ...x })); await rebuildItems(); fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: null }) }).catch(() => {}); },
  setInset(px, py) { inset = Math.round(px || 0); insetY = Math.round(py || 0); },
  setState(s) { ST = s; syncAgents(); },
  focus, resetView, zoomBy(f) { goal.zoom = clampZ(goal.zoom * f); },
  status(id, state, note) {
    if (!ST || !chars[id]) return; const c = chars[id], now = performance.now();
    if (state === 'error' || state === 'limit') { c.working = false; c.waiting = false; c.flag = { kind: state, until: now + 9000 }; c.note = null; c.idleSince = now; return; }
    if (state === 'done') { c.cheer = 1.8; return; }
    c.working = state === 'working' || state === 'waiting'; c.waiting = state === 'waiting';
    if (c.working) { c.holdUntil = now + 6500; c.flag = null; }
    c.note = c.working ? note : null; if (!c.working) { c.idleSince = now; c.act = null; }
  },
  message(m) {
    if (!ST || m.from === m.to || m.to === 'all') return;
    const f = chars[m.from]; if (!f || !DESKS[m.to] || m.handoff || m.score) return;   // özet ve puan mesajları için yürümeye gerek yok
    if (m.from === 'user') {
      f.bubble = { text: 'İstek', kind: 'say' }; f.wait = 2.2; f.faceTo = 'ceo';
      const t = chars.ceo; if (t && DESKS.ceo) { const su = seatOf('ceo'); t.listenUntil = performance.now() + 4000; t.listenFace = Math.atan2(DESKS.user[0] - su[0], DESKS.user[1] - su[1]); }
      return;
    }
    if (f.q.length < 3) f.q.push({ to: m.to, text: /^Soru:/.test(m.text) ? 'Soru?' : m.from === 'ceo' ? 'Görev' : m.to === 'ceo' ? 'Teslim' : 'Cevap' });
    // iş/soru alan ajan yerinde dönüp dinler (uyuyorsa uyanır)
    if (m.to !== 'user' && chars[m.to]) {
      const t = chars[m.to], sp = visitOf(m.to, m.from), se = seatOf(m.to);
      t.listenUntil = performance.now() + 2800; t.listenFace = Math.atan2(sp[0] - se[0], sp[1] - se[1]);
    }
  },
};
window.Office = Office; window.__dbg = { get camera() { return camera; }, get renderer() { return renderer; }, get scene() { return scene; }, chars, THREE, DESKS, findPath, free, route };
window.dispatchEvent(new Event('office-ready'));
