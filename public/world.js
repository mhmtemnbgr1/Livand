// Ofisin etrafındaki doğal "sanal dünya": yüzen ada, orman, patika, göl, çalılar, taşlar, gökyüzü
import * as THREE from 'three';

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const R = (a, b) => a + rnd() * (b - a);
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, flatShading: true, ...o });

function skyTexture(mode = 'dusk') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  const stops = { day: ['#4f9de8', '#8cc4f5', '#d9eeff', '#f6fbff'], dusk: ['#26214f', '#6a4a8f', '#e58f7c', '#ffd29a'], night: ['#050816', '#0c1230', '#1a2150', '#2b3470'] }[mode];
  stops.forEach((col, i) => gr.addColorStop(i / 3, col));
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  if (mode === 'night') {
    g.fillStyle = '#fff'; for (let i = 0; i < 140; i++) { const s = Math.random() < 0.15 ? 3 : 2; g.globalAlpha = 0.4 + Math.random() * 0.6; g.fillRect(Math.random() * 512, Math.random() * 420, s, s); } g.globalAlpha = 1;
    g.fillStyle = '#eef2ff'; g.beginPath(); g.arc(400, 90, 34, 0, 7); g.fill(); g.fillStyle = '#0c1230'; g.beginPath(); g.arc(414, 82, 30, 0, 7); g.fill();   // hilal
  } else {
    g.fillStyle = mode === 'day' ? '#fffbe8' : '#fff3d6'; g.beginPath(); g.arc(mode === 'day' ? 400 : 380, mode === 'day' ? 90 : 360, mode === 'day' ? 40 : 54, 0, 7); g.fill();   // güneş
    g.fillStyle = mode === 'day' ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)'; for (const [x, y, ww] of [[90, 250, 90], [250, 300, 70], [420, 200, 100], [160, 130, 60]]) { g.beginPath(); g.ellipse(x, y, ww, ww / 4, 0, 0, 7); g.fill(); }   // bulutlar
    if (mode === 'dusk') { g.fillStyle = '#fff'; for (let i = 0; i < 50; i++) g.fillRect(Math.random() * 512, Math.random() * 150, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function setSky(scene, mode) { const old = scene.background; scene.background = skyTexture(mode); old?.dispose?.(); }

function windowTexture(color) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 32, 32);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = rnd() > 0.4 ? '#ffe9b8' : '#3a3258'; g.fillRect(x * 8 + 2, y * 8 + 2, 4, 5); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// bölge dışı mı? (ofis + çimenlik temizliği)
export function buildWorld(scene, { nx, nz, doorX, quality = 'high' }) {
  const LOW = quality === 'low';
  const g = new THREE.Group(); scene.add(g);
  scene.background = skyTexture('dusk');
  const X0 = -13, X1 = nx + 13, Z0 = -13, Z1 = nz + 12;            // ada sınırları
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  const box = (w, h, d, x, y, z, m, sh = true) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.receiveShadow = true; o.castShadow = sh; g.add(o); return o; };

  // ada
  box(X1 - X0, 0.5, Z1 - Z0, cx, -0.25, cz, mat(0x4f9a52), false);
  box(X1 - X0 - 0.8, 3.0, Z1 - Z0 - 0.8, cx, -2.0, cz, mat(0x6e4d3a), false);
  box(X1 - X0 - 3.5, 2.4, Z1 - Z0 - 3.5, cx, -4.7, cz, mat(0x4a3428), false);
  // ofis çevresi: açık renk çim şerit ve taş zemin
  box(nx + 3, 0.08, nz + 3, nx / 2, -0.03, nz / 2, mat(0xb9b2a2), false);

  // ağaç gövdeleri / tepeleri: InstancedMesh
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6), coneGeo = new THREE.ConeGeometry(0.8, 1.6, 7), ballGeo = new THREE.IcosahedronGeometry(0.85, 0);
  const bushGeo = new THREE.IcosahedronGeometry(0.4, 0), rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
  const trees = [], bushes = [], rocks = [];
  const nearClear = (x, z, m) => x > -m && x < nx + m && z > -m && z < nz + m;          // ofise yakın bölge
    const frontClear = (x, z) => (x > nx && x < nx + 5.5 && z > -2 && z < nz + 5.5) || (z > nz && z < nz + 5.5 && x > -2 && x < nx + 5.5) || Math.hypot(x + 6.5, z - (nz + 3.8)) < 4.6;   // kamera tarafı (ön/sağ) ve göl açık kalsın
  const onPath = (x, z) => Math.abs(x - doorX) < 1.6 && z < 0.5;
  let guard = 0;
  while (trees.length < (LOW ? 60 : 150) && guard++ < 4000) {
    const x = R(X0 + 1.2, X1 - 1.2), z = R(Z0 + 1.2, Z1 - 1.2);
    if (nearClear(x, z, 3.8) || frontClear(x, z) || onPath(x, z)) continue;
    // ön/sağ taraf (kameraya yakın) alçak ağaçlar, arka/sol yüksek
    const back = z < nz * 0.3 || x < nx * 0.3;
    trees.push({ x, z, s: back ? R(1.0, 1.9) : R(0.8, 1.15), kind: rnd() < 0.55 ? 'pine' : 'oak', hue: rnd() });
  }
  for (let i = 0; i < (LOW ? 30 : 90); i++) { const x = R(X0 + 1, X1 - 1), z = R(Z0 + 1, Z1 - 1); if (nearClear(x, z, 2.4) || onPath(x, z) || frontClear(x, z)) continue; bushes.push({ x, z, s: R(0.7, 1.4) }); }
  for (let i = 0; i < (LOW ? 12 : 30); i++) { const x = R(X0 + 1, X1 - 1), z = R(Z0 + 1, Z1 - 1); if (nearClear(x, z, 2.2) || onPath(x, z)) continue; rocks.push({ x, z, s: R(0.6, 1.6) }); }

  const pines = trees.filter(t => t.kind === 'pine'), oaks = trees.filter(t => t.kind === 'oak');
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), C = new THREE.Color();
  const inst = (geo, material, list, place, tint) => {
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, list.length)); m.castShadow = !LOW; m.receiveShadow = !LOW; m.count = list.length;
    list.forEach((t, i) => { place(t); Q.setFromEuler(new THREE.Euler(0, R(0, 6.28), 0)); M.compose(V, Q, Sc); m.setMatrixAt(i, M); if (tint) m.setColorAt(i, tint(t)); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; g.add(m); return m;
  };
  const trunkMat = mat(0x7a5232);
  inst(trunkGeo, trunkMat, trees, t => { V.set(t.x, 0.5 * t.s, t.z); Sc.set(t.s, t.s, t.s); });
  inst(coneGeo, mat(0xffffff), pines, t => { V.set(t.x, 1.55 * t.s + 0.4, t.z); Sc.set(t.s, t.s * 1.15, t.s); }, t => C.setHSL(0.38 + t.hue * 0.04, 0.45, 0.26 + t.hue * 0.08));
  inst(coneGeo, mat(0xffffff), pines, t => { V.set(t.x, 2.2 * t.s + 0.5, t.z); Sc.set(t.s * 0.7, t.s * 0.9, t.s * 0.7); }, t => C.setHSL(0.38 + t.hue * 0.04, 0.5, 0.31 + t.hue * 0.08));
  inst(ballGeo, mat(0xffffff), oaks, t => { V.set(t.x, 1.55 * t.s + 0.3, t.z); Sc.set(t.s * 1.1, t.s * 0.95, t.s * 1.1); }, t => C.setHSL(0.27 + t.hue * 0.1, 0.5, 0.34 + t.hue * 0.1));
  inst(bushGeo, mat(0xffffff), bushes, t => { V.set(t.x, 0.28 * t.s, t.z); Sc.set(t.s, t.s * 0.8, t.s); }, t => C.setHSL(0.3 + rnd() * 0.08, 0.5, 0.3 + rnd() * 0.1));
  inst(rockGeo, mat(0x8c8a93), rocks, t => { V.set(t.x, 0.15 * t.s, t.z); Sc.set(t.s, t.s * 0.6, t.s * 0.9); }, () => C.setHSL(0.7, 0.05, 0.45 + rnd() * 0.15));

  // çiçekler (küçük renkli noktalar)
  const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), 160); let fc = 0;
  for (let i = 0; i < (LOW ? 0 : 110); i++) { const x = R(-3, nx + 3), z = R(-3, nz + 3); if (x > -0.8 && x < nx + 0.8 && z > -0.8 && z < nz + 0.8) continue; if (onPath(x, z) || (x > nx + 0.5 || z > nz + 0.5) && !(x < nx + 5 && z < nz + 5)) continue; V.set(x, 0.08, z); Sc.set(1, 1, 1); Q.identity(); M.compose(V, Q, Sc); fl.setMatrixAt(fc, M); fl.setColorAt(fc, C.setHSL(R(0, 1), 0.8, 0.65)); fc++; }
  fl.count = fc; fl.instanceMatrix.needsUpdate = true; if (fl.instanceColor) fl.instanceColor.needsUpdate = true; g.add(fl);

  // kapıdan çıkan patika (taş döşeme)
  for (let z = -0.6; z > Z0 + 0.5; z -= 0.95) box(1.3 + rnd() * 0.5, 0.06, 0.7, doorX + R(-0.35, 0.35), 0.02, z, mat(0xcdbd9d), false);
  // ofisin ön/sağ çevresinde taş yürüyüş yolu ve bank
  box(nx + 3.4, 0.05, 1.1, nx / 2, 0.0, nz + 1.3, mat(0xd4c8ae), false);
  box(1.1, 0.05, nz + 3.4, nx + 1.3, 0.0, nz / 2, mat(0xd4c8ae), false);
  for (const [x, z, ry] of [[nx * 0.3, nz + 2.1, 0], [nx * 0.7, nz + 2.1, 0], [nx + 2.1, nz * 0.5, Math.PI / 2]]) {
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = ry; g.add(b);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.5), mat(0x8a5a35)); seat.position.y = 0.45; seat.castShadow = true; b.add(seat);
    for (const dx of [-0.7, 0.7]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.4), mat(0x5a3b22)); l.position.set(dx, 0.22, 0); b.add(l); }
  }
  // sokak lambaları (patika ve ön yol boyunca)
  const lampMat = mat(0x4a4f5e), glow = new THREE.MeshBasicMaterial({ color: 0xffe3a0 });
  const lamp = (x, z) => { box(0.08, 2.0, 0.08, x, 1.0, z, lampMat); const o = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), glow); o.position.set(x, 2.1, z); g.add(o); };
  for (let z = -2; z > Z0 + 2; z -= 3.6) { lamp(doorX - 1.5, z); lamp(doorX + 1.5, z - 1.8); }
  for (let x = 1.5; x < nx; x += 4.5) lamp(x, nz + 1.9);
  for (let z = 1.5; z < nz; z += 4.5) lamp(nx + 1.9, z);

  // göl (sol ön)
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.08, 28), new THREE.MeshStandardMaterial({ color: 0x5fb7d4, roughness: 0.2, metalness: 0.1 }));
  pond.position.set(-6.5, 0.0, nz + 3.8); pond.receiveShadow = true; g.add(pond);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.16, 6, 28), mat(0x8c8a93)); rim.rotation.x = Math.PI / 2; rim.position.set(-6.5, 0.05, nz + 3.8); g.add(rim);

  // uzak şehir silüeti (sadece arka ve sol uçta)
  const PAL = [0xe58f9a, 0x6fc7c0, 0xf2c36b, 0x9d82e0, 0xf0a070, 0x7ab6e8];
  const city = (x, z, w, d, h, c) => {
    const tex = windowTexture('#' + c.toString(16).padStart(6, '0')); tex.repeat.set(Math.max(1, Math.round(w / 1.4)), Math.max(1, Math.round(h / 1.4)));
    const side = new THREE.MeshLambertMaterial({ map: tex }), top = new THREE.MeshLambertMaterial({ color: 0x2a2342 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, side, side]); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m);
  };
  let k = 0; for (let x = X0 + 2; x < X1 - 3; x += 5.5) city(x + R(-1, 1), Z0 + 1.8, R(3, 4.5), 3, R(7, 15), PAL[k++ % PAL.length]);
  for (let z = Z0 + 6; z < Z1 - 6; z += 5.5) city(X0 + 1.8, z + R(-1, 1), 3, R(3, 4.5), R(7, 14), PAL[k++ % PAL.length]);
  return g;
}
export function updateWorld() {}
