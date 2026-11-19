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

function makeTrees(scene, seed, sunDirection = new THREE.Vector3(-0.34, 0.52, 0.78)) {
  const BAND = CFG.TREE_ROW_M;
  const CORRIDOR = CFG.CORRIDOR;
  const treeHeights = [6.8, 7.8, 6.1, 2.4];

  // The near boughs and their distant silhouettes are baked from the same
  // model. The single-file build embeds these four lossless textures.
  const textureLoader = typeof document === 'undefined' ? null : new THREE.TextureLoader();
  function forestTexture(url) {
    if (!textureLoader) return null;
    const texture = textureLoader.load(url);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function pineGeo(variant) {
    const rng = mulberry32(501 + variant);
    const pos = [], colors = [], uv = [], indices = [];
    const height = treeHeights[variant];
    const reach = [1.75, 1.60, 1.95][variant];
    const trunk = new THREE.CylinderGeometry(0.033, 0.215, height, 8, 1, true);
    const trunkPos = trunk.attributes.position, trunkUv = trunk.attributes.uv;
    for (let i = 0; i < trunkPos.count; i++) {
      pos.push(trunkPos.getX(i), trunkPos.getY(i) + height / 2, trunkPos.getZ(i));
      colors.push(1, 1, 1);
      uv.push(trunkUv.getX(i) * 0.96 + 0.02, 0.012 + trunkUv.getY(i) * 0.08);
    }
    for (const index of trunk.index.array) indices.push(index);
    trunk.dispose();

    const tiers = 11;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const baseY = height * (0.16 + 0.83 * t);
      const radius = reach * (0.14 + 0.86 * Math.pow(1 - t, 0.75));
      const count = t < 0.7 ? 8 : 6;
      const phase = i * 2.40 + rng() * 0.60;
      for (let j = 0; j < count; j++) {
        const a = phase + 2 * Math.PI * (j + rng() * 0.35) / count;
        const dx = Math.cos(a), dz = Math.sin(a);
        const length = radius * (0.72 + rng() * 0.43);
        const root = baseY + (rng() - 0.5) * 0.40;
        const width = length * 0.46;
        const sag = length * (0.25 + rng() * 0.22) - t * 0.12;
        const vCenter = 1 - (rng() < 0.50 ? 112 : 336) / 512;
        const uSteps = 2;
        const start = pos.length / 3;
        for (let k = 0; k <= uSteps; k++) {
          const f = k / uSteps;
          const y = root - sag * f - Math.sin(f * Math.PI) * length * 0.10;
          // A folded bough has a raised crown and drooping twig ends.
          // Its shaded interior stays visible between loaded branches.
          for (let side = -1; side <= 1; side++) {
            const across = side * width * (0.62 + f * 0.38);
            pos.push(dx * length * f - dz * across, y - Math.abs(across) * 0.58, dz * length * f + dx * across);
            const shade = 0.54 + 0.37 * f + 0.09 * t;
            colors.push(shade * 0.96, shade, shade * (1.03 - 0.04 * f));
            uv.push((3 + f * 505) / 512, vCenter + side * 108 / 512);
          }
          if (k === 0) continue;
          const v = start + (k - 1) * 3;
          indices.push(v,v+1,v+3, v+1,v+4,v+3, v+1,v+2,v+4, v+2,v+5,v+4);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
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

  const atlas = forestTexture('assets/spruce-branches.webp');
  if (atlas) atlas.anisotropy = 2;
  const treeMat = new THREE.MeshLambertMaterial({
    vertexColors: true, map: atlas, alphaTest: 0.31, side: THREE.DoubleSide,
  });
  const cutoutDepth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.31, side: THREE.DoubleSide,
  });
  function crownCard(texture, variant) {
    const width = 5.1, height = treeHeights[variant] + 0.35;
    const positions = [], uvs = [], indices = [];
    for (let j=0; j<2; j++) {
      const x = j === 0 ? width*0.5 : 0, z = j === 1 ? width*0.5 : 0;
      positions.push(-x,0,-z,x,0,z,x,height,z,-x,height,-z);
      uvs.push(0,0,1,0,1,1,0,1);
      const n=j*4;
      indices.push(n,n+1,n+2,n,n+2,n+3);
    }
    const card=new THREE.BufferGeometry();
    card.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    card.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    card.setIndex(indices);
    return { shape: card, mat: new THREE.MeshBasicMaterial({
      map: forestTexture(texture), color: 0xbcc8c5, alphaTest: 0.29, side: THREE.DoubleSide,
    }) };
  }
  const detailed = [pineGeo(0), pineGeo(1), pineGeo(2)];
  const crowns = [
    crownCard('assets/spruce-crown-1.webp', 0),
    crownCard('assets/spruce-crown-2.webp', 1),
    crownCard('assets/spruce-crown-3.webp', 2),
  ];
  const bareMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const dead = deadGeo();
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
    for (let kind = 0; kind < 4; kind++) {
      const shape = kind === 3 ? dead : (range === 0 ? detailed[kind] : crowns[kind].shape);
      const mat = kind === 3 ? bareMat : (range === 0 ? treeMat : crowns[kind].mat);
      const mesh = new THREE.InstancedMesh(shape, mat, 1600);
      if (kind !== 3) mesh.customDepthMaterial = cutoutDepth;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.castShadow = range === 0;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      batches.push(mesh);
    }
  }

  // On the mobile tier, reuse one small soft shadow stamp. Five samples
  // along its length let it follow the slope without a shadow-map pass.
  const stampSize = 64, stampPixels = new Uint8Array(stampSize * stampSize * 4);
  for (let iy = 0; iy < stampSize; iy++) {
    for (let ix = 0; ix < stampSize; ix++) {
      const t = (iy + 0.5) / stampSize, side = (ix + 0.5) / stampSize * 2 - 1;
      const crown = Math.max(0, Math.sin(Math.PI * t)) * (0.91 - 0.48*t);
      const width = crown * (0.85 + 0.11*Math.cos(46*t + side*1.5));
      const body = 1 - U.smoothstep(width * 0.56, width+0.09, Math.abs(side));
      const edge = U.smoothstep(0,0.085,t) * (1-U.smoothstep(0.92,1,t));
      const p = 4 * (iy*stampSize+ix);
      stampPixels[p] = stampPixels[p+1] = stampPixels[p+2] = 255;
      stampPixels[p+3] = Math.round(255 * body * edge * (0.9-0.38*t));
    }
  }
  const stamp = new THREE.DataTexture(stampPixels, stampSize, stampSize);
  stamp.magFilter = stamp.minFilter = THREE.LinearFilter; stamp.needsUpdate = true;
  const shadowCapacity = 400, stations = 5;
  const shadowPos = new THREE.BufferAttribute(new Float32Array(shadowCapacity * stations * 6),3);
  shadowPos.setUsage(THREE.DynamicDrawUsage);
  const shadowUv = [], shadowIdx = [];
  for (let i=0; i<shadowCapacity; i++) {
    for (let j=0; j<stations; j++) {
      const t=j/(stations-1), k=(i*stations+j)*2;
      shadowUv.push(0,t,1,t);
      if (j) shadowIdx.push(k-2,k-1,k, k-1,k+1,k);
    }
  }
  const shadowGeo = new THREE.BufferGeometry();
  shadowGeo.setAttribute('position',shadowPos);
  shadowGeo.setAttribute('uv',new THREE.Float32BufferAttribute(shadowUv,2));
  shadowGeo.setIndex(shadowIdx); shadowGeo.setDrawRange(0,0);
  const softShadows = new THREE.Mesh(shadowGeo,new THREE.MeshBasicMaterial({
    map:stamp, color:0x435973, transparent:true, opacity:0.40, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, side:THREE.DoubleSide,
  }));
  softShadows.frustumCulled = false; softShadows.visible = false; scene.add(softShadows);
  const sunXZ = Math.hypot(sunDirection.x,sunDirection.z) || 1;
  const sx=-sunDirection.x/sunXZ, sz=-sunDirection.z/sunXZ;
  let quality=2, lastPlayerZ=0, forestVisible=true;

  function shadowVertices(tree) {
    if (tree.shadow) return tree.shadow;
    const points = new Float32Array(stations*6);
    const width = (tree.shape===3 ? 0.65 : 1.85)*tree.s;
    const height = treeHeights[tree.shape] * tree.s;
    const slope = terrainHeight(tree.x+sx,tree.z+sz,seed)-tree.ground;
    const length = U.clamp(height/(sunDirection.y/sunXZ+slope),height*0.7,height*2.2);
    for (let j=0; j<stations; j++) {
      const d = -0.5 + length*j/(stations-1);
      for (const sign of [-1,1]) {
        const x = tree.x + sx*d + sz*width*sign;
        const z = tree.z + sz*d - sx*width*sign;
        const k=j*6 + (sign===1 ? 3 : 0);
        points[k]=x; points[k+1]=terrainHeight(x,z,seed)+0.025; points[k+2]=z;
      }
    }
    tree.shadow=points; return points;
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
    lastPlayerZ=playerZ;
    let shadowCount=0;
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
        // Even a full 77-degree carve cannot bring an entire chunk behind
        // the follow camera into view. Keep the collision chunks independent.
        if (t.z - playerZ > 72) continue;
        const dz=playerZ-t.z;
        // Rebuilds occur every 60 m. Allow for that entire advance when
        // choosing the forward range; the previous chunk needs less detail.
        const near = dz >= -12 && dz < (quality === 0 ? 72 : 100);
        const mesh = batches[t.shape + (near ? 0 : 4)];
        if (quality === 0 && dz >= -12 && dz < 128 && shadowCount < shadowCapacity) {
          shadowPos.array.set(shadowVertices(t),shadowCount++ * stations*6);
        }
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
    shadowGeo.setDrawRange(0,shadowCount*(stations-1)*6);
    if (shadowCount) { shadowPos.updateRange.count=shadowCount*stations*6; shadowPos.needsUpdate=true; }
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

  function setQuality(q) {
    if (q===quality) return;
    quality=q; softShadows.visible=forestVisible && q===0;
    rebuildInstances(lastPlayerZ);
  }

  function setVisible(v) {
    forestVisible=v; softShadows.visible=v && quality===0;
    for (const mesh of batches) mesh.visible = v;
    poles.visible = flags.visible = v;
  }

  return { syncChunks, rebuildInstances, nearTrees, reset, setVisible, setQuality };
}
