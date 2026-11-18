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
  function pineGeo(variant) {
    const rng = mulberry32(501 + variant);
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.08, 0.22, 4.6, 7);
    trunk.translate(0, 2.3, 0);
    parts.push({ geo: trunk, cBottom: '#705549', cTop: '#9c8065' });
    // Two irregular rings per whorl form drooping boughs with a snowy upper face.
    for (let level = 0; level < 5; level++) {
      const y = 1.2 + level * 0.78;
      const r = (1.45 - level * 0.24) * (0.82 + variant * 0.14);
      const phase = rng() * 6.28;
      const vertices = [], indices = [];
      for (let j = 0; j < 12; j++) {
        const a = phase + j * Math.PI / 6;
        const reach = r * (j % 2 ? 0.47 : 0.93 + rng() * 0.20);
        const tip = y + (j % 2 ? 0.26 : -rng() * 0.24);
        const dx = Math.cos(a) * reach, dz = Math.sin(a) * reach;
        vertices.push(dx, tip, dz, dx * 0.83, tip + 0.24, dz * 0.83);
      }
      vertices.push(0.09 * variant, y + 1.1, -0.05, 0, y + 0.24, 0);
      for (let j = 0; j < 12; j++) {
        const a = 2 * j, b = 2 * ((j + 1) % 12);
        indices.push(a, a+1, b, b, a+1, b+1, a+1, 24, b+1, b, 25, a);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      parts.push({ geo, cBottom: '#345e55', cTop: level === 0 ? '#689085' : (level < 3 ? '#a6c3b7' : '#e7efec') });
    }
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
  const pineShapes = [pineGeo(0), pineGeo(1), pineGeo(2), deadGeo()];
  // Trail-edge pennants mark the broad line in blue and the forest cut in ochre.
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.042, 1.55, 5),
    new THREE.MeshStandardMaterial({ color: 0x536d75 }), 96);
  const flags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 0.42, 0.055),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), 96);
  // r128 allocates instanceColor from the current draw count on its first write.
  flags.setColorAt(0, new THREE.Color(1, 1, 1));
  for (const mesh of [poles, flags]) { mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh); }
  const batches = [];
  for (let range = 0; range < 2; range++) {
    for (const shape of pineShapes) {
      const mesh = new THREE.InstancedMesh(shape, treeMat, 1600);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.castShadow = range === 0;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      batches.push(mesh);
    }
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
    const lane = {};
    for (let x = -CORRIDOR; x <= CORRIDOR; x += 3.5) {
      const jx = x + (rng() - 0.5) * 3.2;
      const jz = zMid + (rng() - 0.5) * BAND * 0.95;
      courseAt(-jz, seed, lane);
      // Open start, clustered forest edges, and clearance for the whole skier.
      const separation = Math.abs(jx - lane.x);
      const opening = 1 - U.smoothstep(25, 65, -jz);
      if (separation < lane.width + 1.8 + opening * 18) continue;
      if (lane.shortcut && Math.abs(jx) < 3.4) continue;
      const cluster = vnoise2(jx * 0.054, jz * 0.045, seed + 89);
      const density = (0.18 + d * 0.12 + 0.56 * cluster * cluster) * (1 - opening * 0.5);
      if (rng() < density) trees.push(makeTree(jx, jz, rng, d));
    }
    // A tree island on the inside of each apex makes the choice of line visible.
    const sector = sectorAt(-zMid);
    for (const apex of [74, 131, 184, 261]) {
      const dist = sectorDistance(sector, apex);
      if (Math.floor(dist / BAND) !== n) continue;
      courseAt(dist, seed, lane);
      const x = lane.shortcut ? Math.sign(lane.x) * 4.5 : 0;
      if (Math.abs(x - lane.x) > lane.width + 1.6) trees.push(makeTree(x, -dist, rng, d));
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
      shape: rng() < 0.05 ? 3 : Math.floor(rng() * 3),
      ground: terrainHeight(x, z, seed),
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
  function rebuildInstances(playerZ = 0) {
    for (const mesh of batches) mesh.count = 0;
    poles.count = flags.count = 0;
    const lane = {};
    function pennant(x, z, color) {
      const y = terrainHeight(x, z, seed);
      const i = poles.count++;
      poles.setMatrixAt(i, M.makeTranslation(x, y + 0.77, z));
      flags.setMatrixAt(flags.count++, M.makeTranslation(x + 0.40, y + 1.36, z));
      flags.setColorAt(i, C.set(color).convertSRGBToLinear());
    }
    for (const k of chunkTrees.keys()) {
      for (let d = k * CFG.CHUNK_LEN + 10; d < (k + 1) * CFG.CHUNK_LEN; d += 30) {
        courseAt(d, seed, lane);
        const side = lane.x < 0 ? -1 : 1;
        pennant(lane.x + side * (lane.width + 0.6), -d, '#247fa1');
        if (lane.shortcut) pennant(-side * 2.5, -d, '#e79036');
      }
    }
    poles.instanceMatrix.needsUpdate = flags.instanceMatrix.needsUpdate = true;
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
    for (const arr of chunkTrees.values()) {
      for (const t of arr) {
        const mesh = batches[t.shape + (Math.abs(t.z - playerZ) < 110 ? 0 : 4)];
        E.set(t.tilt * 0.4, t.rot, t.tilt);
        Q.setFromEuler(E);
        P.set(t.x, t.ground - 0.08, t.z);
        S.set(t.s, t.s * (0.96 + 0.5 * (t.tint - 0.86)), t.s);
        M.compose(P, Q, S);
        const index = mesh.count++;
        mesh.setMatrixAt(index, M);
        const frost = t.frost ? 0.15 : 0;
        C.setRGB(t.tint + frost, t.tint + frost, t.tint + frost);
        mesh.setColorAt(index, C);
      }
    }
    for (const mesh of batches) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // 碰撞查询：玩家附近行带的树
  const nearby = [];
  function nearTrees(z) {
    nearby.length = 0;
    const k = Math.max(0, Math.floor(-z / CFG.CHUNK_LEN));
    for (let kk = Math.max(0, k - 1); kk <= k + 1; kk++) {
      const arr = chunkTrees.get(kk);
      if (arr) for (const t of arr) nearby.push(t);
    }
    return nearby;
  }

  function reset(newSeed) {
    seed = newSeed;
    chunkTrees.clear();
  }

  function setVisible(v) {
    for (const mesh of batches) mesh.visible = v;
    poles.visible = flags.visible = v;
  }

  return { syncChunks, rebuildInstances, nearTrees, reset, setVisible };
}
