/* ================= trees.js ================= */
// 程序化松树（InstancedMesh + 顶点色雪挂 + 逐实例色彩变化）
// 行带式生成：每个 z 行带保证一个可通过间隙，密度/间隙随难度变化
'use strict';

// 手工合并多个几何体为一个带顶点色的 BufferGeometry
function mergeTreeParts(parts) {
  // parts: [{ geo, cBottom, cTop }] — geo 已变换到位，颜色按局部 y 从底到顶渐变
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geo.attributes.position.count;
    iCount += p.geo.index.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  const cb = new THREE.Color(), ct = new THREE.Color();
  for (const p of parts) {
    const g = p.geo;
    const pa = g.attributes.position, na = g.attributes.normal, gia = g.index;
    const n = pa.count;
    cb.set(p.cBottom).convertSRGBToLinear();
    ct.set(p.cTop).convertSRGBToLinear();
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pa.getY(i);
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
    const span = Math.max(1e-5, yMax - yMin);
    for (let i = 0; i < n; i++) {
      pos[vo * 3] = pa.getX(i); pos[vo * 3 + 1] = pa.getY(i); pos[vo * 3 + 2] = pa.getZ(i);
      nor[vo * 3] = na.getX(i); nor[vo * 3 + 1] = na.getY(i); nor[vo * 3 + 2] = na.getZ(i);
      const t = U.clamp((pa.getY(i) - yMin) / span, 0, 1);
      col[vo * 3] = U.lerp(cb.r, ct.r, t);
      col[vo * 3 + 1] = U.lerp(cb.g, ct.g, t);
      col[vo * 3 + 2] = U.lerp(cb.b, ct.b, t);
      vo++;
    }
    for (let i = 0; i < gia.count; i++) idx[io++] = gia.getX(i) + vo - n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function makeTrees(scene, seed) {
  const BAND = CFG.TREE_ROW_M;
  const CORRIDOR = CFG.CORRIDOR;

  // ---- 几何体 ----
  function pineGeo() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.09, 0.18, 1.4, 7);
    trunk.translate(0, 0.7, 0);
    parts.push({ geo: trunk, cBottom: '#5c4834', cTop: '#6b563e' });
    const c1 = new THREE.ConeGeometry(1.5, 1.7, 9); c1.translate(0, 1.55, 0);
    parts.push({ geo: c1, cBottom: '#1e4a38', cTop: '#2e6650' });
    const c2 = new THREE.ConeGeometry(1.06, 1.45, 9); c2.translate(0, 2.5, 0);
    parts.push({ geo: c2, cBottom: '#275846', cTop: '#3f8066' });
    const c3 = new THREE.ConeGeometry(0.6, 1.2, 9); c3.translate(0, 3.32, 0);
    parts.push({ geo: c3, cBottom: '#2e6a52', cTop: '#eef4f4' }); // 顶部挂雪
    return mergeTreeParts(parts);
  }
  function deadGeo() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.07, 0.15, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    parts.push({ geo: trunk, cBottom: '#463b30', cTop: '#554a3d' });
    for (let i = 0; i < 4; i++) {
      const br = new THREE.CylinderGeometry(0.025, 0.05, 1.0, 5);
      br.translate(0, 0.5, 0);
      br.rotateZ((i % 2 ? 1 : -1) * U.deg(58 + i * 6));
      br.rotateY(i * 1.7);
      br.translate(0, 1.0 + i * 0.42, 0);
      parts.push({ geo: br, cBottom: '#42382e', cTop: '#524639' });
    }
    return mergeTreeParts(parts);
  }

  const treeMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0,
  });
  const CAP_PINE = 2400, CAP_DEAD = 420;
  const pineMesh = new THREE.InstancedMesh(pineGeo(), treeMat, CAP_PINE);
  const deadMesh = new THREE.InstancedMesh(deadGeo(), treeMat.clone(), CAP_DEAD);
  for (const m of [pineMesh, deadMesh]) {
    m.castShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
  }

  // ---- 行带生成（确定性）----
  const chunkTrees = new Map();  // k -> [{x,z,r,s,rot,tint,frost}]
  function genBand(n) {
    // 行带 n：z ∈ [-(n+1)BAND, -n*BAND)
    const zMid = -(n + 0.5) * BAND;
    const d = difficultyAt(zMid);
    const rng = mulberry32(Math.floor(hash2i(n, 7, seed) * 2147483647));
    const z = zMid + (rng() - 0.5) * BAND * 0.7;
    const trees = [];
    // 开场留 50m 空场
    if (-z < 50) return trees;
    const gapW = U.lerp(CFG.TREE_GAP_START, CFG.TREE_GAP_END, d);
    const gapC = (rng() * 2 - 1) * (CORRIDOR - 6);
    const density = U.lerp(CFG.TREE_DENSITY_START, CFG.TREE_DENSITY_END, d);
    // 走廊内：留出 gap，其余按密度撒
    for (let x = -CORRIDOR; x <= CORRIDOR; x += 3.1) {
      const jx = x + (rng() - 0.5) * 2.2;
      if (Math.abs(jx - gapC) < gapW * 0.5) continue;
      if (rng() < density) {
        trees.push(makeTree(jx, z, rng, d));
      }
    }
    // 两岸装饰树（不参与难度）
    for (const side of [-1, 1]) {
      for (let bx = BANK_X0(); bx < BANK_X0() + 24; bx += 3.6) {
        if (rng() < 0.5) {
          const jx = side * (bx + (rng() - 0.5) * 2);
          const t = makeTree(jx, z + (rng() - 0.5) * BAND * 0.8, rng, 0.5);
          trees.push(t);
        }
      }
    }
    return trees;
  }
  function BANK_X0() { return CFG.BANK_START + 3; }

  function makeTree(x, z, rng, d) {
    const s = 0.75 + rng() * 0.7;
    const frost = rng() < 0.25 + d * 0.2;
    return {
      x, z,
      s,
      rot: rng() * Math.PI * 2,
      tilt: (rng() - 0.5) * 0.08,
      r: Math.max(0.42, 0.5 * s),
      tint: 0.86 + rng() * 0.26,
      frost,
      dead: rng() < 0.07,
    };
  }

  function syncChunks(kLo, kHi) {
    const need = new Set();
    for (let k = Math.max(0, kLo); k <= kHi; k++) need.add(k);
    for (const k of chunkTrees.keys()) if (!need.has(k)) chunkTrees.delete(k);
    for (const k of need) {
      if (!chunkTrees.has(k)) {
        const arr = [];
        const zTop = -(k + 1) * CFG.CHUNK_LEN, zBot = -k * CFG.CHUNK_LEN; // zTop < zBot（更负）
        const nMin = Math.max(0, Math.floor(-zBot / BAND));
        const nMax = Math.ceil(-zTop / BAND) - 1;
        for (let n = nMin; n <= nMax; n++) {
          const band = genBand(n);
          for (const t of band) {
            if (t.z <= zBot && t.z > zTop) arr.push(t);
          }
        }
        chunkTrees.set(k, arr);
      }
    }
  }

  // ---- 实例上传 ----
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const P = new THREE.Vector3(), S = new THREE.Vector3();
  const C = new THREE.Color();
  function rebuildInstances() {
    let np = 0, nd = 0;
    for (const arr of chunkTrees.values()) {
      for (const t of arr) {
        const y = terrainHeight(t.x, t.z, seed);
        E.set(t.tilt * 0.4, t.rot, t.tilt);
        Q.setFromEuler(E);
        P.set(t.x, y - 0.15, t.z);
        S.set(t.s, t.s * (0.9 + (t.tint - 0.86) * 0.5), t.s);
        M.compose(P, Q, S);
        if (t.dead && nd < CAP_DEAD) {
          deadMesh.setMatrixAt(nd++, M);
        } else if (np < CAP_PINE) {
          pineMesh.setMatrixAt(np, M);
          if (t.frost) C.setRGB(0.8, 0.9, 1.0);
          else C.setRGB(t.tint, t.tint * (0.95 + 0.1 * ((t.tint * 7) % 1)), t.tint * 0.92);
          pineMesh.setColorAt(np, C);
          np++;
        }
      }
    }
    pineMesh.count = np;
    deadMesh.count = nd;
    pineMesh.instanceMatrix.needsUpdate = true;
    deadMesh.instanceMatrix.needsUpdate = true;
    if (pineMesh.instanceColor) pineMesh.instanceColor.needsUpdate = true;
  }

  // 碰撞查询：玩家附近行带的树
  function nearTrees(z) {
    const out = [];
    const k = Math.max(0, Math.floor(-z / CFG.CHUNK_LEN));
    for (let kk = Math.max(0, k - 1); kk <= k + 1; kk++) {
      const arr = chunkTrees.get(kk);
      if (arr) for (const t of arr) out.push(t);
    }
    return out;
  }

  function reset(newSeed) {
    seed = newSeed;
    chunkTrees.clear();
  }

  function setVisible(v) {
    pineMesh.visible = v;
    deadMesh.visible = v;
  }

  return { syncChunks, rebuildInstances, nearTrees, reset, setVisible };
}
