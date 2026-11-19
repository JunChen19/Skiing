/* ================= terrain.js ================= */
// 无限分块雪原：
//   · 非均匀网格——走廊内 ~0.9m/格（精细），两侧堤外 ~3m/格（省资源）
//   · 法线用网格高度差分计算（块边界用解析差分保证无缝）
//   · 生成任务按行切片、分帧推进（update(ms) 预算制），彻底消除重建卡顿
//   · 雪面使用风纹、压雪道配色和板下接触阴影
'use strict';

const terrainTimeUniform = { value: 0 };

// Bake one seamless tile. R/G store the slope of the surface, B relief and A
// fine grain. Filtering slopes directly keeps distant snow stable in motion.
function makeSnowSurface() {
  const size = 256, mask = size - 1, heights = new Float32Array(size * size);
  const pixels = new Uint8Array(size * size * 4);
  const grid = new Float32Array(size * size);
  const rand = mulberry32(61713);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  function noise(u, v, nx, nz, offset) {
    const x = u * nx, z = v * nz;
    const i = Math.floor(x), j = Math.floor(z);
    const a = (i % nx + nx) % nx, b = (j % nz + nz) % nz;
    const c = (a + 1) % nx, d = (b + 1) % nz;
    const fx = x - i, fz = z - j;
    const tx = fx * fx * (3 - 2 * fx), tz = fz * fz * (3 - 2 * fz);
    return U.lerp(U.lerp(grid[offset + b * nx + a], grid[offset + b * nx + c], tx),
      U.lerp(grid[offset + d * nx + a], grid[offset + d * nx + c], tx), tz);
  }
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = z / size;
      const drift = noise(u, v, 4, 4, 0);
      const wind = noise(u + drift * 0.10, v + drift * 0.07, 17, 6, 256);
      const crust = noise(u, v, 52, 28, 512);
      const i = z * size + x;
      heights[i] = drift * 0.15 + wind * wind * 0.12 + crust * 0.018 + grid[i] * 0.004;
      pixels[i * 4 + 2] = Math.round(wind * 255);
      pixels[i * 4 + 3] = Math.round(crust * 160 + grid[i] * 95);
    }
  }
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = (z * size + x) * 4;
      const dx = heights[z * size + ((x + 1) & mask)] - heights[z * size + ((x - 1) & mask)];
      const dz = heights[((z + 1) & mask) * size + x] - heights[((z - 1) & mask) * size + x];
      pixels[i] = U.clamp(Math.round(128 - dx * 1800), 0, 255);
      pixels[i + 1] = U.clamp(Math.round(128 - dz * 1800), 0, 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

function makeTerrain(scene, seed) {
  const W_HALF = 88;
  const W_SEG = 80, Z_SEG = 48, L = CFG.CHUNK_LEN;
  const COLS = W_SEG + 1, ROWS = Z_SEG + 1;

  // 列坐标：|t|^1.55 幂分布，中心密两端疏
  const colX = new Float32Array(COLS);
  for (let ix = 0; ix < COLS; ix++) {
    const t = -1 + (2 * ix) / W_SEG;
    colX[ix] = Math.sign(t) * (Math.pow(Math.abs(t), 1.55) * W_HALF + 240 * Math.pow(Math.abs(t), 12));
  }
  // Stream only vertex data when moving downhill. All pooled chunks share
  // this immutable index buffer (and the same surface texture and material).
  const indices = new Uint16Array(W_SEG * Z_SEG * 6);
  for (let iz = 0, i = 0; iz < Z_SEG; iz++) {
    for (let ix = 0; ix < W_SEG; ix++) {
      const a = iz * COLS + ix, b = a + 1, c = a + COLS;
      indices[i++] = a; indices[i++] = b; indices[i++] = c;
      indices[i++] = b; indices[i++] = c + 1; indices[i++] = c;
    }
  }
  const chunkIndex = new THREE.BufferAttribute(indices, 1);

  // ---- 材质 ----
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.0,
  });
  const contact = { value: new THREE.Vector4(0, 0, 0, 1) };
  const detail = { value: 1 };
  const snowSurface = makeSnowSurface();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uContact = contact;
    shader.uniforms.uSnowSurface = { value: snowSurface };
    shader.uniforms.uSnowDetail = detail;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 piste;\nvarying vec4 vSnow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnow = vec4(position.xz, piste);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec4 vSnow;',
        'uniform vec4 uContact;',
        'uniform sampler2D uSnowSurface;',
        'uniform float uSnowDetail;',
      ].join('\n'))
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'vec2 offset = vSnow.xy - uContact.xy;',
        'vec2 local = vec2(dot(offset, vec2(uContact.w, -uContact.z)), dot(offset, uContact.zw));',
        'vec2 footprint = local * vec2(2.9, 1.3);',
        'float contactShade = exp(-dot(footprint, footprint));',
        // Two different physical scales and orientations break up tile repetition.
        'mat2 windFrame = mat2(0.94, -0.342, 0.342, 0.94);',
        'vec2 uv = windFrame * vSnow.xy * 0.085;',
        'vec4 deposit = texture2D(uSnowSurface, uv);',
        'vec2 slopes = (deposit.rg - 0.502) * windFrame;',
        'float detailFade = 1.0 - smoothstep(22.0, 100.0, vViewPosition.z);',
        'float groom = max(vSnow.w, 0.0) * (0.65 + 0.35 * deposit.b);',
        'float stone = max(-vSnow.w, 0.0);',
        'float cord = vSnow.z * 35.0 + 1.4 * deposit.b;',
        'float cordFade = 1.0 - smoothstep(0.7, 3.0, fwidth(cord));',
        'slopes *= mix(1.38, 0.52, groom);',
        'slopes.x += 0.095 * cos(cord) * groom * cordFade;',
        'float grain = deposit.a - 0.5;',
        'if (uSnowDetail > 0.5 && vViewPosition.z < 45.0) {',
        '  vec4 fine = texture2D(uSnowSurface, uv.yx * 5.31 + 0.28);',
        '  float weight = 1.0 - smoothstep(18.0, 45.0, vViewPosition.z);',
        '  slopes += ((fine.gr - 0.502) * windFrame) * (0.36 * weight);',
        '  grain += (fine.a - 0.5) * weight;',
        '}',
        'float relief = (deposit.b - 0.5) * (0.17 - 0.07 * groom) + grain * 0.075;',
        'diffuseColor.rgb *= (1.0 + detailFade * relief) * (1.0 - contactShade * 0.32);',
        // Wind strips snow from steeper facets of the valley walls.
        'diffuseColor.rgb *= 1.0 - stone * (0.30 + 0.40 * deposit.b);',
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.87 - 0.18 * groom + 0.13 * grain, 0.58, 0.96);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * vec3(slopes.x, 0.0, slopes.y) * detailFade);');
  };

  // ---- 颜色表（线性）----
  const COL_SNOW = new THREE.Color('#f4f7fb').convertSRGBToLinear();
  const COL_SNOW_BLUE = new THREE.Color('#c9dcee').convertSRGBToLinear();
  const COL_ROCK = new THREE.Color('#817e79').convertSRGBToLinear();
  const COL_ROCK_DARK = new THREE.Color('#4e5054').convertSRGBToLinear();
  const laneSample = {};
  const tmpCol = new THREE.Color();
  const nrm = new THREE.Vector3();

  // ---- 网格池 + 构建队列 ----
  const chunks = new Map();   // k -> {mesh, k}（已完成）
  const pool = [];
  const buildQueue = [];      // 待处理任务
  let activeJob = null;       // 在途任务（独占 scratchH，不被排序打断）
  const scratchH = new Float32Array(COLS * ROWS);

  function newChunkMesh() {
    const geo = new THREE.BufferGeometry();
    const verts = COLS * ROWS;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('piste', new THREE.BufferAttribute(new Float32Array(verts * 2), 2));
    geo.setIndex(chunkIndex);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;      // 构建完成前不渲染
    scene.add(mesh);
    return { mesh, k: -1 };
  }

  function rangeFor(playerZ) {
    const pk = Math.max(0, Math.floor(-playerZ / L));
    return [Math.max(0, pk - CFG.CHUNKS_BEHIND), pk + CFG.CHUNKS_AHEAD];
  }

  function ensure(playerZ) {
    const [kLo, kHi] = rangeFor(playerZ);
    const pk = Math.max(0, Math.floor(-playerZ / L));
    for (const [k, c] of chunks) {
      if (k < kLo || k > kHi) {
        chunks.delete(k);
        c.mesh.visible = false;
        pool.push(c);
      }
    }
    for (let k = kLo; k <= kHi; k++) {
      if (chunks.has(k) || (activeJob && activeJob.k === k) || buildQueue.some((j) => j.k === k)) continue;
      const c = pool.pop() || newChunkMesh();
      c.mesh.visible = false;
      buildQueue.push({ c, k, phase: 0, iz: 0 });
    }
    buildQueue.sort((a, b) => Math.abs(a.k - pk) - Math.abs(b.k - pk)); // 近处优先
  }

  function stepOneRow(job) {   // 返回 true 表示该块完成
    if (job.phase === 0) {
      const pos = job.c.mesh.geometry.attributes.position;
      const zTop = -job.k * L;
      const iz = job.iz;
      const z = zTop - (iz / Z_SEG) * L;
      const base = iz * COLS;
      for (let ix = 0; ix < COLS; ix++) {
        const h = terrainHeight(colX[ix], z, seed);
        scratchH[base + ix] = h;
        pos.setXYZ(base + ix, colX[ix], h, z);
      }
      job.iz++;
      if (job.iz >= ROWS) { job.phase = 1; job.iz = 0; }
      return false;
    }
    writeNormalColorRow(job, job.iz);
    job.iz++;
    return job.iz >= ROWS;
  }

  function writeNormalColorRow(job, iz) {
    const geo = job.c.mesh.geometry;
    const nor = geo.attributes.normal;
    const col = geo.attributes.color;
    const piste = geo.attributes.piste;
    const zTop = -job.k * L;
    const z = zTop - (iz / Z_SEG) * L;
    const base = iz * COLS;
    const lane = courseAt(-z, seed, laneSample);
    const zUp = zTop - ((iz - 1) / Z_SEG) * L;
    const zDn = zTop - ((iz + 1) / Z_SEG) * L;
    for (let ix = 0; ix < COLS; ix++) {
      let nx, ny, nzD;
      if (iz === 0 || iz === Z_SEG || ix === 0 || ix === W_SEG) {
        // 边界：解析差分，与相邻块严格一致
        terrainNormalAt(colX[ix], z, seed, nrm);
        nx = nrm.x; ny = nrm.y; nzD = nrm.z;
      } else {
        const hL = scratchH[base + ix - 1], hR = scratchH[base + ix + 1];
        const hU = scratchH[base + ix - COLS], hD = scratchH[base + ix + COLS];
        const dx = (hR - hL) / (colX[ix + 1] - colX[ix - 1]);
        const dz = (hD - hU) / (zDn - zUp);
        const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        nx = -dx * inv; ny = inv; nzD = -dz * inv;
      }
      nor.setXYZ(base + ix, nx, ny, nzD);
      // 颜色
      const x = colX[ix];
      const scoured = 0.5 + 0.5 * fbm(x * 0.11, z * 0.11, 2, seed + 3);
      tmpCol.copy(COL_SNOW).lerp(COL_SNOW_BLUE, scoured * 0.4);
      const pathDist = Math.min(Math.abs(x - lane.x) / lane.width, lane.shortcut ? Math.abs(x) / 2.2 : Infinity);
      const groomed = 1 - U.smoothstep(0.65, 1.35, pathDist);
      // The corduroy bends continuously with the groomer's line. In the fork
      // the straight shortcut has its own pass; powder separates the two.
      const laneOffset = lane.shortcut && Math.abs(x) / 2.2 < Math.abs(x - lane.x) / lane.width
        ? x : x - lane.x;
      tmpCol.lerp(COL_SNOW_BLUE, (1 - groomed) * 0.48);
      const exposure = U.smoothstep(0.89, 0.65, ny);
      const rockMix = exposure > 0 ? exposure * (0.68 + 0.32 * scoured) : 0;
      piste.setXY(base + ix, laneOffset, groomed - rockMix);
      if (rockMix > 0.001) {
        tmpCol.lerp(COL_ROCK, rockMix).lerp(COL_ROCK_DARK, rockMix * 0.4);
      }
      const sheen = 0.94 + 0.06 * fbm(x * 0.02, z * 0.05, 2, seed + 29);
      col.setXYZ(base + ix, tmpCol.r * sheen, tmpCol.g * sheen, tmpCol.b * sheen);
    }
  }

  function finishJob(job) {
    const g = job.c.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.piste.needsUpdate = true;
    g.computeBoundingSphere();
    job.c.k = job.k;
    job.c.mesh.visible = true;
    chunks.set(job.k, job.c);
  }

  // 每帧调用：按时间预算（ms）推进构建，不卡帧。
  // 在途任务单独持有，队列可随时重排序/清理而不破坏共享 scratch。
  function update(budgetMs) {
    const deadline = performance.now() + budgetMs;
    while ((activeJob || buildQueue.length) && performance.now() < deadline) {
      if (!activeJob) activeJob = buildQueue.shift();
      while (performance.now() < deadline) {
        if (stepOneRow(activeJob)) {
          finishJob(activeJob);
          activeJob = null;
          break;
        }
      }
    }
  }

  function reset(newSeed) {
    seed = newSeed;
    for (const job of buildQueue) pool.push(job.c);
    buildQueue.length = 0;
    if (activeJob) { pool.push(activeJob.c); activeJob = null; }
    for (const c of chunks.values()) { c.mesh.visible = false; pool.push(c); }
    chunks.clear();
    ensure(0);
  }

  function finishNearest() {
    if (!buildQueue.length) return;
    const job = buildQueue.shift();
    while (!stepOneRow(job)) { /* Complete the starting tile before showing the slope. */ }
    finishJob(job);
  }

  return {
    contact, finishNearest, ensure,
    update,
    reset,
    mat,
    setQuality(q) { detail.value = q > 0 ? 1 : 0; },
    rangeFor,
    get pending() { return buildQueue.length + (activeJob ? 1 : 0); },
  };
}
